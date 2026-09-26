/**
 * 데모 시드 — 원스톱 대행형 구역(v2 4차 onestop, 미리보기). 조금만:
 *   · 데모 화주(리빙모아) 주문 셋 — ① 접수만 ② 사입 대행 · 대금 확인 → 중국 창고 입고 → 검품 + 실측 새 판 + 문제 기록 한 줄
 *     ③ 바코드까지 남기고 그 화주의 출항한 선적과 이음(출항·통관·FC 입고는 선적 단계를 따라감)
 *   · 다른 데모 화주 한 곳에 작은 주문 하나(최소 요금 적용 · 조직별로 갈리는지 보이게)
 * 견적 기록은 플랫폼 참고치로 셈한다(by: 'seed'). 모두 is_demo 조직 아래라 걷어내기(조직 삭제) 한 번에 CASCADE 로 사라진다.
 */
import type { Queryable } from '@/lib/db/driver';
import { buildOnestopSnapshot, orderCargo, referenceNine, type OnestopOrderInput } from '@/lib/onestop/snapshot';
import type { OnestopTariff } from '@/lib/onestop/settings';
import type { QuoteParams } from '@/lib/money';
import { DUTY_RATES, ONESTOP_SETTINGS, REFERENCE_LINES, SETTINGS } from '../reference/data';

const DAY = 86_400_000;

export async function seedOnestopDemo(q: Queryable, opts: { now: number; shipperEmail: string; adminEmail: string; onlyIfEmpty?: boolean }) {
  const me = (
    await q.query<{ user_id: string; org_id: string }>(
      `select p.id user_id, p.home_org_id org_id from fcd.profiles p join fcd.orgs o on o.id = p.home_org_id where lower(p.email) = $1 and o.is_demo`,
      [opts.shipperEmail.toLowerCase()],
    )
  )[0];
  const admin = (await q.query<{ id: string }>(`select id from fcd.profiles where lower(email) = $1`, [opts.adminEmail.toLowerCase()]))[0];
  if (!me || !admin) return 0;
  if (opts.onlyIfEmpty && (await q.query<{ n: number }>(`select count(*)::int n from fcd.onestop_orders r join fcd.orgs o on o.id = r.org_id where o.is_demo`))[0].n > 0) return 0;
  const tariff = ONESTOP_SETTINGS.find((s) => s.key === 'onestop.tariff')!.value as OnestopTariff;
  const fx = SETTINGS.find((s) => s.key === 'fx')!.value as Record<'KRW' | 'RMB' | 'USD', number>;
  const qp = SETTINGS.find((s) => s.key === 'quote_params')!.value as Omit<QuoteParams, 'fx'>;
  const vat = SETTINGS.find((s) => s.key === 'vat_rate_bp')!.value as number;
  const ins = SETTINGS.find((s) => s.key === 'insurance_bp')!.value as number;
  const params: QuoteParams = { fx, ...qp };
  const ts = (ms: number) => new Date(ms).toISOString();

  const other = (
    await q.query<{ user_id: string; org_id: string }>(
      `select m.user_id, m.org_id from fcd.memberships m join fcd.orgs o on o.id = m.org_id
        where o.is_demo and o.kind = 'shipper' and o.id <> $1 order by o.name, m.user_id limit 1`,
      [me.org_id],
    )
  )[0];
  // 이을 선적 — 데모 화주의 출항한(5단계 이상) 선적 하나
  const ship = (
    await q.query<{ id: string; stage: number }>(`select id, stage::int stage from fcd.shipments where shipper_org_id = $1 and stage between 5 and 8 order by created_at desc limit 1`, [me.org_id])
  )[0];

  const snap = (i: OnestopOrderInput) => {
    const port = tariff.lanes.find((l) => l.hub === i.hub && l.mode === i.mode)!.port;
    const nine = referenceNine(REFERENCE_LINES, orderCargo(i), params);
    const duty = DUTY_RATES.find((d) => d.category === i.category)?.rate_bp ?? 800;
    const r = buildOnestopSnapshot({ by: 'seed', tariff, fx, input: i, nine: { basis: 'reference', offers: 0, total: nine.total, toPort: nine.toPort }, dutyRateBp: duty, vatRateBp: vat, insuranceBp: ins });
    if (!r.ok) throw new Error(`원스톱 데모 견적 실패: ${r.error}`);
    return { port, snap: r.snap };
  };

  let n = 0;
  const insert = async (x: {
    no: string; org: string; by: string; version: number; root: string | null; sup: string | null; name: string; url: string | null; input: OnestopOrderInput;
    shipment: string | null; measured: boolean; note: string | null; change: string | null; at: number;
  }) => {
    const { port, snap: s } = snap(x.input);
    const i = x.input;
    const r = await q.query<{ id: string }>(
      `insert into fcd.onestop_orders (order_no, org_id, created_by, version, root_id, supersedes_id, product_name, category, source_url, units, cartons, cbm, kg, unit_price, currency,
         hub, mode, port, fc_code, purchase, barcode, inspection, quote, total_krw, shipment_id, measured, preview, note, change_note, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24,$25,$26,true,$27,$28,$29::timestamptz) returning id`,
      [
        x.no, x.org, x.by, x.version, x.root, x.sup, x.name, i.category, x.url, i.units, i.cartons, i.cbm, i.kg, i.unitPrice, i.currency,
        i.hub, i.mode, port, i.fc, i.purchase, i.barcode, i.inspection, JSON.stringify(s), s.total, x.shipment, x.measured, x.note, x.change, ts(x.at),
      ],
    );
    if (x.version === 1) n++;
    return r[0].id;
  };
  const event = (order: string, org: string, stage: string, at: number, note: string | null = null) =>
    q.query(`insert into fcd.onestop_order_events (order_id, org_id, stage, note, occurred_at, actor_id, created_at) values ($1,$2,$3,$4,$5::timestamptz,$6,$5::timestamptz)`, [order, org, stage, note, ts(at), admin.id]);

  const base = (o: Partial<OnestopOrderInput>): OnestopOrderInput => ({
    hub: 'YIW', mode: 'LCL', fc: 'FC-ICH', units: 300, cartons: 10, cbm: 0.8, kg: 140, unitPrice: null, currency: 'RMB', category: 'general',
    purchase: false, barcode: true, inspection: 'basic', ...o,
  });

  // ① 접수만(어제)
  await insert({ no: 'OS-EX-0001', org: me.org_id, by: me.user_id, version: 1, root: null, sup: null, name: '실리콘 냄비받침(예시)', url: null,
    input: base({ units: 400, cartons: 8, cbm: 0.6, kg: 96 }), shipment: null, measured: false, note: '색상 두 가지 반씩(예시)', change: null, at: opts.now - 1 * DAY });

  // ② 사입 대행 — 대금 확인 → 중국 창고 입고(실측 새 판) → 검품, 문제 기록 한 줄
  const at2 = opts.now - 9 * DAY;
  const in2 = base({ units: 600, cartons: 15, cbm: 1.1, kg: 210, unitPrice: 9.8, category: 'kitchen', purchase: true, inspection: 'full' });
  const r2 = await insert({ no: 'OS-EX-0002', org: me.org_id, by: me.user_id, version: 1, root: null, sup: null, name: '스테인리스 계량컵 세트(예시)', url: 'https://example.com/item/0002',
    input: in2, shipment: null, measured: false, note: null, change: null, at: at2 });
  await event(r2, me.org_id, 'payment_confirmed', at2 + 1 * DAY, '예시 — 셀러 송금 확인(미리보기라 실제 대금은 없음)');
  await event(r2, me.org_id, 'factory_received', at2 + 5 * DAY, '15박스 입고');
  await insert({ no: 'OS-EX-0002', org: me.org_id, by: admin.id, version: 2, root: r2, sup: r2, name: '스테인리스 계량컵 세트(예시)', url: 'https://example.com/item/0002',
    input: { ...in2, cbm: 1.26, kg: 228 }, shipment: null, measured: true, note: null, change: '중국 창고 입고 실측 1.26 CBM · 228 kg(예시)', at: at2 + 5 * DAY + 3600_000 });
  await event(r2, me.org_id, 'issue', at2 + 6 * DAY, '예시 — 2개 찌그러짐, 공장에 교환 요청');
  await event(r2, me.org_id, 'inspected', at2 + 7 * DAY, '정밀 검품 끝 · 불량 2개 교환 완료');

  // ③ 바코드까지 + 출항한 선적과 이음
  const at3 = opts.now - 20 * DAY;
  const in3 = base({ hub: 'QDG', mode: 'LCL', units: 1200, cartons: 30, cbm: 2.4, kg: 420, unitPrice: 4.5 });
  const r3 = await insert({ no: 'OS-EX-0003', org: me.org_id, by: me.user_id, version: 1, root: null, sup: null, name: '접이식 수납 바구니(예시)', url: null,
    input: in3, shipment: null, measured: false, note: null, change: null, at: at3 });
  await event(r3, me.org_id, 'payment_confirmed', at3 + 1 * DAY);
  await event(r3, me.org_id, 'factory_received', at3 + 4 * DAY);
  await event(r3, me.org_id, 'inspected', at3 + 5 * DAY);
  await event(r3, me.org_id, 'barcoded', at3 + 6 * DAY);
  if (ship) {
    await insert({ no: 'OS-EX-0003', org: me.org_id, by: admin.id, version: 2, root: r3, sup: r3, name: '접이식 수납 바구니(예시)', url: null,
      input: in3, shipment: ship.id, measured: false, note: null, change: '혼적 회차 선적과 이음(예시)', at: at3 + 7 * DAY });
  } else {
    await event(r3, me.org_id, 'departed', at3 + 8 * DAY, '예시 — 이을 선적이 없어 단계만 남김');
  }

  // 다른 데모 화주 — 작은 주문(최소 요금 적용)
  if (other) {
    await insert({ no: 'OS-EX-0004', org: other.org_id, by: other.user_id, version: 1, root: null, sup: null, name: '어린이 물병 스티커(예시)', url: null,
      input: base({ hub: 'CAN', units: 200, cartons: 2, cbm: 0.15, kg: 20, category: 'toys', barcode: false, inspection: 'none' }), shipment: null, measured: false, note: null, change: null, at: opts.now - 3 * DAY });
  }
  return n;
}
