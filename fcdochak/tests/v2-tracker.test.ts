/**
 * v2 5차 tracker — 통관·입고 알리미.
 * 순수 함수(영업일·분위수·통계·예상일·완료율·입력 검사·단계 정규화·XML 파서·흉내 어댑터·실제 어댑터 스위치) ·
 * 메모리 PGlite(운영 DB 아님)에서 RLS·쌓기만·공개 보기 표본 기준·폴링(꺼짐이면 예시 조직만)·통계 새 판·데모 걷어내기.
 * 관세청은 부르지 않는다(fetch 는 가짜). 화면 흐름은 e2e/v2-tracker.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import type { Driver } from '@/lib/db/driver';
import { setDbForTests } from '@/lib/db';
import { addBusinessDays, businessDaysBetween, holidaySet, isBusinessDay, kstYmd, nextBusinessDay } from '@/lib/tracker/calendar';
import { completionRate, computeLeadTimeStats, displayDays, estimateDates, pickStat, quantile, summarize, type StatLike } from '@/lib/tracker/leadtime';
import { HolidaysSchema, readTrackerConfig, TRACKER_SETTING_SCHEMAS, TrackerRulesSchema } from '@/lib/tracker/settings';
import { buildTrackView } from '@/lib/tracker/view';
import { looksLikePersonalCustomsCode, normalizeNumber, validateTrackInput } from '@/lib/unipass/validate';
import { eventFingerprint, normalizeStage, stageTimes } from '@/lib/unipass/stages';
import { parseCargoProgressXml, portFromCode, unipassDate, unipassDateTime } from '@/lib/unipass/parse';
import { cargoQueryParams, UnipassHttpAdapter } from '@/lib/unipass/http';
import { MockUnipassAdapter, mockTimeline, querySeed } from '@/lib/unipass/mock';
import { UnipassDisabledError } from '@/lib/unipass/types';
import { V2_SETTING_SCHEMAS } from '@/lib/v2-setting-schemas';
import { DEMO_TABLES, demoCounts } from '@/lib/server/demo-status';
import { TRACKER_SETTINGS } from '@seed/reference/data';
import { seedDemo } from '@seed/demo';
import { buildPurgeSql, planPurge } from '@seed/demo/purge';
import { asRole, hazardDb, todayKst } from './helpers';

const HOL = holidaySet(HolidaysSchema.parse(TRACKER_SETTINGS.find((s) => s.key === 'calendar.kr_holidays')!.value).days);
const RULES = TrackerRulesSchema.parse(TRACKER_SETTINGS.find((s) => s.key === 'tracker.rules')!.value);

describe('한국 영업일 달력', () => {
  it('주말·공휴일·대체공휴일은 영업일이 아니다', () => {
    expect(isBusinessDay('2026-09-28', HOL)).toBe(true); // 월
    expect(isBusinessDay('2026-09-27', HOL)).toBe(false); // 일
    expect(isBusinessDay('2026-09-25', HOL)).toBe(false); // 추석
    expect(isBusinessDay('2026-03-02', HOL)).toBe(false); // 삼일절 대체(일요일 3/1)
    expect(isBusinessDay('2026-10-05', HOL)).toBe(false); // 개천절 대체(토요일 10/3)
    expect(isBusinessDay('2026-08-17', HOL)).toBe(false); // 광복절 대체
    expect(isBusinessDay('2027-12-27', HOL)).toBe(false); // 성탄절 대체
  });
  it('영업일 더하기 — 추석 연휴·주말·대체공휴일을 건너뛴다', () => {
    // 9/23(수) + 1 → 추석 9/24~26 + 일 9/27 건너 9/28(월)
    expect(addBusinessDays('2026-09-23', 1, HOL)).toBe('2026-09-28');
    // 10/2(금) + 1 → 10/3 토 · 10/4 일 · 10/5 대체 → 10/6(화)
    expect(addBusinessDays('2026-10-02', 1, HOL)).toBe('2026-10-06');
    // 0일: 영업일이면 그날, 주말이면 다음 영업일
    expect(addBusinessDays('2026-09-22', 0, HOL)).toBe('2026-09-22');
    expect(addBusinessDays('2026-09-26', 0, HOL)).toBe('2026-09-28');
    expect(nextBusinessDay('2026-02-14', HOL)).toBe('2026-02-19'); // 토 → 설 연휴 16~18 지나 목
    expect(() => addBusinessDays('2026-09-22', -1, HOL)).toThrow(RangeError);
    expect(() => addBusinessDays('2026-02-30', 1, HOL)).toThrow(RangeError);
  });
  it('걸린 영업일 — 같은 날 0 · 토요일 입항은 월요일부터 · 휴일은 세지 않는다', () => {
    expect(businessDaysBetween('2026-09-22', '2026-09-22', HOL)).toBe(0);
    expect(businessDaysBetween('2026-09-19', '2026-09-21', HOL)).toBe(0); // 토 → 월
    expect(businessDaysBetween('2026-09-19', '2026-09-22', HOL)).toBe(1);
    expect(businessDaysBetween('2026-09-23', '2026-09-28', HOL)).toBe(1); // 추석 사이
    expect(businessDaysBetween('2026-10-02', '2026-10-06', HOL)).toBe(1); // 대체공휴일 사이
    expect(() => businessDaysBetween('2026-09-23', '2026-09-22', HOL)).toThrow(RangeError);
  });
  it('시각 → 한국 날짜(자정 경계)', () => {
    expect(kstYmd('2026-09-21T14:59:59Z')).toBe('2026-09-21');
    expect(kstYmd('2026-09-21T15:00:00Z')).toBe('2026-09-22');
  });
  it('공휴일 첫 판은 확인 필요 표시가 있다', () => {
    const h = HolidaysSchema.parse(TRACKER_SETTINGS.find((s) => s.key === 'calendar.kr_holidays')!.value);
    expect(h.confirmed).toBe(false);
    expect(h.days.some((d) => d.date === '2026-07-17' && d.confirmed === false)).toBe(true);
    expect(new Set(h.days.map((d) => d.date)).size).toBe(h.days.length);
  });
});

describe('분위수·요약', () => {
  it('선형 보간(PERCENTILE.INC)', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([0, 0, 1, 1, 1, 2, 2, 3, 5, 9], 0.9)).toBe(5.4);
    expect(quantile([3], 0.9)).toBe(3);
    expect(() => quantile([], 0.5)).toThrow(RangeError);
    expect(() => quantile([1], 1.2)).toThrow(RangeError);
  });
  it('분포 칸 — 마지막 칸은 그 이상', () => {
    const s = summarize([0, 1, 1, 2, 12], 3);
    expect(s.hist).toEqual([1, 2, 1, 1]);
    expect(s.n).toBe(5);
    expect(() => summarize([1.5])).toThrow(RangeError);
  });
  it('보통은 반올림 · 늦으면은 올림(보통보다 작지 않게)', () => {
    expect(displayDays({ p50: 1.5, p90: 2.2 })).toEqual({ usual: 2, late: 3 });
    expect(displayDays({ p50: 1.4, p90: 1.4 })).toEqual({ usual: 1, late: 2 });
    expect(displayDays({ p50: 2, p90: 2 })).toEqual({ usual: 2, late: 2 });
  });
});

describe('소요 통계·고르기', () => {
  const s = (arrival: string, cleared: string | null, fc: string | null, partner: string | null = 'P1', broker: string | null = null, port = 'ICN', mode = 'LCL') => ({ partner, broker, port, mode, arrival, cleared, fc });
  it('판 셋(항구·방식 / 물류사 / 물류사+관세사) · 기간 밖·항구 모름·역순은 뺀다', () => {
    const rows = computeLeadTimeStats(
      [
        s('2026-09-14', '2026-09-14', '2026-09-16', 'P1', 'B1'),
        s('2026-09-14', '2026-09-15', '2026-09-17'),
        s('2026-09-15', '2026-09-17', null, 'P2'),
        s('2026-05-01', '2026-05-04', null), // 기간 밖
        { ...s('2026-09-14', '2026-09-15', null), port: null }, // 항구 모름
        s('2026-09-16', '2026-09-15', null), // 역순
      ],
      { holidays: HOL, today: '2026-09-22', windowDays: 30 },
    );
    const clear = rows.filter((r) => r.metric === 'arrival_to_clearance');
    expect(clear.map((r) => [r.level, r.partner, r.broker, r.n])).toEqual([
      ['port_mode', null, null, 3],
      ['partner', 'P1', null, 2],
      ['partner', 'P2', null, 1],
      ['partner_broker', 'P1', 'B1', 1],
    ]);
    expect(clear[0]).toMatchObject({ p50: 1, p90: 1.8, fromOn: '2026-08-24', toOn: '2026-09-22' });
    const fc = rows.filter((r) => r.metric === 'clearance_to_fc' && r.level === 'port_mode')[0];
    expect(fc).toMatchObject({ n: 2, p50: 2 });
  });
  it('표본 기준 이상인 가장 좁은 판 → 넓은 판 → 가정치', () => {
    const rows: StatLike[] = [
      { metric: 'arrival_to_clearance', level: 'port_mode', partner: null, broker: null, port: 'ICN', mode: 'LCL', p50: 1, p90: 3, n: 40 },
      { metric: 'arrival_to_clearance', level: 'partner', partner: 'P1', broker: null, port: 'ICN', mode: 'LCL', p50: 0.5, p90: 1, n: 8 },
      { metric: 'arrival_to_clearance', level: 'partner_broker', partner: 'P1', broker: 'B1', port: 'ICN', mode: 'LCL', p50: 0, p90: 1, n: 3 },
    ];
    const A = { p50: 2, p90: 4 };
    expect(pickStat(rows, { metric: 'arrival_to_clearance', partner: 'P1', broker: 'B1', port: 'ICN', mode: 'LCL' }, 5, A).basis).toBe('partner');
    expect(pickStat(rows, { metric: 'arrival_to_clearance', partner: 'P9', broker: null, port: 'ICN', mode: 'LCL' }, 5, A)).toMatchObject({ basis: 'port_mode', n: 40 });
    expect(pickStat(rows, { metric: 'arrival_to_clearance', partner: 'P1', broker: 'B1', port: 'ICN', mode: 'LCL' }, 3, A).basis).toBe('partner_broker');
    expect(pickStat(rows, { metric: 'arrival_to_clearance', partner: null, broker: null, port: 'PTK', mode: 'LCL' }, 5, A)).toEqual({ ...A, n: null, basis: 'assumed' });
    // 방식을 모르면 그 항구 판 중 표본이 많은 것
    expect(pickStat(rows, { metric: 'arrival_to_clearance', partner: null, broker: null, port: 'ICN', mode: null }, 5, A).basis).toBe('port_mode');
  });
});

describe('예상일', () => {
  const base = { toClear: { p50: 1, p90: 3 }, toFc: { p50: 2, p90: 4 }, holidays: HOL };
  it('입항 전이면 날짜 없음', () => {
    const e = estimateDates({ ...base, arrival: null, cleared: null, fc: null, today: '2026-09-22' });
    expect(e.clearance.usual).toBeNull();
    expect(e.fc.usual).toBeNull();
  });
  it('입항(9/22 화) → 수리 보통 9/23 · 늦으면 추석 넘어 9/29 · FC 보통 9/29 · 늦으면 10/6(개천절 대체 건너)', () => {
    const e = estimateDates({ ...base, arrival: '2026-09-22', cleared: null, fc: null, today: '2026-09-22' });
    expect(e.clearance).toMatchObject({ usual: '2026-09-23', late: '2026-09-29', overdue: false });
    expect(e.fc).toMatchObject({ usual: '2026-09-29', late: '2026-10-06' });
  });
  it('수리가 끝났으면 수리일에서 FC 를 센다', () => {
    const e = estimateDates({ ...base, arrival: '2026-09-21', cleared: '2026-09-22', fc: null, today: '2026-09-22' });
    expect(e.clearance.done).toBe('2026-09-22');
    expect(e.fc).toMatchObject({ usual: '2026-09-28', late: '2026-09-30' });
  });
  it('보통 날짜가 지났는데 안 끝났으면 「늦어지는 중」 — 예상일을 오늘 앞으로 보이지 않는다', () => {
    const e = estimateDates({ ...base, arrival: '2026-09-14', cleared: null, fc: null, today: '2026-09-22' });
    expect(e.clearance.overdue).toBe(true);
    expect(e.clearance.usual).toBe('2026-09-22');
    expect(e.clearance.late! >= e.clearance.usual!).toBe(true);
  });
  it('FC 입고가 끝났으면 done', () => {
    const e = estimateDates({ ...base, arrival: '2026-09-14', cleared: '2026-09-15', fc: '2026-09-17', today: '2026-09-22' });
    expect(e.fc.done).toBe('2026-09-17');
  });
  it('같은 날 입항분 완료율 — 표본 기준 미만이면 숨김', () => {
    expect(completionRate({ total: 4, cleared: 2 }, 5)).toBeNull();
    expect(completionRate({ total: 8, cleared: 6 }, 5)).toEqual({ total: 8, cleared: 6, rate: 0.75 });
    expect(completionRate(null, 5)).toBeNull();
    expect(() => completionRate({ total: 5, cleared: 6 }, 5)).toThrow(RangeError);
  });
});

describe('입력 검사', () => {
  const Y = 2026;
  it('개인통관고유부호(P + 12자리)는 막는다 — 하이픈·공백·섞여 있어도', () => {
    for (const x of ['P123456789012', 'p123456789012', 'P-1234-5678-9012', ' P 1234 5678 9012 ', 'B/L 12345 / P123456789012']) {
      expect(looksLikePersonalCustomsCode(x), x).toBe(true);
      const r = validateTrackInput({ kind: 'hbl', number: x, year: 2026 }, Y);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.personal).toBe(true);
        expect(r.error).not.toContain('123456789012');
      }
    }
    expect(looksLikePersonalCustomsCode('P1234567890123')).toBe(false); // 13자리 숫자
    expect(looksLikePersonalCustomsCode('HMMP123456789012')).toBe(false); // 글자 뒤에 붙은 P
  });
  it('화물관리번호 — 연도 두 자리로 시작하는 15~22자, 하이픈은 걷는다', () => {
    expect(validateTrackInput({ kind: 'cargo_no', number: '26ANLU083N59007001' }, Y)).toEqual({ ok: true, query: { kind: 'cargo_no', number: '26ANLU083N59007001', year: null } });
    expect(validateTrackInput({ kind: 'cargo_no', number: '26-ANLU083N-5900-7001' }, Y)).toMatchObject({ ok: true, query: { number: '26ANLU083N59007001' } });
    expect(validateTrackInput({ kind: 'cargo_no', number: 'ANLU083N59007001' }, Y).ok).toBe(false);
    expect(validateTrackInput({ kind: 'cargo_no', number: '26ABC' }, Y).ok).toBe(false);
  });
  it('B/L — 연도가 있어야 하고 영문·숫자·하이픈만', () => {
    expect(validateTrackInput({ kind: 'hbl', number: ' abcd 1234 ', year: '2026' }, Y)).toEqual({ ok: true, query: { kind: 'hbl', number: 'ABCD1234', year: 2026 } });
    expect(validateTrackInput({ kind: 'mbl', number: 'ABCD1234', year: '' }, Y)).toMatchObject({ ok: false, field: 'year' });
    expect(validateTrackInput({ kind: 'mbl', number: 'ABCD1234', year: 1999 }, Y)).toMatchObject({ ok: false, field: 'year' });
    expect(validateTrackInput({ kind: 'mbl', number: 'ABCD1234', year: 2028 }, Y)).toMatchObject({ ok: false, field: 'year' });
    expect(validateTrackInput({ kind: 'mbl', number: 'AB_CD/1234', year: 2026 }, Y)).toMatchObject({ ok: false, field: 'number' });
    expect(validateTrackInput({ kind: 'mbl', number: '-ABCD', year: 2026 }, Y)).toMatchObject({ ok: false, field: 'number' });
    expect(validateTrackInput({ kind: 'mbl', number: 'A'.repeat(36), year: 2026 }, Y)).toMatchObject({ ok: false, field: 'number' });
    expect(validateTrackInput({ kind: 'xx', number: 'ABCD', year: 2026 }, Y)).toMatchObject({ ok: false, field: 'kind' });
  });
  it('전각 글자도 반각으로', () => {
    expect(normalizeNumber('ＡＢＣ１２３')).toBe('ABC123');
  });
});

describe('단계 정규화', () => {
  it('처리구분 원문 → 아홉 단계(가정한 낱말)', () => {
    expect(normalizeStage('입항적하목록 제출')).toBe('manifest');
    expect(normalizeStage('입항보고 수리')).toBe('arrival');
    expect(normalizeStage('하선신고 수리')).toBe('unloading');
    expect(normalizeStage('반입신고')).toBe('bonded_in');
    expect(normalizeStage('수입신고')).toBe('declared');
    expect(normalizeStage('수입신고수리')).toBe('cleared');
    expect(normalizeStage('반출신고')).toBe('released');
    expect(normalizeStage('알 수 없는 처리')).toBeNull();
  });
  it('뒤 단계가 있으면 지금 단계는 가장 앞선 것 · 단계별 첫 시각', () => {
    const t = stageTimes([
      { stage: 'arrival', at: '2026-09-21T01:00:00.000Z' },
      { stage: 'cleared', at: '2026-09-22T03:00:00.000Z' },
      { stage: null, at: '2026-09-22T04:00:00.000Z' },
      { stage: 'arrival', at: '2026-09-21T05:00:00.000Z' },
    ]);
    expect(t.current).toBe('cleared');
    expect(t.first.arrival).toBe('2026-09-21T01:00:00.000Z');
  });
  it('지문은 처리구분 + 처리일시', () => {
    expect(eventFingerprint({ rawType: '반입 신고', at: '2026-09-21T10:00:00+09:00' })).toBe('반입신고@2026-09-21T10:00:00+09:00');
  });
});

// 공개 라이브러리 시험 XML 을 본뜬 가정 구조(docs/tracker-plan.md 3절, 원문 확인 필요). 번호는 예시.
const XML_ONE = `<?xml version="1.0" encoding="UTF-8"?>
<cargCsclPrgsInfoQryRtnVo>
  <tCnt>1</tCnt>
  <ntceInfo/>
  <cargCsclPrgsInfoQryVo>
    <cargMtNo>26EXAMPLE0000001</cargMtNo>
    <csclPrgsStts>수입신고수리</csclPrgsStts>
    <hblNo>EXHBL0001</hblNo>
    <dsprCd>KRINC</dsprCd>
    <etprDt>20260921</etprDt>
    <frwrEntsConm>예시 포워더 &amp; 로지스</frwrEntsConm>
    <pckGcnt>40</pckGcnt>
    <imprNm>이 칸은 읽지 않는다</imprNm>
    <vydf/>
  </cargCsclPrgsInfoQryVo>
  <cargCsclPrgsInfoDtlQryVo>
    <cargTrcnRelaBsopTpcd>수입신고수리</cargTrcnRelaBsopTpcd>
    <prcsDttm>20260922143000</prcsDttm>
    <shedNm>예시 CFS</shedNm>
  </cargCsclPrgsInfoDtlQryVo>
  <cargCsclPrgsInfoDtlQryVo>
    <cargTrcnRelaBsopTpcd>입항보고 수리</cargTrcnRelaBsopTpcd>
    <prcsDttm>20260921063000</prcsDttm>
    <shedNm/>
  </cargCsclPrgsInfoDtlQryVo>
  <cargCsclPrgsInfoDtlQryVo>
    <cargTrcnRelaBsopTpcd>틀린 날짜</cargTrcnRelaBsopTpcd>
    <prcsDttm>20261399000000</prcsDttm>
  </cargCsclPrgsInfoDtlQryVo>
</cargCsclPrgsInfoQryRtnVo>`;

describe('XML 파서(가정한 구조)', () => {
  it('단건 — 요약·이력(시각순)·모르는 칸과 틀린 날짜는 버림', () => {
    const r = parseCargoProgressXml(XML_ONE);
    if (r.status !== 'found') throw new Error(r.status);
    expect(r.summary).toEqual({ cargoNo: '26EXAMPLE0000001', mbl: null, hbl: 'EXHBL0001', status: '수입신고수리', portCode: 'KRINC', arrivalOn: '2026-09-21', forwarder: '예시 포워더 & 로지스', packages: 40 });
    expect(r.events).toEqual([
      { rawType: '입항보고 수리', at: '2026-09-21T06:30:00+09:00', summary: null },
      { rawType: '수입신고수리', at: '2026-09-22T14:30:00+09:00', summary: '예시 CFS' },
    ]);
    expect(JSON.stringify(r)).not.toContain('읽지 않는다');
  });
  it('여러 건([N00]) · 없음 · 거절(-1) · DOCTYPE 거부 · 모양 틀림', () => {
    const multi = `<cargCsclPrgsInfoQryRtnVo><tCnt>2</tCnt><ntceInfo>[N00] 여러 건</ntceInfo><cargCsclPrgsInfoQryVo><cargMtNo>A1</cargMtNo></cargCsclPrgsInfoQryVo><cargCsclPrgsInfoQryVo><cargMtNo>A2</cargMtNo></cargCsclPrgsInfoQryVo></cargCsclPrgsInfoQryRtnVo>`;
    expect(parseCargoProgressXml(multi)).toEqual({ status: 'multiple', cargoNos: ['A1', 'A2'], source: 'unipass' });
    expect(parseCargoProgressXml('<cargCsclPrgsInfoQryRtnVo><tCnt>0</tCnt><ntceInfo/></cargCsclPrgsInfoQryRtnVo>')).toEqual({ status: 'not_found', source: 'unipass' });
    expect(() => parseCargoProgressXml('<cargCsclPrgsInfoQryRtnVo><tCnt>-1</tCnt><ntceInfo>인증키 오류 ABCDEFGH1234</ntceInfo></cargCsclPrgsInfoQryRtnVo>')).toThrow(/거절/);
    try {
      parseCargoProgressXml('<cargCsclPrgsInfoQryRtnVo><tCnt>-1</tCnt><ntceInfo>인증키 오류 ABCDEFGH1234</ntceInfo></cargCsclPrgsInfoQryRtnVo>');
    } catch (e) {
      expect((e as Error).message).not.toContain('ABCDEFGH1234');
    }
    expect(() => parseCargoProgressXml('<!DOCTYPE x [<!ENTITY a "b">]><cargCsclPrgsInfoQryRtnVo><tCnt>1</tCnt></cargCsclPrgsInfoQryRtnVo>')).toThrow();
    expect(() => parseCargoProgressXml('<html>error</html>')).toThrow(/확인 필요/);
  });
  it('날짜 도움 함수', () => {
    expect(unipassDateTime('20260231120000')).toBeNull();
    expect(unipassDateTime('2026092')).toBeNull();
    expect(unipassDate('20260930')).toBe('2026-09-30');
    expect(unipassDate('20260931')).toBeNull();
    expect(portFromCode('KRPTK')).toBe('PTK');
    expect(portFromCode('KRPUS')).toBeNull();
  });
});

describe('실제 HTTP 어댑터 — 스위치 뒤', () => {
  const q = { kind: 'hbl' as const, number: 'EXHBL0001', year: 2026 };
  it('꺼짐이면 fetch 를 부르지 않는다', async () => {
    const fetch = vi.fn();
    const a = new UnipassHttpAdapter({ enabled: false, apiKey: 'test-only', fetch });
    await expect(a.lookup(q)).rejects.toBeInstanceOf(UnipassDisabledError);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('키가 없으면 부르지 않는다', async () => {
    const fetch = vi.fn();
    await expect(new UnipassHttpAdapter({ enabled: true, apiKey: null, fetch }).lookup(q)).rejects.toThrow(/인증키/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('쿼리 모양 · 503 한 번 뒤 성공 · 오류 문구에 키 없음', async () => {
    expect(cargoQueryParams({ kind: 'cargo_no', number: '26X', year: null })).toEqual({ cargMtNo: '26X' });
    expect(cargoQueryParams(q)).toEqual({ hblNo: 'EXHBL0001', blYy: '2026' });
    expect(cargoQueryParams({ ...q, kind: 'mbl' })).toEqual({ mblNo: 'EXHBL0001', blYy: '2026' });
    const urls: string[] = [];
    let n = 0;
    const fetch = vi.fn(async (url: string) => {
      urls.push(url);
      return n++ === 0 ? { status: 503, text: async () => '' } : { status: 200, text: async () => XML_ONE };
    });
    const calls = vi.fn();
    const r = await new UnipassHttpAdapter({ enabled: true, apiKey: 'test-only-key', fetch, sleep: async () => {}, onCall: calls }).lookup(q);
    expect(r.status).toBe('found');
    expect(calls).toHaveBeenCalledTimes(2);
    expect(urls[0]).toMatch(/^https:\/\/unipass\.customs\.go\.kr:38010\/ext\/rest\/cargCsclPrgsInfoQry\/retrieveCargCsclPrgsInfo\?/);
    const bad = vi.fn(async () => ({ status: 429, text: async () => '' }));
    const err = await new UnipassHttpAdapter({ enabled: true, apiKey: 'test-only-key', fetch: bad, sleep: async () => {} }).lookup(q).then(() => new Error("no error"), (e: Error) => e);
    expect(bad).toHaveBeenCalledTimes(3);
    expect(err.message).toMatch(/한도/);
    expect(err.message).not.toContain('test-only-key');
  });
});

describe('흉내 어댑터 — 결정적', () => {
  const now = Date.parse('2026-09-22T03:00:00Z');
  const q = { kind: 'hbl' as const, number: 'EXHBL-TEST-01', year: 2026 };
  it('같은 번호·같은 때면 같은 결과 · 지금 뒤의 기록은 없다', async () => {
    const a = new MockUnipassAdapter({ now: () => now, holidays: HOL });
    const r1 = await a.lookup(q);
    const r2 = await a.lookup(q);
    expect(r1).toEqual(r2);
    if (r1.status === 'found') for (const e of r1.events) expect(Date.parse(e.at)).toBeLessThanOrEqual(now);
  });
  it('시간이 지나면 다음 단계가 생긴다(입항 기준이 같으면 앞 기록은 그대로)', async () => {
    const arrival = Date.parse('2026-09-21T00:00:00Z');
    const early = await new MockUnipassAdapter({ now: () => arrival + 3600_000, holidays: HOL, arrivalOf: () => arrival }).lookup(q);
    const late = await new MockUnipassAdapter({ now: () => arrival + 20 * 86_400_000, holidays: HOL, arrivalOf: () => arrival }).lookup(q);
    if (early.status !== 'found' || late.status !== 'found') throw new Error('found 여야 합니다');
    expect(late.events.length).toBe(7);
    expect(late.events.slice(0, early.events.length)).toEqual(early.events);
    expect(late.events.map((e) => normalizeStage(e.rawType))).toEqual(['manifest', 'arrival', 'unloading', 'bonded_in', 'declared', 'cleared', 'released']);
  });
  it('수리는 영업일에만(흉내 규칙) · 순서가 지켜진다', () => {
    for (let i = 0; i < 40; i++) {
      const t = mockTimeline(querySeed({ kind: 'hbl', number: `EXHBL-${i}`, year: 2026 }), Date.parse('2026-09-23T01:00:00Z'), HOL);
      for (let k = 1; k < t.length; k++) expect(t[k].at).toBeGreaterThan(t[k - 1].at);
      const cleared = t.find((e) => e.stage === 'cleared')!;
      expect(isBusinessDay(kstYmd(cleared.at), HOL)).toBe(true);
    }
  });
});

describe('설정', () => {
  it('첫 판이 규칙에 맞고, 도착일 약속 스위치는 꺼짐, 어드민 설정 목록에 있다', () => {
    const m = new Map(TRACKER_SETTINGS.map((s) => [s.key, s.value]));
    const c = readTrackerConfig(m);
    expect(c.promiseOn).toBe(false);
    expect(c.rules.minSamples).toBeGreaterThanOrEqual(3);
    for (const k of Object.keys(TRACKER_SETTING_SCHEMAS)) expect(V2_SETTING_SCHEMAS[k], k).toBeDefined();
    expect(() => readTrackerConfig(new Map())).toThrow(/참조 시드/);
  });
});

describe('화면 자료 — buildTrackView', () => {
  it('선적의 국내 창고·FC 입고를 8·9단계로 · 예상일 근거', () => {
    const v = buildTrackView({
      events: [
        { stage: 'arrival', rawType: '입항보고 수리', at: '2026-09-21T06:30:00+09:00', summary: null },
        { stage: 'cleared', rawType: '수입신고수리', at: '2026-09-22T14:30:00+09:00', summary: null },
      ],
      shipment: { domesticAt: '2026-09-23T01:00:00.000Z', fcAt: null },
      key: { partner: null, broker: null, port: 'ICN', mode: 'LCL' },
      stats: [],
      rules: RULES,
      calendar: HOL,
      today: '2026-09-23',
    });
    expect(v.current).toBe('domestic');
    expect(v.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'done', 'done', 'done', 'done', 'current']);
    expect(v.steps.find((s) => s.stage === 'domestic')!.from).toBe('shipment');
    expect(v.clearance.done).toBe('2026-09-22');
    expect(v.fc.basis).toBe('assumed');
    expect(v.fc.usual).not.toBeNull();
  });
});

// ─── DB ─────────────────────────────────────────────────────────────────

let db: Driver;
let ids: { shipper: string; partner: string; admin: string };
let shipperOrg: string;
let other: { user: string; org: string };

beforeAll(async () => {
  db = await hazardDb();
  const r = await seedDemo(db, { today: todayKst(), password: 'test-only-password' });
  ids = r.demoIds!;
  shipperOrg = (await db.query<{ org_id: string }>(`select org_id from fcd.memberships where user_id = $1`, [ids.shipper]))[0].org_id;
  const o = await db.query<{ user_id: string; org_id: string }>(
    `select m.user_id, m.org_id from fcd.memberships m join fcd.orgs o on o.id = m.org_id where o.kind = 'shipper' and m.org_id <> $1 order by o.name limit 1`,
    [shipperOrg],
  );
  other = { user: o[0].user_id, org: o[0].org_id };
  setDbForTests(db);
}, 180_000);
afterAll(async () => {
  setDbForTests(undefined);
  await db.close();
});

describe('데모 자료', () => {
  it('예시 번호·흉내 단계·예시 통계가 있다(관세청 기록 source = unipass 는 없다)', async () => {
    const c = await db.query<{ tracks: number; events: number; unipass: number; stats: number; real: number }>(
      `select (select count(*)::int from fcd.cargo_tracks) tracks, (select count(*)::int from fcd.cargo_track_events) events,
              (select count(*)::int from fcd.cargo_track_events where source = 'unipass') unipass,
              (select count(*)::int from fcd.lead_time_stats where demo_org_id is not null) stats,
              (select count(*)::int from fcd.lead_time_stats where demo_org_id is null) real`,
    );
    expect(c[0].tracks).toBeGreaterThan(10);
    expect(c[0].events).toBeGreaterThan(c[0].tracks);
    expect(c[0].unipass).toBe(0);
    expect(c[0].stats).toBeGreaterThan(0);
    expect(c[0].real).toBe(0);
  });
  it('공개 보기는 표본 기준 이상만 · DEMO_MODE 꺼짐이면 예시 판이 안 보인다', async () => {
    const on = await asRole(db, 'fcd_public', null, true, (q) => q.query<{ n: number; is_example: boolean }>(`select n, is_example from fcd.v_lead_time_public`));
    expect(on.length).toBeGreaterThan(0);
    for (const r of on) expect(r.n).toBeGreaterThanOrEqual(RULES.minSamples);
    const all = await db.query<{ n: number }>(`select count(*)::int n from fcd.lead_time_stats where n < $1`, [RULES.minSamples]);
    expect(all[0].n).toBeGreaterThan(0); // 숨겨지는 판이 실제로 있다
    const off = await asRole(db, 'fcd_public', null, false, (q) => q.query(`select 1 from fcd.v_lead_time_public`));
    expect(off).toEqual([]);
  });
});

describe('권한(RLS)', () => {
  const ins = (q: Driver, org: string, by: string, number: string, extra = '') =>
    q.query<{ id: string }>(`insert into fcd.cargo_tracks (org_id, created_by, kind, number, bl_year${extra ? ', stage' : ''}) values ($1,$2,'hbl',$3,2026${extra ? `, '${extra}'` : ''}) returning id`, [org, by, number]);
  it('화주는 자기 조직 번호만 넣고 본다 · 서버 칸(단계)은 못 채운다 · 개인통관고유부호는 DB 도 거절', async () => {
    const r = await asRole(db, 'fcd_user', ids.shipper, true, (q) => ins(q, shipperOrg, ids.shipper, 'EXRLS-0001'));
    expect(r[0].id).toBeTruthy();
    await expect(asRole(db, 'fcd_user', ids.shipper, true, (q) => ins(q, other.org, ids.shipper, 'EXRLS-0002'))).rejects.toThrow();
    await expect(asRole(db, 'fcd_user', ids.shipper, true, (q) => ins(q, shipperOrg, ids.shipper, 'EXRLS-0003', 'cleared'))).rejects.toThrow();
    await expect(asRole(db, 'fcd_user', ids.shipper, true, (q) => ins(q, shipperOrg, ids.shipper, 'P123456789012'))).rejects.toThrow();
    const seen = await asRole(db, 'fcd_user', other.user, true, (q) => q.query(`select 1 from fcd.cargo_tracks where id = $1`, [r[0].id]));
    expect(seen).toEqual([]);
    const pub = await asRole(db, 'fcd_public', null, true, (q) => q.query(`select 1 from fcd.cargo_tracks limit 1`).catch(() => 'denied'));
    expect(pub).toBe('denied');
  });
  it('단계 기록은 사용자가 넣지 못한다(실측 조작 막기) · 고칠 수 있는 칸만 고친다', async () => {
    const t = (await db.query<{ id: string }>(`select id from fcd.cargo_tracks where org_id = $1 limit 1`, [shipperOrg]))[0].id;
    await expect(
      asRole(db, 'fcd_user', ids.shipper, true, (q) =>
        q.query(`insert into fcd.cargo_track_events (track_id, org_id, stage, raw_type, occurred_at, source, fingerprint) values ($1,$2,'cleared','수리',now(),'unipass','x')`, [t, shipperOrg]),
      ),
    ).rejects.toThrow();
    await asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query(`update fcd.cargo_tracks set label = '고친 별명' where id = $1`, [t]));
    await expect(asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query(`update fcd.cargo_tracks set stage = 'fc' where id = $1`, [t]))).rejects.toThrow();
    await expect(asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query(`delete from fcd.cargo_track_events where track_id = $1`, [t]))).rejects.toThrow();
    // 남의 선적은 잇지 못한다
    const otherShip = (await db.query<{ id: string }>(`select id from fcd.shipments where shipper_org_id = $1 limit 1`, [other.org]))[0]?.id;
    if (otherShip) await expect(asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query(`update fcd.cargo_tracks set shipment_id = $2 where id = $1`, [t, otherShip]))).rejects.toThrow();
  });
  it('알림 켜짐은 자기 것만 · 통계 원표·회차 기록은 운영자만', async () => {
    const t = (await db.query<{ id: string }>(`select id from fcd.cargo_tracks where org_id = $1 limit 1`, [shipperOrg]))[0].id;
    await asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query(`insert into fcd.track_watches (track_id, org_id, user_id, enabled) values ($1,$2,$3,false)`, [t, shipperOrg, ids.shipper]));
    await expect(asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query(`insert into fcd.track_watches (track_id, org_id, user_id, enabled) values ($1,$2,$3,true)`, [t, shipperOrg, other.user]))).rejects.toThrow();
    const w = await asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query<{ enabled: boolean }>(`select enabled from fcd.v_track_watch_current where track_id = $1 and user_id = $2`, [t, ids.shipper]));
    expect(w).toEqual([{ enabled: false }]);
    expect(await asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query(`select 1 from fcd.lead_time_stats limit 1`))).toEqual([]);
    expect((await asRole(db, 'fcd_user', ids.admin, true, (q) => q.query(`select 1 from fcd.lead_time_stats limit 1`))).length).toBe(1);
  });
  it('같은 날 입항분 — 개별 번호 없이 수만, 표본 기준 미만이면 빈 결과', async () => {
    const r = await asRole(db, 'fcd_public', null, true, (q) => q.query(`select * from fcd.track_same_day('ICN', null, '1999-01-01'::date)`));
    expect(r).toEqual([]);
  });
});

describe('서버 — 조회·저장·폴링·통계(관세청 꺼짐)', () => {
  it('공개 조회는 흉내로 결과만 · 아무것도 저장하지 않는다', async () => {
    const { publicLookup } = await import('@/lib/server/tracker');
    const before = await db.query<{ n: number }>(`select (select count(*) from fcd.cargo_tracks)::int + (select count(*) from fcd.unipass_poll_runs)::int n`);
    const out = await publicLookup({ kind: 'hbl', number: 'EXHBL-PUBLIC-1', year: 2026 }, 'LCL');
    expect(out.mock).toBe(true);
    const after = await db.query<{ n: number }>(`select (select count(*) from fcd.cargo_tracks)::int + (select count(*) from fcd.unipass_poll_runs)::int n`);
    expect(after[0].n).toBe(before[0].n);
    if (out.result.status === 'found') expect(out.view?.steps.length).toBe(9);
  });
  it('예시 화주가 저장하면 바로 흉내 단계가 쌓이고 알림이 켜진다 · 같은 번호는 하나', async () => {
    const { saveTrack } = await import('@/lib/server/tracker');
    const v = { id: ids.shipper } as never;
    const q = { kind: 'hbl' as const, number: 'EXHBL-SAVE-01', year: 2026 };
    const r = await saveTrack(v, shipperOrg, { query: q, label: '시험', mode: 'LCL', shipmentId: null });
    if (!r.ok) throw new Error(r.error);
    expect(r.already).toBe(false);
    const again = await saveTrack(v, shipperOrg, { query: q, label: null, mode: null, shipmentId: null });
    expect(again).toMatchObject({ ok: true, id: r.id, already: true });
    const t = await db.query<{ last_checked_at: string | null; n: number; w: boolean }>(
      `select t.last_checked_at, (select count(*)::int from fcd.cargo_track_events e where e.track_id = t.id) n,
              (select enabled from fcd.v_track_watch_current w where w.track_id = t.id) w from fcd.cargo_tracks t where t.id = $1`,
      [r.id],
    );
    expect(t[0].last_checked_at).not.toBeNull();
    expect(t[0].w).toBe(true);
  });
  it('꺼짐이면 실제 조직 번호에는 흉내 기록을 쌓지 않는다', async () => {
    const { refreshTrack } = await import('@/lib/server/tracker');
    const realOrg = (await db.query<{ id: string }>(`insert into fcd.orgs (kind, name, is_demo) values ('shipper', '시험 실제 화주', false) returning id`))[0].id;
    const t = (await db.query<{ id: string }>(`insert into fcd.cargo_tracks (org_id, kind, number, bl_year) values ($1,'hbl','REAL-0001',2026) returning id`, [realOrg]))[0].id;
    await refreshTrack(t, { trigger: 'manual', actorId: null });
    const e = await db.query<{ n: number }>(`select count(*)::int n from fcd.cargo_track_events where track_id = $1`, [t]);
    expect(e[0].n).toBe(0);
    const run = await db.query<{ mode: string }>(`select mode from fcd.unipass_poll_runs order by started_at desc limit 1`);
    expect(run[0].mode).toBe('off');
    await db.query(`delete from fcd.orgs where id = $1`, [realOrg]); // 시험 DB 정리(메모리)
  });
  it('폴링 — 알림 켠 예시 번호만 흉내로, 캐시 안의 번호는 건너뜀, 회차 기록', async () => {
    const { pollOnce } = await import('@/lib/server/tracker');
    const s1 = await pollOnce({ trigger: 'manual', actorId: ids.admin });
    expect(s1.mode).toBe('mock');
    expect(s1.calls).toBe(0);
    const s2 = await pollOnce({ trigger: 'manual', actorId: ids.admin });
    expect(s2.skipped).toBeGreaterThanOrEqual(0);
    const runs = await db.query<{ n: number }>(`select count(*)::int n from fcd.unipass_poll_runs where trigger = 'manual' and mode = 'mock'`);
    expect(runs[0].n).toBeGreaterThanOrEqual(2);
  });
  it('통계 새 판 — 앞 판을 supersedes_id 로 가리킨다', async () => {
    const { recomputeStats } = await import('@/lib/server/tracker');
    const r = await db.transaction((q) => recomputeStats(q));
    expect(r.rows).toBeGreaterThan(0);
    const linked = await db.query<{ n: number }>(`select count(*)::int n from fcd.lead_time_stats where batch_id = $1 and supersedes_id is not null`, [r.batchId]);
    expect(linked[0].n).toBeGreaterThan(0);
  });
});

describe('검토 고침', () => {
  it('보세운송 낱말은 단계로 세지 않는다 · 신고 전 반출은 반출이 아니다(LCL 하선 → CFS 반입 → 보세운송 반출 → 내륙 반입 → 신고 → 수리 → 반출)', () => {
    expect(normalizeStage('보세운송 신고수리')).toBeNull();
    expect(normalizeStage('보세운송 반출')).toBeNull();
    const ev = (raw: string, at: string) => ({ stage: normalizeStage(raw), at });
    const early = [ev('하선신고 수리', '2026-09-21T01:00:00.000Z'), ev('반입신고', '2026-09-21T03:00:00.000Z'), ev('반출신고', '2026-09-21T05:00:00.000Z'), ev('보세운송 신고수리', '2026-09-21T05:30:00.000Z'), ev('반입신고', '2026-09-21T09:00:00.000Z')];
    const a = stageTimes(early);
    expect(a.current).toBe('bonded_in'); // 첫 반출에서 「반출」로 올라가 폴링이 멈추지 않는다
    expect(a.first.released).toBeUndefined();
    expect(a.first.cleared).toBeUndefined();
    const b = stageTimes([...early, ev('수입신고', '2026-09-22T01:00:00.000Z'), ev('수입신고수리', '2026-09-22T05:00:00.000Z'), ev('반출신고', '2026-09-22T08:00:00.000Z')]);
    expect(b.current).toBe('released');
    expect(b.first.cleared).toBe('2026-09-22T05:00:00.000Z');
    expect(b.first.released).toBe('2026-09-22T08:00:00.000Z');
  });
  it('하루 상한 나누기 — 공개 조회 몫과 저장한 번호 몫', async () => {
    const { callBudgets } = await import('@/lib/tracker/settings');
    expect(callBudgets({ dailyCallBudget: 500, publicDailyBudget: 150 })).toEqual({ total: 500, public: 150, poll: 350 });
    expect(callBudgets({ dailyCallBudget: 500 })).toEqual({ total: 500, public: 500, poll: 500 });
    expect(callBudgets({ dailyCallBudget: 100, publicDailyBudget: 300 })).toEqual({ total: 100, public: 100, poll: 0 });
    expect(RULES.publicDailyBudget).toBeLessThan(RULES.dailyCallBudget);
  });
  it('예약 경로 확인 값 — 32자 이상 · 공백 없음 · 서로 다른 글자 16개 이상', async () => {
    const { env } = await import('@/lib/env');
    const prev = process.env.CRON_SECRET;
    try {
      process.env.CRON_SECRET = 'short-but-16-chars';
      expect(env.cronSecret).toBeNull();
      process.env.CRON_SECRET = 'a'.repeat(40);
      expect(env.cronSecret).toBeNull();
      process.env.CRON_SECRET = 'test-only-0123456789abcdefghijKLMNOP';
      expect(env.cronSecret).toBe('test-only-0123456789abcdefghijKLMNOP');
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });
  it('켜짐이어도 예시 조직 번호는 흉내(관세청에 보내지 않는다) · 흉내 양륙항은 번호의 항구를 따른다', async () => {
    const { adapterFor, loadTrackerConfig } = await import('@/lib/server/tracker');
    const cfg = await db.transaction((q) => loadTrackerConfig(q));
    const prev = process.env.UNIPASS_ENABLED;
    try {
      process.env.UNIPASS_ENABLED = 'on';
      expect(adapterFor(cfg, { isDemo: true }).kind).toBe('mock');
      expect(adapterFor(cfg, { isDemo: false }).kind).toBe('http');
    } finally {
      if (prev === undefined) delete process.env.UNIPASS_ENABLED;
      else process.env.UNIPASS_ENABLED = prev;
    }
    for (const [port, code] of [['PTK', 'KRPTK'], ['ICN', 'KRINC']] as const) {
      for (const n of ['EXHBL-PORT-1', 'EXHBL-PORT-2', 'EXHBL-PORT-3']) {
        const r = await adapterFor(cfg, { isDemo: true, port }).lookup({ kind: 'hbl', number: n, year: 2026 });
        if (r.status === 'found') expect(r.summary.portCode).toBe(code);
      }
    }
  });
  it('넣기 — 서버 칸 port_raw·cargo_no 는 사용자가 채우지 못한다', async () => {
    await expect(
      asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query(`insert into fcd.cargo_tracks (org_id, created_by, kind, number, bl_year, port_raw) values ($1,$2,'hbl','EXRLS-PR-1',2026,'KRINC')`, [shipperOrg, ids.shipper])),
    ).rejects.toThrow();
    await expect(
      asRole(db, 'fcd_user', ids.shipper, true, (q) => q.query(`insert into fcd.cargo_tracks (org_id, created_by, kind, number, bl_year, cargo_no) values ($1,$2,'hbl','EXRLS-CN-1',2026,'26EXMP0001')`, [shipperOrg, ids.shipper])),
    ).rejects.toThrow();
  });
  it('같은 날 입항분 — 방식 없이 부르면 빈 결과(방식별 수를 빼서 숨긴 수를 알아내지 못하게)', async () => {
    const top = (await db.query<{ port: string; mode: string; d: string; n: number }>(
      `select port, mode, arrival_on::text d, count(*)::int n from fcd.cargo_tracks where port is not null and mode is not null and arrival_on is not null and archived_at is null
        group by 1, 2, 3 order by 4 desc limit 1`,
    ))[0];
    expect(top).toBeTruthy();
    const none = await asRole(db, 'fcd_public', null, true, (q) => q.query(`select * from fcd.track_same_day($1, null, $2::date)`, [top.port, top.d]));
    expect(none).toEqual([]);
    const withMode = await asRole(db, 'fcd_public', null, true, (q) => q.query(`select * from fcd.track_same_day($1, $2, $3::date)`, [top.port, top.mode, top.d]));
    expect(withMode.length).toBe(top.n >= RULES.minSamples ? 1 : 0);
  });
  it('목록에서 뺀 번호를 다시 저장하면 목록에 되돌리고 알림을 켠다', async () => {
    const { saveTrack } = await import('@/lib/server/tracker');
    const v = { id: ids.shipper } as never;
    const q = { kind: 'hbl' as const, number: 'EXHBL-ARCH-01', year: 2026 };
    const r = await saveTrack(v, shipperOrg, { query: q, label: null, mode: 'LCL', shipmentId: null });
    if (!r.ok) throw new Error(r.error);
    await asRole(db, 'fcd_user', ids.shipper, true, async (tx) => {
      await tx.query(`update fcd.cargo_tracks set archived_at = now() where id = $1`, [r.id]);
      await tx.query(`insert into fcd.track_watches (track_id, org_id, user_id, enabled) values ($1,$2,$3,false)`, [r.id, shipperOrg, ids.shipper]);
    });
    const again = await saveTrack(v, shipperOrg, { query: q, label: null, mode: null, shipmentId: null });
    expect(again).toMatchObject({ ok: true, id: r.id, already: true, restored: true });
    const t = await db.query<{ archived_at: string | null; w: boolean }>(
      `select t.archived_at, (select enabled from fcd.v_track_watch_current w where w.track_id = t.id and w.user_id = $2) w from fcd.cargo_tracks t where t.id = $1`,
      [r.id, ids.shipper],
    );
    expect(t[0]).toEqual({ archived_at: null, w: true });
  });
  it('단계 알림 — 여러 단계를 건너면 한 건에 모아 적고(수리 포함), 화면 알림을 끈 사람·누른 사람은 뺀다', async () => {
    const { notifyTrackChange } = await import('@/lib/server/tracker');
    const t = (await db.query<{ id: string; org_id: string; number: string }>(`select id, org_id, number from fcd.cargo_tracks where org_id = $1 and archived_at is null order by created_at limit 1`, [shipperOrg]))[0];
    await db.query(`insert into fcd.track_watches (track_id, org_id, user_id, enabled) values ($1,$2,$3,true)`, [t.id, t.org_id, ids.shipper]);
    const core = { ...t, is_demo: true };
    const n1 = await db.transaction((q) => notifyTrackChange(q, core, { from: 'bonded_in', to: 'released' }));
    expect(n1).toBeGreaterThanOrEqual(1);
    const last = await db.query<{ title: string; body: string }>(`select title, body from fcd.notifications where user_id = $1 and link = $2 order by created_at desc limit 1`, [ids.shipper, `/app/tracking/${t.id}`]);
    expect(last[0].title).toContain('반출');
    expect(last[0].body).toContain('수리');
    expect(await db.transaction((q) => notifyTrackChange(q, core, { from: 'bonded_in', to: 'released' }, ids.shipper))).toBe(n1 - 1);
    await db.query(`insert into fcd.notification_prefs (user_id, kind, in_app) values ($1, 'status', false) on conflict (user_id, kind) do update set in_app = false`, [ids.shipper]);
    expect(await db.transaction((q) => notifyTrackChange(q, core, { from: 'bonded_in', to: 'released' }))).toBe(n1 - 1);
    await db.query(`update fcd.notification_prefs set in_app = true where user_id = $1 and kind = 'status'`, [ids.shipper]); // 시험 DB 되돌림(메모리)
    expect(await db.transaction((q) => notifyTrackChange(q, core, { from: 'declared', to: 'domestic' }))).toBeGreaterThanOrEqual(1);
    expect(await db.transaction((q) => notifyTrackChange(q, core, { from: 'released', to: 'fc' }))).toBe(0); // 알림 단계를 건너지 않음
  });
  it('통계 표본 — 같은 화물은 한 번만 · 선적 없이 고른 물류사는 업체별 판에 넣지 않는다', async () => {
    const { leadSamples } = await import('@/lib/tracker/store');
    const partner = (await db.query<{ id: string }>(`select id from fcd.orgs where is_demo and kind = 'partner' order by name limit 1`))[0].id;
    const before = await db.transaction((q) => leadSamples(q, true));
    const mine = (xs: typeof before) => xs.filter((x) => x.partner === partner).length;
    for (const [kind, number] of [['mbl', 'EXMBL-DUP-0001'], ['hbl', 'EXHBL-DUP-0001']] as const) {
      const t = (await db.query<{ id: string }>(
        `insert into fcd.cargo_tracks (org_id, kind, number, bl_year, mode, port, partner_org_id, cargo_no) values ($1,$2,$3,2026,'LCL','ICN',$4,'26EXDUP000001') returning id`,
        [shipperOrg, kind, number, partner],
      ))[0].id;
      for (const [stage, raw, at] of [['arrival', '입항보고 수리', '2026-09-21T01:00:00Z'], ['cleared', '수입신고수리', '2026-09-22T05:00:00Z']]) {
        await db.query(`insert into fcd.cargo_track_events (track_id, org_id, stage, raw_type, occurred_at, source, fingerprint) values ($1,$2,$3,$4,$5::timestamptz,'mock',$4 || '@' || $5)`, [t, shipperOrg, stage, raw, at]);
      }
    }
    const after = await db.transaction((q) => leadSamples(q, true));
    expect(after.length).toBe(before.length + 1);
    expect(mine(after)).toBe(mine(before));
    const added = after.filter((x) => x.cleared === '2026-09-22' && x.arrival === '2026-09-21' && x.port === 'ICN' && x.mode === 'LCL' && x.partner === null);
    expect(added.length).toBeGreaterThanOrEqual(1);
  });
});

describe('데모 걷어내기 — 새 표도 함께', () => {
  it('DEMO_TABLES 에 네 표가 있고, 걷어내면 데모 건수가 0', async () => {
    const names = ['cargo_tracks', 'cargo_track_events', 'track_watches', 'lead_time_stats'];
    expect(DEMO_TABLES.map((t) => t.table)).toEqual(expect.arrayContaining(names));
    const before = await db.transaction((tx) => demoCounts(tx));
    for (const t of names) expect(before.find((c) => c.table === t)!.demo, t).toBeGreaterThan(0);
    const plan = await db.transaction((tx) => planPurge(tx));
    await db.exec(buildPurgeSql(plan));
    const after = await db.transaction((tx) => demoCounts(tx));
    for (const t of names) expect(after.find((c) => c.table === t)!.demo, t).toBe(0);
  });
});
