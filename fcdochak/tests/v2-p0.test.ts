/**
 * v2 p0 — 신뢰 버그 열 가지의 순수 함수·쿼리 시험.
 * 화면 흐름(데모 메뉴·H1 이름·띠)은 e2e/v2-p0.spec.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Driver } from '@/lib/db/driver';
import { seedDemo } from '@seed/demo';
import { STANDARD_CARGO, STANDARD_ROUTE, cargoSummaryText } from '@/lib/standard-cargo';
import { DEFAULT_INPUT } from '@/lib/calc-defaults';
import { parseCargoQuery, toCargo } from '@/lib/cargo-params';
import { completeWithReference, computeQuote, totalsBreakdown, type QuoteParams, type RateLine } from '@/lib/money';
import { isRelated, parseSortKey, rankOffers, sortOffers, topTitle, type Rankable } from '@/lib/ranking';
import { buildQuoteResponse, parsePublicSort } from '@/lib/public-quote';
import { formatBarValue, nineBarSummary } from '@/lib/nine-summary';
import { notFuture } from '@/lib/format';
import { queryPublicReviews } from '@/lib/reviews-query';
import { env } from '@/lib/env';
import { asRole, hazardDb, todayKst } from './helpers';

const root = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f.name) && !f.name.endsWith('.generated.ts')) out.push(p);
  }
  return out;
}

describe('① 기준 화물 하나로', () => {
  it('계산기 첫 값 = 공표 기준 화물(STANDARD_CARGO)', () => {
    expect(DEFAULT_INPUT).toMatchObject({
      hub: STANDARD_ROUTE.hub,
      port: STANDARD_ROUTE.port,
      fc: STANDARD_ROUTE.fc,
      units: STANDARD_CARGO.units,
      cartons: STANDARD_CARGO.cartons,
      kg: STANDARD_CARGO.kg,
      cbm: STANDARD_CARGO.cbm,
      goods: STANDARD_CARGO.goodsValue,
      cur: STANDARD_CARGO.goodsCurrency,
    });
    expect(STANDARD_CARGO).toEqual({ units: 1200, cartons: 40, kg: 650, cbm: 3, goodsValue: 24000, goodsCurrency: 'RMB' });
  });
  it('URL 이 비었을 때 기본값도 같은 기준 화물', () => {
    expect(toCargo(parseCargoQuery({}))).toEqual(STANDARD_CARGO);
    expect(toCargo(parseCargoQuery(new URLSearchParams('kg=abc')))).toEqual(STANDARD_CARGO);
  });
  it('조건 요약 글', () => {
    expect(cargoSummaryText(STANDARD_CARGO)).toBe('1,200개 · 40박스 · 650 kg · 3 CBM · 물품가 24,000 RMB');
  });
  it('앱 코드에 옛 기본값(820 kg · 3.6 CBM · 36,000 RMB)이나 따로 박은 기준 화물이 없다', () => {
    const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'seed'))];
    const bad: string[] = [];
    for (const f of files) {
      const s = fs.readFileSync(f, 'utf8');
      if (/kg:\s*820\b|cbm:\s*3\.6\b|default\((820|3\.6|36000)\)/.test(s)) bad.push(path.relative(root, f));
      // 기준 화물 상수는 standard-cargo.ts 한 곳에서만 정의한다
      if (/const\s+STANDARD_CARGO\b/.test(s) && !f.endsWith(path.join('lib', 'standard-cargo.ts'))) bad.push(path.relative(root, f));
    }
    expect(bad).toEqual([]);
  });
});

describe('② 「상위 N곳」 제목', () => {
  it('실제 개수에 따라', () => {
    expect(topTitle(5)).toBe('상위 5곳 총액');
    expect(topTitle(3)).toBe('상위 3곳 총액');
    expect(topTitle(1)).toBe('맞는 1곳 총액');
    expect(topTitle(0)).toBe('맞는 업체 없음');
  });
});

describe('③ 미래 날짜 후기', () => {
  let db: Driver;
  const today = todayKst();
  beforeAll(async () => {
    db = await hazardDb();
    await seedDemo(db, { today, password: 'test-only-password' });
  });
  afterAll(async () => {
    await db.close();
  });

  it('데모 시드 후기에 오늘(KST) 이후 날짜가 없다', async () => {
    const r = await db.query<{ n: number; future: number }>(
      `select count(*)::int n,
              count(*) filter (where created_at >= (($1::date + 1)::timestamp at time zone 'Asia/Seoul') or created_at > now())::int future
         from fcd.reviews`,
      [today],
    );
    expect(r[0].n).toBeGreaterThan(20);
    expect(r[0].future).toBe(0);
  });

  it('공개 후기 쿼리는 미래 날짜 후기를 싣지 않는다', async () => {
    const ship = (
      await db.query<{ id: string; shipper_org_id: string; partner_org_id: string }>(
        `select s.id, s.shipper_org_id, s.partner_org_id from fcd.shipments s join fcd.orgs o on o.id = s.partner_org_id
          where s.stage = 9 and o.status = 'official' and not exists (select 1 from fcd.reviews r where r.shipment_id = s.id) limit 1`,
      )
    )[0];
    expect(ship).toBeTruthy();
    await db.query(
      `insert into fcd.reviews (shipment_id, shipper_org_id, partner_org_id, rating, on_time_ok, billing_ok, body, author_label, created_at)
       values ($1,$2,$3,5,true,true,$4,'시험 셀러', now() + interval '3 days')`,
      [ship.id, ship.shipper_org_id, ship.partner_org_id, '미래 날짜로 들어간 시험 후기입니다. 이 문장은 공개 목록에 보이면 안 됩니다.'],
    );
    const list = await asRole(db, 'fcd_public', null, true, (q) => queryPublicReviews(q, { limit: 500, today }));
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((x) => x.body.startsWith('미래 날짜로'))).toBe(false);
    const end = Date.parse(`${today}T00:00:00+09:00`) + 86_400_000;
    for (const x of list) expect(new Date(x.created_at).getTime()).toBeLessThan(end);
    // 업체 하나만 볼 때도
    const one = await asRole(db, 'fcd_public', null, true, (q) => queryPublicReviews(q, { limit: 50, partnerId: ship.partner_org_id, today }));
    expect(one.some((x) => x.body.startsWith('미래 날짜로'))).toBe(false);
  });

  it('화면 쪽 한 번 더 — notFuture', () => {
    const rows = [
      { id: 'a', created_at: '2026-09-25T14:59:59.000Z' }, // KST 9/25 23:59:59
      { id: 'b', created_at: '2026-09-25T15:00:00.000Z' }, // KST 9/26 00:00
      { id: 'c', created_at: new Date('2026-09-01T00:00:00Z') },
      { id: 'd', created_at: 'not-a-date' },
    ];
    expect(notFuture(rows, '2026-09-25').map((r) => r.id)).toEqual(['a', 'c']);
  });
});

describe('⑥ 9구간 막대 대체 글 — 짧은 요약 + 표', () => {
  const segs = [
    { segment: 'pickup' as const, amount: 42000, certainty: 'confirmed' as const },
    { segment: 'cn_warehouse' as const, amount: 36000, certainty: 'confirmed' as const },
    { segment: 'export_customs' as const, amount: 55000, certainty: 'estimated' as const },
    { segment: 'freight' as const, amount: 412000, certainty: 'estimated' as const },
    { segment: 'port' as const, amount: 98000, certainty: 'extra_possible' as const },
    { segment: 'broker' as const, amount: 33000, certainty: 'confirmed' as const, filled: true },
    { segment: 'kr_warehouse' as const, amount: null, certainty: null },
    { segment: 'fc_delivery' as const, amount: 120000, certainty: 'confirmed' as const },
    { segment: 'return_reserve' as const, amount: 0, certainty: null },
  ];
  it('합계·가장 큰 구간·칸 수만 한 문장으로(구간 아홉 개를 늘어놓지 않는다)', () => {
    const s = nineBarSummary(segs);
    expect(s).toContain('9구간 합계 796,000원');
    expect(s).toContain('가장 큰 구간 국제운송 52%');
    expect(s).toContain('확정 3칸 · 예상 3칸 · 참고치 1칸 · 제외 2칸');
    expect(s.length).toBeLessThan(120);
    expect(s).not.toContain('집하');
  });
  it('비로그인 천분율은 %로, 금액처럼 읽히지 않게', () => {
    const permille = segs.map((x) => ({ ...x, amount: x.amount == null ? null : Math.round((x.amount / 796000) * 1000) }));
    const s = nineBarSummary(permille, { unit: 'permille', label: '가장 낮은 곳' });
    expect(s.startsWith('가장 낮은 곳. 9구간 비중')).toBe(true);
    expect(s).not.toMatch(/\d원/);
    expect(formatBarValue(518, 'permille')).toBe('51.8%');
    expect(formatBarValue(500, 'permille')).toBe('50%');
    expect(formatBarValue(12345, 'won')).toBe('12,345원');
  });
  it('중국어', () => {
    expect(nineBarSummary(segs, { locale: 'zh' })).toContain('合计 796,000韩元');
  });
});

const P: QuoteParams = { fx: { KRW: 1, RMB: 190.5, USD: 1380 }, volumetricKgPerCbm: 167, palletCbm: 1.5, containerCbm: 28 };

describe('⑦ 확정 합계와 참고치 포함 합계', () => {
  const lines: RateLine[] = [
    { segment: 'pickup', included: true, basis: 'per_cbm', unitPrice: 40, currency: 'RMB', certainty: 'confirmed' },
    { segment: 'freight', included: true, basis: 'per_cbm', unitPrice: 60000, currency: 'KRW', certainty: 'estimated' },
    { segment: 'port', included: true, basis: 'per_shipment', unitPrice: 50000, currency: 'KRW', certainty: 'extra_possible' },
    { segment: 'fc_delivery', included: true, basis: 'per_carton', unitPrice: 2500, currency: 'KRW', certainty: 'confirmed' },
  ];
  const raw = computeQuote(lines, STANDARD_CARGO, P);
  const full = completeWithReference(raw, { broker: 33000, kr_warehouse: 70000, cn_warehouse: 20000 }, STANDARD_CARGO.units);

  it('확정 + 예상 + 참고치 = 참고치 포함 합계 = QuoteResult.total', () => {
    const t = totalsBreakdown(full.segments);
    // 집하 3 CBM × 40 RMB × 190.5 = 22,860 · FC 운송 40박스 × 2,500 = 100,000
    expect(t.confirmed).toBe(22860 + 100000);
    expect(t.estimated).toBe(180000 + 50000);
    expect(t.reference).toBe(33000 + 70000 + 20000);
    expect(t.referenceCount).toBe(3);
    expect(t.partnerTotal).toBe(t.confirmed + t.estimated);
    expect(t.withReference).toBe(full.total);
    expect(t.confirmed).toBe(full.confirmedTotal);
  });
  it('참고치가 없으면 두 합계의 차이는 예상 칸뿐', () => {
    const t = totalsBreakdown(raw.segments);
    expect(t.reference).toBe(0);
    expect(t.withReference).toBe(raw.total);
  });
  it('원 단위 정수가 아니면 거절', () => {
    expect(() => totalsBreakdown([{ amount: 1.5, certainty: 'confirmed', filled: false }])).toThrow(RangeError);
  });
});

type Fake = Rankable & { id: string };
const mk = (id: string, total: number, score: number, related: string | null = null): Fake => ({
  id,
  score,
  quote: { total },
  transit: [5, 8],
  metrics: null,
  partner: { related_party_note: related },
});

describe('⑧ 정렬 기준 토글', () => {
  const list = [mk('a', 300, 90), mk('b', 100, 60), mk('c', 200, 75)];
  it('가격순 / 추천 점수순', () => {
    expect(sortOffers(list, 'cheapest').map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(sortOffers(list, 'recommend').map((x) => x.id)).toEqual(['a', 'c', 'b']);
    expect(list.map((x) => x.id)).toEqual(['a', 'b', 'c']); // 원본은 그대로
  });
  it('모르는 값은 기본값', () => {
    expect(parseSortKey('cheapest', 'recommend')).toBe('cheapest');
    expect(parseSortKey('hack', 'recommend')).toBe('recommend');
    expect(parsePublicSort('recommend')).toBe('recommend');
    expect(parsePublicSort('fastest')).toBe('cheapest');
    expect(parsePublicSort(null)).toBe('cheapest');
  });
});

describe('⑨ 특수관계 업체', () => {
  const list = [mk('rel', 90, 95, '운영사 임원 가족 지분 20%'), mk('b', 100, 60), mk('c', 200, 75), mk('blank', 50, 10, '  ')];
  it('기본은 순위에서 뺀다', () => {
    const r = rankOffers(list, { sort: 'cheapest', includeRelated: false });
    expect(r.list.map((x) => x.id)).toEqual(['blank', 'b', 'c']);
    expect(r.relatedHidden).toBe(1);
    expect(r.relatedTop).toBe(false);
    expect(isRelated(mk('x', 1, 1, '  '))).toBe(false);
  });
  it('포함을 켜면 넣고, 1위가 특수관계면 경고', () => {
    const r = rankOffers(list, { sort: 'recommend', includeRelated: true });
    expect(r.list[0].id).toBe('rel');
    expect(r.relatedTop).toBe(true);
    expect(r.relatedHidden).toBe(0);
    expect(r.relatedShown).toBe(1);
    const cheap = rankOffers(list, { sort: 'cheapest', includeRelated: true });
    expect(cheap.list[0].id).toBe('blank');
    expect(cheap.relatedTop).toBe(false);
  });
  it('공개 계산기 응답도 같은 규칙 — 개수·경고·천분율', () => {
    const seg = (amount: number) => [{ segment: 'freight' as const, included: true, amount, certainty: 'confirmed' as const, basis: null, qty: null, discountBp: 0, minApplied: false, filled: false }];
    const offer = (id: string, total: number, score: number, related: string | null) => ({
      ...mk(id, total, score, related),
      mode: 'LCL',
      partner: { id, name: id, name_zh: null, slug: id, status: 'official', business_type: null, logo_path: null, related_party_note: related, is_demo: true },
      quote: { segments: seg(total), total, confirmedTotal: total, estimatedTotal: 0, extraPossible: [], excluded: [], filled: [], perUnit: Math.round(total / 10) },
    });
    const result = { offers: [offer('rel', 90, 95, '특수관계 공개'), offer('b', 100, 60, null)], excluded: [], verdicts: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const off = buildQuoteResponse(result as any, { sort: 'cheapest', includeRelated: false, detail: false });
    expect(off.top.map((t) => t.name)).toEqual(['b']);
    expect(off.count).toBe(1);
    expect(off.relatedHidden).toBe(1);
    expect(off.relatedTop).toBe(false);
    expect(off.barUnit).toBe('permille');
    expect(off.bar?.[0].amount).toBe(1000);
    expect(off.top[0].totals.confirmed).toBe(100);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const on = buildQuoteResponse(result as any, { sort: 'cheapest', includeRelated: true, detail: true });
    expect(on.top.map((t) => t.name)).toEqual(['rel', 'b']);
    expect(on.relatedTop).toBe(true);
    expect(on.top[0].relatedNote).toBe('특수관계 공개');
    expect(on.bar?.[0].amount).toBe(90);
  });
});

describe('⑩ 미리보기 띠', () => {
  it('PREVIEW_BANNER 가 있을 때만', () => {
    const old = process.env.PREVIEW_BANNER;
    try {
      delete process.env.PREVIEW_BANNER;
      expect(env.previewBanner).toBeNull();
      process.env.PREVIEW_BANNER = '  ';
      expect(env.previewBanner).toBeNull();
      process.env.PREVIEW_BANNER = 'v2';
      expect(env.previewBanner).toBe('v2');
    } finally {
      if (old == null) delete process.env.PREVIEW_BANNER;
      else process.env.PREVIEW_BANNER = old;
    }
  });
});
