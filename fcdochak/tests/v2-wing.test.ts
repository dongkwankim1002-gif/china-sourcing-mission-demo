/**
 * v2 2차 wing — 쿠팡 WING 연동: 서명(순수 함수) · HTTP 어댑터(스위치 꺼짐이면 부르지 않음, 가짜 fetch) · 흉내 어댑터 ·
 * 키 암호화 · 파일 줄 정리 · 짝 제안 · 실측 회송률 · 메모리 PGlite(운영 DB 아님)에서 RLS·권한·새 판·데모 걷어내기.
 * 쿠팡을 실제로 부르지 않는다. 화면 흐름은 e2e/v2-wing.spec.ts.
 */
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Driver } from '@/lib/db/driver';
import { hmacSha256Hex, wingAuthorization, wingMessage, wingSignature, wingSignedDate } from '@/lib/wing/sign';
import { RG_INVENTORY_PATH, WING_API_BASE, WingHttpAdapter, backoffMs, isRetryableStatus, minIntervalMs } from '@/lib/wing/http';
import { DEMO_WING_SEED, WingMockAdapter, demoWingHints, mockInbounds } from '@/lib/wing/mock';
import { BLOB_RE, decryptCredentials, encryptCredentials, kekFingerprint, last4 } from '@/lib/wing/crypto';
import { EXTERNAL_NO_RE, WING_IMPORT_COLUMNS, inboundChanged, matchFcCode, normalizeDate, normalizeInboundRow } from '@/lib/wing/import';
import { measuredReturnRate, qtyDiffBp, reasonText, scorePair, suggestMatches } from '@/lib/wing/match';
import { keyExpiry, keyExpiryState, parseWingSettings } from '@/lib/wing/settings';
import { WingDisabledError, WingHttpError, WingUnsupportedError, type WingCallRule, type WingMatchRule } from '@/lib/wing/types';
import { WING_EVENT_ACTION, WING_EVENT_KINDS, wingActiveSellers } from '@/lib/metrics';
import { V2_SETTING_SCHEMAS } from '@/lib/v2-setting-schemas';
import { DEMO_TABLES, demoCounts } from '@/lib/server/demo-status';
import { FC_CENTERS, SETTINGS, WING_SETTINGS } from '@seed/reference/data';
import { DEMO_ACCOUNTS, seedDemo } from '@seed/demo';
import { buildPurgeSql, planPurge } from '@seed/demo/purge';
import { asRole, hazardDb, todayKst } from './helpers';

const RULE: WingCallRule = { perSecond: 4, perMinute: 40, maxRetries: 3, baseBackoffMs: 1000, maxBackoffMs: 30000, timeoutMs: 10000 };
const MATCH: WingMatchRule = { dateWindowDays: 10, unitsToleranceBp: 2000, minScore: 70 };
const FCS = FC_CENTERS.map((f) => ({ code: f.code, name: f.name }));
// 시험용 가짜 키 — 실제 키가 아니다
const CREDS = { vendorId: 'A00012345', accessKey: 'test-access-0000000000000000abcd', secretKey: 'test-secret-000000000000000000000wxyz' };
const KEK = 'test-only-wing-kek-0123456789abcdefghij';

describe('서명(HMAC-SHA256 · CEA)', () => {
  it('HMAC-SHA256 자체 — RFC 4231 시험 2', () => {
    expect(hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });
  it('signed-date 는 UTC yyMMddTHHmmssZ', () => {
    expect(wingSignedDate(new Date('2026-09-25T03:15:07Z'))).toBe('260925T031507Z');
    expect(wingSignedDate(new Date('2009-01-02T23:59:59.999Z'))).toBe('090102T235959Z');
    expect(() => wingSignedDate(new Date('x'))).toThrow(RangeError);
  });
  it('message = signed-date + METHOD + PATH + QUERY(? 없이)', () => {
    const m = wingMessage({ method: 'get', path: '/v2/providers/x/vendors/A1/y', query: 'a=1&b=2', signedDate: '260925T031507Z' });
    expect(m).toBe('260925T031507ZGET/v2/providers/x/vendors/A1/ya=1&b=2');
    expect(wingMessage({ method: 'GET', path: '/p', signedDate: '260925T031507Z' })).toBe('260925T031507ZGET/p');
    expect(() => wingMessage({ method: 'GET', path: '/p', query: '?a=1', signedDate: '260925T031507Z' })).toThrow(RangeError);
    expect(() => wingMessage({ method: 'GET', path: '/p?a=1', signedDate: '260925T031507Z' })).toThrow(RangeError);
    expect(() => wingMessage({ method: 'GET', path: 'p', signedDate: '260925T031507Z' })).toThrow(RangeError);
    expect(() => wingMessage({ method: 'GET', path: '/p', signedDate: '2026-09-25' })).toThrow(RangeError);
  });
  it('서명 = hex(HMAC(secret, message)), 머리글 모양', () => {
    const i = { method: 'GET', path: RG_INVENTORY_PATH('A00012345'), query: 'nextToken=abc', signedDate: '260925T031507Z' };
    const expected = createHmac('sha256', CREDS.secretKey).update(`260925T031507ZGET/v2/providers/rg_open_api/apis/api/v1/vendors/A00012345/rg/inventory/summariesnextToken=abc`).digest('hex');
    expect(wingSignature({ ...i, secretKey: CREDS.secretKey })).toBe(expected);
    expect(wingAuthorization({ ...i, ...CREDS })).toBe(`CEA algorithm=HmacSHA256, access-key=${CREDS.accessKey}, signed-date=260925T031507Z, signature=${expected}`);
    // 한 글자만 바뀌어도 서명이 다르다
    expect(wingSignature({ ...i, query: 'nextToken=abd', secretKey: CREDS.secretKey })).not.toBe(expected);
    expect(() => wingSignature({ ...i, secretKey: '' })).toThrow(RangeError);
    expect(() => wingAuthorization({ ...i, ...CREDS, accessKey: 'a b' })).toThrow(RangeError);
  });
});

function fakeFetch(responses: { status: number; body?: string; retryAfter?: string }[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return { status: r.status, headers: { get: (n: string) => (n.toLowerCase() === 'retry-after' ? (r.retryAfter ?? null) : null) }, text: async () => r.body ?? '{}' };
  });
  return { fn, calls };
}

describe('HTTP 어댑터 — 스위치 꺼짐이면 부르지 않는다', () => {
  it('꺼짐: fetch 를 한 번도 부르지 않고 WingDisabledError', async () => {
    const f = fakeFetch([{ status: 200 }]);
    const a = new WingHttpAdapter({ enabled: false, credentials: CREDS, rule: RULE, fetch: f.fn });
    await expect(a.get('/v2/x')).rejects.toBeInstanceOf(WingDisabledError);
    await expect(a.inventorySummaries()).rejects.toBeInstanceOf(WingDisabledError);
    await expect(a.listInboundRequests({ from: '2026-09-01', to: '2026-09-30' })).rejects.toBeInstanceOf(WingDisabledError);
    expect(f.fn).not.toHaveBeenCalled();
  });
  it('켜짐(가짜 fetch): 서명 머리글·주소, 429 는 기다렸다 다시, Retry-After 우선', async () => {
    const f = fakeFetch([{ status: 429, retryAfter: '2' }, { status: 503 }, { status: 200, body: '{"data":[1]}' }]);
    const sleeps: number[] = [];
    const now = new Date('2026-09-25T03:15:07Z');
    const a = new WingHttpAdapter({ enabled: true, credentials: CREDS, rule: RULE, fetch: f.fn, now: () => now, sleep: async (ms) => void sleeps.push(ms) });
    await expect(a.inventorySummaries('tok en')).resolves.toEqual({ data: [1] });
    expect(f.calls).toHaveLength(3);
    expect(f.calls[0].url).toBe(`${WING_API_BASE}/v2/providers/rg_open_api/apis/api/v1/vendors/A00012345/rg/inventory/summaries?nextToken=tok%20en`);
    const auth = f.calls[0].headers.Authorization;
    expect(auth).toMatch(/^CEA algorithm=HmacSHA256, access-key=test-access-0000000000000000abcd, signed-date=260925T031507Z, signature=[0-9a-f]{64}$/);
    expect(auth).not.toContain(CREDS.secretKey);
    expect(auth.split('signature=')[1]).toBe(
      wingSignature({ method: 'GET', path: RG_INVENTORY_PATH('A00012345'), query: 'nextToken=tok%20en', signedDate: '260925T031507Z', secretKey: CREDS.secretKey }),
    );
    // 재시도 대기: Retry-After 2초 → 2000, 두 번째는 지수(1000·2^1) = 2000. 사이사이 호출 간격(1500ms)도 기다린다
    expect(sleeps.filter((s) => s === 2000)).toHaveLength(2);
    expect(sleeps).toContain(minIntervalMs(RULE));
  });
  it('401 은 다시 하지 않고, 오류 문구에 키가 없다 · 끝까지 5xx 면 maxRetries 뒤 실패', async () => {
    const f = fakeFetch([{ status: 401 }]);
    const a = new WingHttpAdapter({ enabled: true, credentials: CREDS, rule: RULE, fetch: f.fn, sleep: async () => {} });
    const e = (await a.get('/v2/x').catch((x: unknown) => x)) as WingHttpError;
    expect(e).toBeInstanceOf(WingHttpError);
    expect(e.status).toBe(401);
    expect(String(e.message)).not.toContain(CREDS.secretKey);
    expect(String(e.message)).not.toContain(CREDS.accessKey);
    expect(f.fn).toHaveBeenCalledTimes(1);
    const g = fakeFetch([{ status: 500 }]);
    const b = new WingHttpAdapter({ enabled: true, credentials: CREDS, rule: RULE, fetch: g.fn, sleep: async () => {} });
    await expect(b.get('/v2/x')).rejects.toMatchObject({ status: 500 });
    expect(g.fn).toHaveBeenCalledTimes(RULE.maxRetries + 1);
  });
  it('입고 요청 조회는 공개 API 확인 전 — 켜져 있어도 WingUnsupportedError(부르지 않음)', async () => {
    const f = fakeFetch([{ status: 200 }]);
    const a = new WingHttpAdapter({ enabled: true, credentials: CREDS, rule: RULE, fetch: f.fn });
    await expect(a.listInboundRequests({ from: '2026-09-01', to: '2026-09-30' })).rejects.toBeInstanceOf(WingUnsupportedError);
    expect(f.fn).not.toHaveBeenCalled();
  });
  it('대기·간격 계산', () => {
    expect(backoffMs(1, RULE)).toBe(1000);
    expect(backoffMs(3, RULE)).toBe(4000);
    expect(backoffMs(10, RULE)).toBe(30000);
    expect(backoffMs(1, RULE, '5')).toBe(5000);
    expect(backoffMs(1, RULE, '999')).toBe(30000);
    expect(backoffMs(2, RULE, 'Wed, 21 Oct 2015 07:28:00 GMT')).toBe(2000); // 날짜 모양은 무시하고 지수
    expect(() => backoffMs(0, RULE)).toThrow(RangeError);
    expect(minIntervalMs({ perSecond: 4, perMinute: 40 })).toBe(1500);
    expect(minIntervalMs({ perSecond: 5, perMinute: 600 })).toBe(200);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(404)).toBe(false);
  });
});

describe('키 암호화', () => {
  const ORG = '30000000-0000-4000-8000-000000000001';
  it('잠그고 풀기 · 암호문에 키가 보이지 않는다', () => {
    const blob = encryptCredentials(CREDS, ORG, KEK);
    expect(blob).toMatch(BLOB_RE);
    for (const s of [CREDS.secretKey, CREDS.accessKey, CREDS.vendorId]) expect(blob).not.toContain(s);
    expect(blob.split('.')[1]).toBe(kekFingerprint(KEK));
    expect(decryptCredentials(blob, ORG, KEK)).toEqual(CREDS);
    // 같은 입력도 매번 다른 암호문(무작위 iv)
    expect(encryptCredentials(CREDS, ORG, KEK)).not.toBe(blob);
  });
  it('다른 조직·다른 암호화 키·고친 암호문은 풀리지 않는다', () => {
    const blob = encryptCredentials(CREDS, ORG, KEK);
    expect(() => decryptCredentials(blob, '30000000-0000-4000-8000-000000000002', KEK)).toThrow('풀지 못했습니다');
    expect(() => decryptCredentials(blob, ORG, KEK + 'x')).toThrow('다른 암호화 키');
    const parts = blob.split('.');
    const body = Buffer.from(parts[4], 'base64url');
    body[0] ^= 1;
    parts[4] = body.toString('base64url');
    expect(() => decryptCredentials(parts.join('.'), ORG, KEK)).toThrow('풀지 못했습니다');
  });
  it('암호화 키가 없거나 짧으면 받지 않는다', () => {
    expect(() => encryptCredentials(CREDS, ORG, null)).toThrow('WING_KEY_ENCRYPTION_KEY');
    expect(() => encryptCredentials(CREDS, ORG, 'short')).toThrow('WING_KEY_ENCRYPTION_KEY');
    // 외우는 문장·반복 글자는 받지 않는다
    expect(() => encryptCredentials(CREDS, ORG, 'my coupang secret passphrase is long')).toThrow('너무 단순');
    expect(() => encryptCredentials(CREDS, ORG, 'a'.repeat(40))).toThrow('너무 단순');
  });
  it('끝 4자리', () => {
    expect(last4('A00012345')).toBe('2345');
    expect(last4(' ab ')).toBe('ab');
  });
});

describe('WING 파일 줄 정리', () => {
  it('칸 정의 — 필수는 입고 요청 번호 하나, 열 이름은 아직 확인 필요', () => {
    expect(WING_IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.key)).toEqual(['externalNo']);
    expect(WING_IMPORT_COLUMNS.every((c) => !c.confirmed)).toBe(true);
  });
  it('FC 이름 맞추기 — 지명이 하나만 걸릴 때', () => {
    expect(matchFcCode('이천1센터', FCS)).toBe('FC-ICH');
    expect(matchFcCode('덕평 물류센터', FCS)).toBe('FC-DPG');
    expect(matchFcCode('이천·덕평', FCS)).toBeNull();
    expect(matchFcCode('부천', FCS)).toBeNull();
    expect(matchFcCode(null, FCS)).toBeNull();
  });
  it('날짜 여러 모양', () => {
    expect(normalizeDate('2026-09-25')).toBe('2026-09-25');
    expect(normalizeDate('2026.9.5')).toBe('2026-09-05');
    expect(normalizeDate('2026년 9월 5일')).toBe('2026-09-05');
    expect(normalizeDate('20260925')).toBe('2026-09-25');
    expect(normalizeDate(46290)).toBe('2026-09-25'); // 엑셀 일련번호
    expect(normalizeDate('Fri Sep 25 2026 09:00:00 GMT+0900 (한국 표준시)')).toBe('2026-09-25');
    expect(normalizeDate('2026-02-30')).toBeNull();
    expect(normalizeDate('다음 주')).toBeNull();
    expect(normalizeDate('')).toBeNull();
  });
  it('한 줄 — 좋은 줄, 틀린 줄', () => {
    const ok = normalizeInboundRow({ externalNo: ' 123456789 ', centerName: '평택2센터', plannedOn: '2026/10/02', units: '1,200', boxes: '40박스', skuCount: 3, statusRaw: '입고 예정' }, FCS);
    expect(ok).toEqual({
      ok: true,
      value: { externalNo: '123456789', centerName: '평택2센터', fcCode: 'FC-PTK', plannedOn: '2026-10-02', skuCount: 3, units: 1200, boxes: 40, statusRaw: '입고 예정', receivedUnits: null, returnedUnits: null },
    });
    expect(normalizeInboundRow({ externalNo: '' }, FCS)).toMatchObject({ ok: false, error: '입고 요청 번호가 비었습니다' });
    expect(normalizeInboundRow({ externalNo: '입고-1' }, FCS)).toMatchObject({ ok: false });
    expect(normalizeInboundRow({ externalNo: 'AB12', units: -3 }, FCS)).toMatchObject({ ok: false, error: '수량은(는) 0 이상 정수여야 합니다' });
    expect(normalizeInboundRow({ externalNo: 'AB12', units: 1.5 }, FCS)).toMatchObject({ ok: false });
    expect(normalizeInboundRow({ externalNo: 'AB12', plannedOn: '언젠가' }, FCS)).toMatchObject({ ok: false, error: '입고 예정일을 읽지 못했습니다(YYYY-MM-DD)' });
    expect(EXTERNAL_NO_RE.test('EX-RG-12345678')).toBe(true);
  });
  it('다시 가져올 때 바뀐 것만', () => {
    const n = normalizeInboundRow({ externalNo: 'AB12', units: 10 }, FCS);
    if (!n.ok) throw new Error(n.error);
    const a = n.value;
    expect(inboundChanged(a, { ...a, units: 10 })).toBe(false);
    expect(inboundChanged(a, { ...a, returnedUnits: 2 })).toBe(true);
  });
});

describe('짝 제안', () => {
  const inb = (id: string, o: Partial<{ fcCode: string | null; plannedOn: string | null; units: number | null; boxes: number | null }> = {}) => ({
    id,
    externalNo: `EXT${id}`,
    fcCode: 'FC-ICH',
    plannedOn: '2026-10-01',
    units: 1000,
    boxes: 30,
    ...o,
  });
  const ship = (id: string, o: Partial<{ fcCode: string; etaFc: string | null; units: number; cartons: number }> = {}) => ({
    id,
    shipmentNo: `SH-${id}`,
    fcCode: 'FC-ICH',
    etaFc: '2026-10-01',
    units: 1000,
    cartons: 30,
    ...o,
  });
  it('점수 — FC 40 · 날짜 30 · 수량 30, 곧게 줄어든다', () => {
    expect(scorePair(inb('1'), ship('a'), MATCH).score).toBe(100);
    // 날짜 5일 차 → 15, 수량 10% 차(1000bp, 한도 2000) → 15
    const c = scorePair(inb('1', { plannedOn: '2026-10-06', units: 900 }), ship('a'), MATCH);
    expect(c.score).toBe(40 + 15 + 15);
    expect(c.reason).toEqual({ fc: true, dayDiff: 5, qtyDiffBp: 1000, qtyBasis: 'units' });
    // FC 다르면 최대 60 → 기준(70) 미달
    expect(scorePair(inb('1', { fcCode: 'FC-PTK' }), ship('a'), MATCH).score).toBe(60);
    // 수량이 없으면 박스로
    expect(scorePair(inb('1', { units: null, boxes: 30 }), ship('a'), MATCH).reason.qtyBasis).toBe('boxes');
    // 날짜가 창 밖이면 날짜 0
    expect(scorePair(inb('1', { plannedOn: '2026-11-30' }), ship('a'), MATCH).score).toBe(70);
    expect(qtyDiffBp(0, 0)).toBe(0);
    expect(qtyDiffBp(5, 0)).toBe(10_000);
    expect(() => qtyDiffBp(-1, 1)).toThrow(RangeError);
  });
  it('한 선적에 한 입고 요청 — 높은 점수부터, 확정된 짝은 빼고', () => {
    const s = suggestMatches([inb('1', { units: 950 }), inb('2'), inb('3', { fcCode: 'FC-GWJ' })], [ship('a'), ship('b', { etaFc: '2026-10-03' })], MATCH);
    const best = Object.fromEntries(s.map((x) => [x.inboundId, x.best?.shipmentId ?? null]));
    expect(best).toEqual({ '1': 'b', '2': 'a', '3': null });
    expect(s.find((x) => x.inboundId === '3')!.candidates.length).toBeGreaterThan(0); // 기준 미만도 고를 후보로는 보인다
    const t = suggestMatches([inb('1'), inb('2')], [ship('a'), ship('b')], MATCH, new Map([['2', 'a']]));
    expect(t).toHaveLength(1);
    expect(t[0].best!.shipmentId).toBe('b');
    expect(() => suggestMatches([], [], { ...MATCH, minScore: 101 })).toThrow(RangeError);
  });
  it('까닭 글', () => {
    expect(reasonText({ fc: true, dayDiff: 0, qtyDiffBp: 0, qtyBasis: 'units' })).toBe('FC 같음 · 날짜 같음 · 수량 같음');
    expect(reasonText({ fc: false, dayDiff: 3, qtyDiffBp: 250, qtyBasis: 'boxes' })).toBe('FC 다름 · 날짜 3일 차 · 박스 2.5% 차');
  });
  it('실측 회송률 — 회송 ÷ (입고 + 회송), 결과 칸이 둘 다 있는 줄만', () => {
    const r = measuredReturnRate([
      { receivedUnits: 970, returnedUnits: 30 },
      { receivedUnits: 500, returnedUnits: 0 },
      { receivedUnits: null, returnedUnits: 5 },
    ]);
    expect(r).toEqual({ rateBp: 200, received: 1470, returned: 30, rows: 2 }); // 30/1500
    expect(measuredReturnRate([]).rateBp).toBeNull();
    expect(() => measuredReturnRate([{ receivedUnits: -1, returnedUnits: 0 }])).toThrow(RangeError);
  });
});

describe('흉내 어댑터 — 결정적', () => {
  const hints = [
    { id: 's1', fcCode: 'FC-ICH', etaFc: '2026-10-01', units: 1200, cartons: 40, stage: 5, returnedUnits: 0 },
    { id: 's2', fcCode: 'FC-PTK', etaFc: '2026-09-20', units: 800, cartons: 20, stage: 9, returnedUnits: 12 },
  ];
  it('같은 시드면 같은 결과, 다른 시드면 다른 번호', () => {
    const a = mockInbounds({ seed: 'x', fcs: FCS, hints, today: '2026-09-25' });
    expect(mockInbounds({ seed: 'x', fcs: FCS, hints, today: '2026-09-25' })).toEqual(a);
    expect(mockInbounds({ seed: 'y', fcs: FCS, hints, today: '2026-09-25' })[0].externalNo).not.toBe(a[0].externalNo);
    expect(a).toHaveLength(4); // 맞춘 것 2 + 안 맞는 것 2
    for (const x of a) {
      expect(x.externalNo).toMatch(/^EX-RG-\d{8}$/); // 「예시」 번호
      expect(EXTERNAL_NO_RE.test(x.externalNo)).toBe(true);
    }
    // 끝난 선적(9단계)은 입고 결과가 있고, 물류사 회송 수량을 따른다
    expect(a[1]).toMatchObject({ fcCode: 'FC-PTK', returnedUnits: 12, statusRaw: '입고 완료' });
    expect(a[1].receivedUnits! + a[1].returnedUnits!).toBe(a[1].units);
    expect(a[0].receivedUnits).toBeNull();
    // 맞춘 것은 짝 제안에서 그 선적으로 간다
    const s = suggestMatches(
      a.map((x, i) => ({ id: String(i), externalNo: x.externalNo, fcCode: x.fcCode, plannedOn: x.plannedOn, units: x.units, boxes: x.boxes })),
      hints.map((h) => ({ id: h.id, shipmentNo: h.id, fcCode: h.fcCode, etaFc: h.etaFc, units: h.units, cartons: h.cartons })),
      MATCH,
    );
    expect(s[0].best?.shipmentId).toBe('s1');
    expect(s[1].best?.shipmentId).toBe('s2');
  });
  it('어댑터는 기간으로 거른다', async () => {
    const m = new WingMockAdapter({ seed: 'x', fcs: FCS, hints, today: '2026-09-25', strays: 0 });
    const r = await m.listInboundRequests({ from: '2026-09-25', to: '2026-10-31' });
    expect(r.map((x) => x.fcCode)).toEqual(['FC-ICH']);
  });
});

describe('설정·키 만료·이벤트 이름', () => {
  it('시드 값이 규칙을 통과하고, 어드민 설정 화면 규칙에도 있다', () => {
    const m = new Map(WING_SETTINGS.map((s) => [s.key, s.value]));
    const s = parseWingSettings(m);
    expect(s.match).toEqual(MATCH);
    expect(s.call).toEqual(RULE);
    expect(s.keyValidDays).toBe(180);
    expect(s.keyWarnDays).toBe(14);
    for (const k of m.keys()) {
      expect(V2_SETTING_SCHEMAS[k], k).toBeDefined();
      expect(SETTINGS.some((x) => x.key === k), k).toBe(true);
    }
    expect(() => parseWingSettings(new Map())).toThrow('설정 wing.call_rule');
    expect(V2_SETTING_SCHEMAS['wing.call_rule'].safeParse({ ...RULE, perSecond: 6 }).success).toBe(false); // 쿠팡 초당 5회를 넘지 못하게
  });
  it('만료 예정일·상태', () => {
    expect(keyExpiry('2026-04-01', 180)).toBe('2026-09-28');
    expect(keyExpiry(null, 180)).toBeNull();
    expect(keyExpiryState('2026-09-28', '2026-09-25', 14)).toBe('soon');
    expect(keyExpiryState('2026-12-28', '2026-09-25', 14)).toBe('ok');
    expect(keyExpiryState('2026-09-24', '2026-09-25', 14)).toBe('expired');
    expect(keyExpiryState(null, '2026-09-25', 14)).toBe('unknown');
    expect(keyExpiryState('2026-09-28', '2026-09-25', 2)).toBe('ok'); // 알림 시작 일수는 설정에서

  });
  it('WING 이벤트는 접근 기록 action 으로 간다', () => {
    for (const k of WING_EVENT_KINDS) expect(WING_EVENT_ACTION[k]).toMatch(/^[a-z_]+$/);
    expect(WING_EVENT_ACTION.wing_imported).toBe('imported');
    const rows = [
      { orgId: 'a', kind: 'wing_imported' as const, at: '2026-09-02T00:00:00Z' },
      { orgId: 'a', kind: 'wing_imported' as const, at: '2026-09-03T00:00:00Z' },
      { orgId: 'b', kind: 'wing_matched' as const, at: '2026-09-03T00:00:00Z' },
    ];
    expect(wingActiveSellers(rows, { from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' })).toBe(1);
  });
});

describe('DB — RLS·권한·새 판·데모(메모리 PGlite)', () => {
  let db: Driver;
  let shipperUser: string;
  let shipperOrg: string;
  let otherShipperUser: string;
  let adminUser: string;
  const REAL_SHIPPER = '31000000-0000-4000-8000-000000000001';
  const REAL_USER = '31000000-0000-4000-8000-0000000000aa';
  const blob = () => encryptCredentials(CREDS, shipperOrg, KEK);
  const asShipper = <T,>(fn: (q: Driver) => Promise<T>, user = shipperUser) => asRole(db, 'fcd_user', user, true, fn);

  beforeAll(async () => {
    db = await hazardDb();
    await seedDemo(db, { today: todayKst(), password: 'test-only-password' });
    const me = (await db.query<{ id: string; home_org_id: string }>(`select id, home_org_id from fcd.profiles where email = $1`, [DEMO_ACCOUNTS.shipper.email]))[0];
    shipperUser = me.id;
    shipperOrg = me.home_org_id;
    adminUser = (await db.query<{ id: string }>(`select id from fcd.profiles where email = $1`, [DEMO_ACCOUNTS.admin.email]))[0].id;
    otherShipperUser = (
      await db.query<{ user_id: string }>(
        `select m.user_id from fcd.memberships m join fcd.orgs o on o.id = m.org_id where o.kind = 'shipper' and o.is_demo and o.id <> $1 order by m.user_id limit 1`,
        [shipperOrg],
      )
    )[0].user_id;
    await db.exec(`
      insert into fcd.orgs (id, kind, name, slug, is_demo, status) values ('${REAL_SHIPPER}', 'shipper', '실제화주W', 'real-shipper-wing', false, 'active');
      insert into fcd.profiles (id, home_org_id, email, name) values ('${REAL_USER}', '${REAL_SHIPPER}', 'real-w@example.com', '실제화주W');
      insert into fcd.memberships (user_id, org_id, role) values ('${REAL_USER}', '${REAL_SHIPPER}', 'shipper_admin');
    `);
  });
  afterAll(async () => {
    await db?.close();
  });

  it('새 표 넷은 RLS 가 켜져 있고, UPDATE·DELETE 권한이 없다 · 암호문 칸은 읽을 권한이 없다', async () => {
    const t = ['wing_connections', 'wing_inbound_requests', 'wing_matches', 'wing_access_log'];
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'fcd' and c.relname = any($1::text[])`,
      [t],
    );
    expect(rls).toHaveLength(4);
    for (const r of rls) expect(r.relrowsecurity, r.relname).toBe(true);
    for (const x of t) {
      const p = await db.query<{ u: boolean; d: boolean }>(`select has_table_privilege('fcd_user', $1, 'UPDATE') u, has_table_privilege('fcd_user', $1, 'DELETE') d`, [`fcd.${x}`]);
      expect(p[0], x).toEqual({ u: false, d: false });
      for (const r of ['anon', 'authenticated', 'fcd_public']) {
        const s = await db.query<{ ok: boolean }>(`select has_table_privilege($1, $2, 'SELECT') ok`, [r, `fcd.${x}`]);
        expect(s[0].ok, `${r} ${x}`).toBe(false);
      }
    }
    const col = await db.query<{ ok: boolean }>(`select has_column_privilege('fcd_user', 'fcd.wing_connections', 'key_blob', 'SELECT') ok`);
    expect(col[0].ok).toBe(false);
    await expect(asShipper((q) => q.query(`select key_blob from fcd.wing_connections`))).rejects.toThrow();
  });

  it('데모 시드: 예시 입고 요청·짝 셋·접근 기록, 키 연결은 없다', async () => {
    const c = await db.transaction((tx) => demoCounts(tx));
    const get = (t: string) => c.find((x) => x.table === t)!.demo;
    expect(get('wing_inbound_requests')).toBeGreaterThanOrEqual(3);
    expect(get('wing_matches')).toBe(3);
    expect(get('wing_access_log')).toBe(4);
    expect(get('wing_connections')).toBe(0);
    const src = await db.query<{ n: number }>(`select count(*)::int n from fcd.wing_inbound_requests where source <> 'mock' or external_no not like 'EX-RG-%'`);
    expect(src[0].n).toBe(0);
    // 짝 맞은 것 중 입고 결과가 있는 것이 있다(실측 회송률이 화면에 보이게)
    const res = await db.query<{ n: number }>(
      `select count(*)::int n from fcd.v_wing_matches_current m join fcd.v_wing_inbound_current i on i.org_id = m.org_id and i.external_no = m.external_no
        where m.action = 'confirmed' and i.received_units is not null`,
    );
    expect(res[0].n).toBeGreaterThan(0);
    for (const t of ['wing_connections', 'wing_inbound_requests', 'wing_matches', 'wing_access_log']) expect(DEMO_TABLES.some((x) => x.table === t), t).toBe(true);
  });

  it('키 연결: 본인 조직만 보고, 새 판으로만 쌓는다 · 꺼냄은 함수로만(기록 남음) · 폐기 뒤엔 못 꺼낸다', async () => {
    const id = (
      await asShipper((q) =>
        q.query<{ id: string }>(
          `insert into fcd.wing_connections (org_id, version, method, status, key_blob, kek_id, vendor_last4, access_last4, created_by) values ($1,1,'self_key','saved',$2,$3,'2345','abcd',$4) returning id`,
          [shipperOrg, blob(), kekFingerprint(KEK), shipperUser],
        ),
      )
    )[0].id;
    // 같은 조직에 첫 판을 또 만들 수 없다(새 판으로 이어야 한다)
    await expect(
      asShipper((q) =>
        q.query(`insert into fcd.wing_connections (org_id, version, method, status, key_blob, kek_id, created_by) values ($1,1,'self_key','saved',$2,$3,$4)`, [shipperOrg, blob(), kekFingerprint(KEK), shipperUser]),
      ),
    ).rejects.toThrow();
    // 평문 칸은 그대로 읽힌다(끝 4자리), 다른 조직은 못 본다
    const mine = await asShipper((q) => q.query<{ vendor_last4: string; has_key: boolean }>(`select vendor_last4, has_key from fcd.v_wing_connections_current where org_id = $1`, [shipperOrg]));
    expect(mine).toEqual([{ vendor_last4: '2345', has_key: true }]);
    const other = await asShipper((q) => q.query(`select id from fcd.v_wing_connections_current where org_id = $1`, [shipperOrg]), otherShipperUser);
    expect(other).toHaveLength(0);
    // 다른 조직 사람은 남의 조직 이름으로 넣을 수 없다
    await expect(
      asShipper(
        (q) => q.query(`insert into fcd.wing_connections (org_id, version, supersedes_id, method, status, key_blob, kek_id, created_by) values ($1,2,$2,'self_key','saved',$3,$4,$5)`, [shipperOrg, id, blob(), kekFingerprint(KEK), otherShipperUser]),
        otherShipperUser,
      ),
    ).rejects.toThrow();
    // 꺼냄: 본인 조직 사람은 받고 기록이 남는다. 다른 조직·운영자는 null
    const got = await asShipper((q) => q.query<{ b: string | null }>(`select fcd.wing_key_blob($1) b`, [id]));
    expect(decryptCredentials(got[0].b!, shipperOrg, KEK)).toEqual(CREDS);
    expect((await asShipper((q) => q.query<{ b: string | null }>(`select fcd.wing_key_blob($1) b`, [id]), otherShipperUser))[0].b).toBeNull();
    expect((await asShipper((q) => q.query<{ b: string | null }>(`select fcd.wing_key_blob($1) b`, [id]), adminUser))[0].b).toBeNull();
    const logs = await db.query<{ n: number }>(`select count(*)::int n from fcd.wing_access_log where connection_id = $1 and action = 'key_decrypted'`, [id]);
    expect(logs[0].n).toBe(1);
    // 꺼냄 기록은 사람이 직접 못 쓴다
    await expect(asShipper((q) => q.query(`insert into fcd.wing_access_log (org_id, actor_id, action) values ($1,$2,'key_decrypted')`, [shipperOrg, shipperUser]))).rejects.toThrow();
    // 폐기 = 새 판(암호문 없음). 폐기 판에 암호문을 넣을 수 없다
    await expect(
      asShipper((q) => q.query(`insert into fcd.wing_connections (org_id, version, supersedes_id, method, status, key_blob, kek_id, created_by) values ($1,2,$2,'self_key','revoked',$3,$4,$5)`, [shipperOrg, id, blob(), kekFingerprint(KEK), shipperUser])),
    ).rejects.toThrow();
    await asShipper((q) => q.query(`insert into fcd.wing_connections (org_id, version, supersedes_id, method, status, created_by) values ($1,2,$2,'self_key','revoked',$3)`, [shipperOrg, id, shipperUser]));
    expect((await asShipper((q) => q.query<{ b: string | null }>(`select fcd.wing_key_blob($1) b`, [id])))[0].b).toBeNull();
    const cur = await asShipper((q) => q.query<{ status: string; has_key: boolean; version: number }>(`select status, has_key, version from fcd.v_wing_connections_current where org_id = $1`, [shipperOrg]));
    expect(cur).toEqual([{ status: 'revoked', has_key: false, version: 2 }]);
  });

  it('입고 요청·짝: 본인 조직만, 한 선적에 한 입고 요청, 짝 바꾸기는 새 판', async () => {
    const inb = await asShipper((q) => q.query<{ external_no: string }>(`select external_no from fcd.v_wing_inbound_current where org_id = $1 order by external_no`, [shipperOrg]));
    expect(inb.length).toBeGreaterThan(3);
    expect(await asShipper((q) => q.query(`select 1 from fcd.wing_inbound_requests where org_id = $1`, [shipperOrg]), otherShipperUser)).toHaveLength(0);
    const cur = await asShipper((q) => q.query<{ id: string; external_no: string; shipment_id: string }>(`select id, external_no, shipment_id from fcd.v_wing_matches_current where org_id = $1 and action = 'confirmed' order by external_no`, [shipperOrg]));
    expect(cur).toHaveLength(3);
    const free = inb.find((i) => !cur.some((c) => c.external_no === i.external_no))!.external_no;
    // 이미 다른 입고 요청과 짝인 선적에는 못 붙인다
    await expect(
      asShipper((q) => q.query(`insert into fcd.wing_matches (org_id, external_no, shipment_id, action, created_by) values ($1,$2,$3,'confirmed',$4)`, [shipperOrg, free, cur[0].shipment_id, shipperUser])),
    ).rejects.toThrow();
    // 남의 선적에도 못 붙인다
    const otherShip = (await db.query<{ id: string }>(`select id from fcd.shipments where shipper_org_id <> $1 limit 1`, [shipperOrg]))[0].id;
    await expect(
      asShipper((q) => q.query(`insert into fcd.wing_matches (org_id, external_no, shipment_id, action, created_by) values ($1,$2,$3,'confirmed',$4)`, [shipperOrg, free, otherShip, shipperUser])),
    ).rejects.toThrow();
    // 풀기 = 새 판, 그러면 그 선적을 다른 입고 요청에 붙일 수 있다
    await asShipper((q) => q.query(`insert into fcd.wing_matches (org_id, external_no, shipment_id, action, supersedes_id, created_by) values ($1,$2,null,'unlinked',$3,$4)`, [shipperOrg, cur[0].external_no, cur[0].id, shipperUser]));
    await asShipper((q) => q.query(`insert into fcd.wing_matches (org_id, external_no, shipment_id, action, created_by) values ($1,$2,$3,'confirmed',$4)`, [shipperOrg, free, cur[0].shipment_id, shipperUser]));
    // 같은 판을 두 번 잇지 못한다
    await expect(
      asShipper((q) => q.query(`insert into fcd.wing_matches (org_id, external_no, shipment_id, action, supersedes_id, created_by) values ($1,$2,null,'unlinked',$3,$4)`, [shipperOrg, cur[0].external_no, cur[0].id, shipperUser])),
    ).rejects.toThrow();
    // 입고 요청 새 판(다시 가져오기) — 판 번호를 건너뛰지 못한다
    const root = (await db.query<{ id: string; external_no: string }>(`select id, external_no from fcd.v_wing_inbound_current where org_id = $1 and version = 1 limit 1`, [shipperOrg]))[0];
    const ins = (v: number) =>
      asShipper((q) =>
        q.query(`insert into fcd.wing_inbound_requests (org_id, source, batch_id, external_no, status_raw, version, supersedes_id, created_by) values ($1,'file',gen_random_uuid(),$2,'입고 완료',$3,$4,$5)`, [shipperOrg, root.external_no, v, root.id, shipperUser]),
      );
    await expect(ins(3)).rejects.toThrow();
    await ins(2);
    const now = await asShipper((q) => q.query<{ version: number; status_raw: string }>(`select version, status_raw from fcd.v_wing_inbound_current where org_id = $1 and external_no = $2`, [shipperOrg, root.external_no]));
    expect(now).toEqual([{ version: 2, status_raw: '입고 완료' }]);
  });

  it('키 저장·꺼냄은 화주 관리자만 — 같은 조직 일반 구성원은 막힌다', async () => {
    const member = (await db.query<{ user_id: string }>(`select user_id from fcd.memberships where org_id = $1 and role = 'shipper_member' limit 1`, [shipperOrg]))[0];
    expect(member).toBeTruthy();
    const cur = (await db.query<{ id: string; version: number }>(`select id, version from fcd.v_wing_connections_current where org_id = $1`, [shipperOrg]))[0];
    await expect(
      asShipper(
        (q) => q.query(`insert into fcd.wing_connections (org_id, version, supersedes_id, method, status, key_blob, kek_id, created_by) values ($1,$2,$3,'self_key','saved',$4,$5,$6)`, [shipperOrg, cur.version + 1, cur.id, blob(), kekFingerprint(KEK), member.user_id]),
        member.user_id,
      ),
    ).rejects.toThrow();
    // 관리자는 새 판을 쌓고 꺼낼 수 있다. 구성원은 같은 판을 꺼내지 못한다
    const id = (
      await asShipper((q) =>
        q.query<{ id: string }>(
          `insert into fcd.wing_connections (org_id, version, supersedes_id, method, status, key_blob, kek_id, created_by) values ($1,$2,$3,'self_key','saved',$4,$5,$6) returning id`,
          [shipperOrg, cur.version + 1, cur.id, blob(), kekFingerprint(KEK), shipperUser],
        ),
      )
    )[0].id;
    expect((await asShipper((q) => q.query<{ b: string | null }>(`select fcd.wing_key_blob($1) b`, [id]), member.user_id))[0].b).toBeNull();
    expect((await asShipper((q) => q.query<{ b: string | null }>(`select fcd.wing_key_blob($1) b`, [id])))[0].b).not.toBeNull();
  });

  it('선적 화면의 입고 요청 한 줄 — 화주·맡은 물류사는 같은 번호를 보고, 남은 못 본다', async () => {
    const m = (await db.query<{ external_no: string; shipment_id: string }>(`select external_no, shipment_id from fcd.v_wing_matches_current where org_id = $1 and action = 'confirmed' limit 1`, [shipperOrg]))[0];
    const partnerUser = (
      await db.query<{ user_id: string }>(`select m.user_id from fcd.memberships m join fcd.shipments s on s.partner_org_id = m.org_id where s.id = $1 limit 1`, [m.shipment_id])
    )[0].user_id;
    const q1 = `select external_no from fcd.wing_inbound_for_shipment($1::uuid)`;
    expect((await asShipper((q) => q.query<{ external_no: string }>(q1, [m.shipment_id])))[0].external_no).toBe(m.external_no);
    expect((await asShipper((q) => q.query<{ external_no: string }>(q1, [m.shipment_id]), partnerUser))[0].external_no).toBe(m.external_no);
    expect(await asShipper((q) => q.query(q1, [m.shipment_id]), otherShipperUser)).toHaveLength(0);
  });

  it('예시 가져오기는 데모 시드와 같은 씨앗·같은 선적 고르기 — 다시 가져와도 번호가 늘지 않는다', () => {
    expect(DEMO_WING_SEED).toBe('fcd-demo-wing');
    const ships = [9, 2, 3, 9, 4, 5, 6, 9, 7, 9, 8].map((stage, i) => ({ id: `s${i}`, stage }));
    expect(demoWingHints(ships).map((s) => s.id)).toEqual(['s1', 's2', 's4', 's5', 's6', 's0', 's3', 's7']);
  });

  it('데모 숨김(DEMO_MODE 꺼짐)이면 데모 조직의 WING 자료도 안 보인다', async () => {
    const r = await asRole(db, 'fcd_user', shipperUser, false, (q) => q.query(`select 1 from fcd.v_wing_inbound_current`));
    expect(r).toHaveLength(0);
  });

  it('걷어내기: 데모의 WING 자료는 0, 실제 화주의 기록은 남는다', async () => {
    await asRole(db, 'fcd_user', REAL_USER, true, (q) =>
      q.query(`insert into fcd.wing_inbound_requests (org_id, source, batch_id, external_no, created_by) values ($1,'file',gen_random_uuid(),'REAL0001',$2)`, [REAL_SHIPPER, REAL_USER]),
    );
    await asRole(db, 'fcd_user', REAL_USER, true, (q) => q.query(`insert into fcd.wing_access_log (org_id, actor_id, action) values ($1,$2,'imported')`, [REAL_SHIPPER, REAL_USER]));
    const before = await db.transaction((tx) => demoCounts(tx));
    const plan = await db.transaction((tx) => planPurge(tx));
    await db.exec(buildPurgeSql(plan));
    const after = await db.transaction((tx) => demoCounts(tx));
    for (const t of ['wing_connections', 'wing_inbound_requests', 'wing_matches', 'wing_access_log']) {
      expect(after.find((c) => c.table === t)!.demo, t).toBe(0);
      expect(after.find((c) => c.table === t)!.real, t).toBe(before.find((c) => c.table === t)!.real);
    }
    const real = await db.query<{ n: number }>(`select count(*)::int n from fcd.wing_inbound_requests where org_id = $1`, [REAL_SHIPPER]);
    expect(real[0].n).toBe(1);
  });
});
