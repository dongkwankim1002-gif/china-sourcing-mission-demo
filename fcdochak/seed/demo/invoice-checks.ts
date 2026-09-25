/**
 * 데모 — 데모 화주(김서윤·리빙모아)가 보관한 청구서 점검 몇 건. 데모 조직 아래에만 들어가 걷어내기 한 번에 사라진다.
 * 결과는 방금 넣은 데모 요금표로 앱과 같은 함수(laneMarket → checkInvoice)를 돌려 만든다.
 */
import type { Driver } from '@/lib/db/driver';
import { checkInvoice, type Cargo, type InvoiceLine, type QuoteParams, type RateLine } from '@/lib/money';
import { laneMarket, parseInvoiceCheckRule } from '@/lib/invoice-market';
import { classifyItem } from '@/lib/invoice-parse';
import { STANDARD_CARGO, STANDARD_ROUTE } from '@/lib/standard-cargo';
import type { CheckOutcome } from '@/lib/invoice-check-input';
import { SETTINGS } from '../reference/data';

const setting = <T>(k: string) => SETTINGS.find((s) => s.key === k)!.value as T;
const DAY = 86_400_000;

type L = [label: string, amount: number, currency: InvoiceLine['currency']];
const lines = (ls: L[]): InvoiceLine[] => ls.map(([label, amount, currency]) => ({ label, amount, currency, segment: classifyItem(label) }));

const HANBADA_V1: L[] = [
  ['중국 내륙 집하', 350, 'RMB'],
  ['창고 입고·검수', 280, 'RMB'],
  ['수출 통관', 300, 'RMB'],
  ['LCL 해상운임', 412_000, 'KRW'],
  ['THC·CFS', 95_000, 'KRW'],
  ['관세사 통관수수료', 33_000, 'KRW'],
  ['관세', 360_000, 'KRW'],
  ['부가세', 486_000, 'KRW'],
];
const HANBADA_V2: L[] = [...HANBADA_V1, ['국내 창고 입고 작업', 48_000, 'KRW'], ['쿠팡 FC 입고 운송', 120_000, 'KRW']];

const QINGDAO: L[] = [
  ['픽업(청도 시내)', 400, 'RMB'],
  ['창고 작업·라벨', 300, 'RMB'],
  ['수출신고', 280, 'RMB'],
  ['카페리 운임', 210, 'USD'],
  ['유류할증료 BAF', 60, 'USD'],
  ['항만 부대비용', 85_000, 'KRW'],
  ['관세사 수수료', 33_000, 'KRW'],
  ['국내 창고 보관·입고', 39_000, 'KRW'],
  ['쿠팡 밀크런', 95_000, 'KRW'],
  ['포장 보강(추가)', 150, 'RMB'],
];

export async function seedDemoInvoiceChecks(db: Driver, opts: { today: string; now: number }) {
  const who = (
    await db.query<{ id: string; home_org_id: string }>(`select id, home_org_id from fcd.profiles where email = 'demo-shipper@fcdochak.example'`)
  )[0];
  if (!who) return 0;
  const fx = setting<QuoteParams['fx']>('fx');
  const quoteParams: QuoteParams = { fx, ...setting<Omit<QuoteParams, 'fx'>>('quote_params') };
  const referenceLines = setting<RateLine[]>('reference_lines');
  const rule = parseInvoiceCheckRule(setting('invoice_check_rule'));
  const names = await db.query<{ kind: string; code: string; name_ko: string }>(
    `select 'hub' kind, code, name_ko from fcd.hubs union all select 'port', code, name_ko from fcd.ports union all select 'mode', code, name_ko from fcd.modes`,
  );
  const nm = (k: string, c: string) => names.find((n) => n.kind === k && n.code === c)?.name_ko ?? c;
  const qingdaoCargo: Cargo = { units: 800, cartons: 30, kg: 480, cbm: 2.2, goodsValue: 15_000, goodsCurrency: 'RMB' };

  const plan: { title: string; hub: string; port: string; mode: string | null; cargo: Cargo; ls: L[]; daysAgo: number; supersedes?: number }[] = [
    { title: '한바다포워딩 9월 청구서', hub: STANDARD_ROUTE.hub, port: STANDARD_ROUTE.port, mode: 'LCL', cargo: STANDARD_CARGO, ls: HANBADA_V1, daysAgo: 6 },
    { title: '한바다포워딩 9월 청구서(수정본)', hub: STANDARD_ROUTE.hub, port: STANDARD_ROUTE.port, mode: 'LCL', cargo: STANDARD_CARGO, ls: HANBADA_V2, daysAgo: 4, supersedes: 0 },
    { title: '청도 카페리 견적서', hub: 'QDG', port: 'ICN', mode: 'FERRY', cargo: qingdaoCargo, ls: QINGDAO, daysAgo: 2 },
  ];
  const ids: string[] = [];
  await db.transaction(async (q) => {
    for (const [i, p] of plan.entries()) {
      const ls = lines(p.ls);
      const m = await laneMarket(q, { hub: p.hub, port: p.port, mode: p.mode, cargo: p.cargo }, { quoteParams, referenceLines, rule, today: opts.today, demoMode: true });
      const result = checkInvoice({ lines: ls, fx, benchmarks: m.benchmarks, market: m.market, rule });
      const outcome: CheckOutcome = {
        result,
        lane: { hub: p.hub, port: p.port, mode: p.mode, hubName: nm('hub', p.hub), portName: nm('port', p.port), modeName: p.mode ? nm('mode', p.mode) : '방식 상관없음' },
        cargo: p.cargo,
        fx: { RMB: fx.RMB, USD: fx.USD },
      };
      const sup = p.supersedes != null ? ids[p.supersedes] : null;
      const r = await q.query<{ id: string }>(
        `insert into fcd.invoice_checks (org_id, user_id, version, supersedes_id, title, origin_hub, port, mode, cargo, lines, result,
           invoice_total, market_median, over_median_bp, high_count, missing_count, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17::timestamptz) returning id`,
        [
          who.home_org_id,
          who.id,
          sup ? 2 : 1,
          sup,
          p.title,
          p.hub,
          p.port,
          p.mode,
          JSON.stringify(p.cargo),
          JSON.stringify(ls),
          JSON.stringify(outcome),
          result.invoiceTotal,
          result.market.median,
          result.market.overMedianBp,
          result.counts.high,
          result.counts.missing,
          new Date(opts.now - p.daysAgo * DAY).toISOString(),
        ],
      );
      ids[i] = r[0].id;
    }
  });
  return ids.length;
}
