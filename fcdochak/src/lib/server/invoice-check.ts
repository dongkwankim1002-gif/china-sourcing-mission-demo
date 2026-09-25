import 'server-only';
/**
 * 청구서 점검 — 서버 쪽.
 *   runInvoiceCheck  구간 시세(요금표 분포)를 셀러 화물로 계산해 비교. 비공개 요금표까지 쓰므로 asSystem 이지만
 *                    내보내는 것은 구간별 집계 숫자뿐이고, 표본이 기준보다 적으면 참고치로 바꿔 최저를 싣지 않는다.
 *   saveInvoiceCheck 로그인한 화주가 보관 — asUser(RLS: 본인만, 새 판만).
 */
import { asSystem, asUser, todayKst, type Actor, type Queryable } from '../db';
import { env } from '../env';
import { checkInvoice, type InvoiceCheckRule } from '../money';
import { laneMarket, parseInvoiceCheckRule } from '../invoice-market';
import { cargoOf, type CheckInputT, type CheckOutcome } from '../invoice-check-input';
import { loadSettings } from './settings';

export async function loadCheckRule(q: Queryable): Promise<InvoiceCheckRule> {
  const r = await q.query<{ value: unknown }>(`select value from fcd.v_current_settings where key = 'invoice_check_rule'`);
  return parseInvoiceCheckRule(r[0]?.value);
}

export async function runInvoiceCheck(input: CheckInputT): Promise<CheckOutcome> {
  const mode = input.mode === 'ANY' ? null : input.mode;
  const cargo = cargoOf(input);
  return asSystem(async (q) => {
    const [s, rule] = await Promise.all([loadSettings(q), loadCheckRule(q)]);
    const m = await laneMarket(q, { hub: input.hub, port: input.port, mode, cargo }, {
      quoteParams: s.quoteParams,
      referenceLines: s.referenceLines,
      rule,
      today: todayKst(),
      demoMode: env.demoMode,
    });
    const names = await q.query<{ kind: string; code: string; name_ko: string }>(
      `select 'hub' kind, code, name_ko from fcd.hubs where code = $1
       union all select 'port', code, name_ko from fcd.ports where code = $2
       union all select 'mode', code, name_ko from fcd.modes where code = $3`,
      [input.hub, input.port, mode],
    );
    const nm = (k: string, fallback: string) => names.find((n) => n.kind === k)?.name_ko ?? fallback;
    const result = checkInvoice({ lines: input.lines, fx: s.fx, benchmarks: m.benchmarks, market: m.market, rule });
    return {
      result,
      lane: { hub: input.hub, port: input.port, mode, hubName: nm('hub', input.hub), portName: nm('port', input.port), modeName: mode ? nm('mode', mode) : '방식 상관없음' },
      cargo,
      fx: { RMB: s.fx.RMB, USD: s.fx.USD },
    };
  });
}

export interface SavedCheckRow {
  id: string;
  version: number;
  supersedes_id: string | null;
  title: string;
  origin_hub: string;
  port: string;
  mode: string | null;
  invoice_total: number;
  market_median: number | null;
  over_median_bp: number | null;
  high_count: number;
  missing_count: number;
  created_at: string;
}

export interface SavedCheck extends SavedCheckRow {
  cargo: CheckOutcome['cargo'];
  lines: CheckInputT['lines'];
  result: CheckOutcome;
  /** 이 판 뒤에 새 판이 있으면 그 id */
  newer_id: string | null;
}

export function checkTitle(input: Pick<CheckInputT, 'title'>, o: CheckOutcome) {
  return (input.title?.trim() || `${o.lane.hubName}→${o.lane.portName} 청구서 점검`).slice(0, 80);
}

export async function saveInvoiceCheck(actor: Actor, orgId: string, input: CheckInputT, supersedesId: string | null) {
  const outcome = await runInvoiceCheck(input);
  return asUser(actor, async (q) => {
    let version = 1;
    if (supersedesId) {
      const prev = await q.query<{ version: number; has_next: boolean }>(
        `select version, exists (select 1 from fcd.invoice_checks n where n.supersedes_id = c.id) has_next from fcd.invoice_checks c where id = $1`,
        [supersedesId],
      );
      if (!prev[0]) throw new Error('이전 점검을 찾지 못했습니다');
      if (prev[0].has_next) throw new Error('이 점검에는 이미 새 판이 있습니다. 목록에서 최신 판을 열어 다시 점검해 주세요.');
      version = prev[0].version + 1;
    }
    const r = await q.query<{ id: string }>(
      `insert into fcd.invoice_checks (org_id, user_id, version, supersedes_id, title, origin_hub, port, mode, cargo, lines, result,
         invoice_total, market_median, over_median_bp, high_count, missing_count)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16) returning id`,
      [
        orgId,
        actor.id,
        version,
        supersedesId,
        checkTitle(input, outcome),
        input.hub,
        input.port,
        outcome.lane.mode,
        JSON.stringify(outcome.cargo),
        JSON.stringify(input.lines),
        JSON.stringify(outcome),
        outcome.result.invoiceTotal,
        outcome.result.market.median,
        outcome.result.market.overMedianBp,
        outcome.result.counts.high,
        outcome.result.counts.missing,
      ],
    );
    return { id: r[0].id, outcome };
  });
}

/** 내 점검 목록 — 최신 판만 */
export async function listMyChecks(actor: Actor): Promise<SavedCheckRow[]> {
  return asUser(actor, (q) =>
    q.query<SavedCheckRow>(
      `select id, version, supersedes_id, title, origin_hub, port, mode, invoice_total, market_median, over_median_bp, high_count, missing_count, created_at
         from fcd.v_invoice_checks_current where user_id = $1 order by created_at desc limit 200`,
      [actor.id],
    ),
  );
}

export async function getMyCheck(actor: Actor, id: string): Promise<SavedCheck | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return asUser(actor, async (q) => {
    const r = await q.query<SavedCheck>(
      `select c.id, c.version, c.supersedes_id, c.title, c.origin_hub, c.port, c.mode, c.invoice_total, c.market_median, c.over_median_bp, c.high_count, c.missing_count,
              c.created_at, c.cargo, c.lines, c.result,
              (select n.id from fcd.invoice_checks n where n.supersedes_id = c.id) newer_id
         from fcd.invoice_checks c where c.id = $1 and c.user_id = $2`,
      [id, actor.id],
    );
    return r[0] ?? null;
  });
}
