import 'server-only';
/** 요금표 쓰기 — 늘 새 줄(새 판)로. 고치거나 지우지 않는다. */
import { randomBytes } from 'node:crypto';
import type { Queryable } from '../db';
import type { RateCardInputT } from '../schemas';

export function newNo(prefix: string) {
  const d = new Date(Date.now() + 9 * 3600_000).toISOString();
  return `${prefix}-${d.slice(2, 4)}${d.slice(5, 7)}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function insertRateCard(
  q: Queryable,
  orgId: string,
  c: RateCardInputT,
  actorId: string | null,
  prev?: { id: string; card_no: string; version: number } | null,
  changeNote?: string,
): Promise<string> {
  const rows = await q.query<{ id: string }>(
    `insert into fcd.rate_cards (org_id, card_no, version, supersedes_id, origin_hub, port, mode, valid_from, valid_to, certainty,
       fuel_surcharge_separate, is_public_price, transit_days_min, transit_days_max, status, change_note, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10,$11,$12,$13,$14,'active',$15,$16) returning id`,
    [
      orgId,
      prev?.card_no ?? newNo('RC'),
      prev ? prev.version + 1 : 1,
      prev?.id ?? null,
      c.hub,
      c.port,
      c.mode,
      c.validFrom,
      c.validTo,
      c.certainty,
      c.fuelSeparate,
      c.isPublicPrice,
      c.transitMin,
      c.transitMax,
      changeNote ?? c.note ?? (prev ? '새 판' : '첫 등록'),
      actorId,
    ],
  );
  const id = rows[0].id;
  for (const l of c.lines) {
    await q.query(
      `insert into fcd.rate_card_lines (rate_card_id, segment, included, basis, unit_price, currency, min_charge, certainty) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, l.segment, !!l.included, l.basis, l.unitPrice ?? 0, l.currency, l.minCharge, l.certainty],
    );
  }
  for (const t of c.tiers ?? []) {
    await q.query(`insert into fcd.rate_card_tiers (rate_card_id, segment, min_qty, discount_bp) values ($1,'freight',$2,$3)`, [id, t.minQty, t.discountBp]);
  }
  return id;
}

/** 현재 판을 그대로 옮기되 바꿀 칸만 바꾼 새 판 — 연장·만료·거두기 */
export async function reviseRateCard(
  q: Queryable,
  cardId: string,
  actorId: string,
  change: { validTo?: string; status?: 'active' | 'withdrawn'; note: string },
): Promise<string> {
  const cur = (
    await q.query<Record<string, unknown> & { id: string; card_no: string; version: number }>(
      `select * from fcd.v_rate_cards_current where id = $1`,
      [cardId],
    )
  )[0];
  if (!cur) throw new Error('현재 판이 아닙니다. 새로 고친 뒤 다시 시도하세요.');
  const rows = await q.query<{ id: string }>(
    `insert into fcd.rate_cards (org_id, card_no, version, supersedes_id, origin_hub, port, mode, valid_from, valid_to, certainty,
       fuel_surcharge_separate, is_public_price, transit_days_min, transit_days_max, status, change_note, created_by)
     select org_id, card_no, version + 1, id, origin_hub, port, mode,
            least(valid_from, coalesce($2::date, valid_to)), coalesce($2::date, valid_to), certainty,
            fuel_surcharge_separate, is_public_price, transit_days_min, transit_days_max, coalesce($3, status), $4, $5
       from fcd.rate_cards where id = $1 returning id`,
    [cardId, change.validTo ?? null, change.status ?? null, change.note, actorId],
  );
  const id = rows[0].id;
  await q.query(
    `insert into fcd.rate_card_lines (rate_card_id, segment, included, basis, unit_price, currency, min_charge, certainty, note)
     select $2, segment, included, basis, unit_price, currency, min_charge, certainty, note from fcd.rate_card_lines where rate_card_id = $1`,
    [cardId, id],
  );
  await q.query(
    `insert into fcd.rate_card_tiers (rate_card_id, segment, min_qty, discount_bp)
     select $2, segment, min_qty, discount_bp from fcd.rate_card_tiers where rate_card_id = $1`,
    [cardId, id],
  );
  return id;
}
