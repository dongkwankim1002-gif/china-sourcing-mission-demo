/**
 * 데모 시드 — 쿠팡 WING 연동(v2 2차 wing). 본 시드의 데모 화주 선적 위에 덧붙인다.
 *   · 흉내 어댑터로 만든 입고 요청(번호 「EX-RG-」 = 예시) — 데모 화주(리빙모아) 진행·최근 선적 8건에 맞춘 것 + 안 맞는 것 2건
 *   · 짝 확정 셋(자동 제안 상위) — 나머지는 화면에서 사람이 확정해 볼 수 있게 남긴다
 *   · 접근 기록(가져오기·짝)
 * 키 연결(wing_connections)은 넣지 않는다 — 데모에도 가짜 키 암호문을 두지 않는다.
 * 모두 is_demo 조직 아래라 걷어내기(조직 삭제) 한 번에 CASCADE 로 사라진다.
 */
import type { Queryable } from '@/lib/db/driver';
import { DEMO_WING_SEED, demoWingHints, mockInbounds } from '@/lib/wing/mock';
import { suggestMatches } from '@/lib/wing/match';
import { WING_SETTINGS } from '../reference/data';

const HOUR = 3_600_000;

export async function seedWingDemo(q: Queryable, opts: { now: number; today: string; shipperEmail: string; onlyIfEmpty?: boolean }) {
  const me = (
    await q.query<{ user_id: string; org_id: string }>(
      `select p.id user_id, p.home_org_id org_id from fcd.profiles p join fcd.orgs o on o.id = p.home_org_id where lower(p.email) = $1 and o.is_demo`,
      [opts.shipperEmail.toLowerCase()],
    )
  )[0];
  if (!me) return 0;
  // 이미 데모가 있던 DB(미리보기)에 덧붙일 때 — 입고 요청이 하나라도 있으면 넣지 않는다(멱등)
  if (opts.onlyIfEmpty && (await q.query<{ n: number }>(`select count(*)::int n from fcd.wing_inbound_requests where org_id = $1`, [me.org_id]))[0].n > 0) return 0;
  const ships = await q.query<{ id: string; shipment_no: string; fc_code: string; eta_fc: string | null; units: number; cartons: number; stage: number; fc_returned_units: number }>(
    // 진행 중 5건 + 입고 끝난 3건(입고 결과·회송이 있는 예시가 보이게)
    `(select id, shipment_no, fc_code, eta_fc::text eta_fc, units, cartons, stage, fc_returned_units
        from fcd.shipments where shipper_org_id = $1 and stage between 2 and 8 order by created_at desc limit 5)
     union all
     (select id, shipment_no, fc_code, eta_fc::text eta_fc, units, cartons, stage, fc_returned_units
        from fcd.shipments where shipper_org_id = $1 and stage = 9 order by created_at desc limit 3)`,
    [me.org_id],
  );
  const fcs = await q.query<{ code: string; name: string }>(`select code, name from fcd.fc_centers where coalesce(kind, 'coupang_fc') = 'coupang_fc' order by code`);
  const inbounds = mockInbounds({
    seed: DEMO_WING_SEED,
    fcs,
    today: opts.today,
    hints: demoWingHints(ships.map((s) => ({ id: s.id, fcCode: s.fc_code, etaFc: s.eta_fc, units: s.units, cartons: s.cartons, stage: s.stage, returnedUnits: s.fc_returned_units }))),
    strays: 2,
  });
  if (!inbounds.length) return 0;
  const batch = (await q.query<{ id: string }>(`select gen_random_uuid() id`))[0].id;
  const at = new Date(opts.now - 6 * HOUR).toISOString();
  const ids = new Map<string, string>();
  for (const x of inbounds) {
    const r = await q.query<{ id: string }>(
      `insert into fcd.wing_inbound_requests (org_id, source, batch_id, external_no, center_name, fc_code, planned_on, sku_count, units, boxes, status_raw, received_units, returned_units, created_by, created_at)
       values ($1,'mock',$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz) returning id`,
      [me.org_id, batch, x.externalNo, x.centerName, x.fcCode, x.plannedOn, x.skuCount, x.units, x.boxes, x.statusRaw, x.receivedUnits, x.returnedUnits, me.user_id, at],
    );
    ids.set(x.externalNo, r[0].id);
  }
  await q.query(`insert into fcd.wing_access_log (org_id, actor_id, action, detail, created_at) values ($1,$2,'imported',$3::jsonb,$4::timestamptz)`, [
    me.org_id,
    me.user_id,
    JSON.stringify({ source: 'mock', rows: inbounds.length, created: inbounds.length, batch }),
    at,
  ]);
  const rule = WING_SETTINGS.find((s) => s.key === 'wing.match_rule')!.value as { dateWindowDays: number; unitsToleranceBp: number; minScore: number };
  const sugg = suggestMatches(
    inbounds.map((x) => ({ id: ids.get(x.externalNo)!, externalNo: x.externalNo, fcCode: x.fcCode, plannedOn: x.plannedOn, units: x.units, boxes: x.boxes })),
    ships.map((s) => ({ id: s.id, shipmentNo: s.shipment_no, fcCode: s.fc_code, etaFc: s.eta_fc, units: s.units, cartons: s.cartons })),
    rule,
  );
  const byId = new Map([...ids].map(([ext, id]) => [id, ext]));
  // 끝난 선적(입고 완료)부터 셋을 확정 — 실측 회송률이 보이게
  const doneIds = new Set(ships.filter((s) => s.stage >= 9).map((s) => s.id));
  const pick = sugg.filter((s) => s.best).sort((a, b) => Number(doneIds.has(b.best!.shipmentId)) - Number(doneIds.has(a.best!.shipmentId))).slice(0, 3);
  let n = 0;
  for (const s of pick) {
    const t = new Date(opts.now - (5 - n) * HOUR).toISOString();
    const ext = byId.get(s.inboundId)!;
    await q.query(
      `insert into fcd.wing_matches (org_id, external_no, shipment_id, action, score, reason, created_by, created_at) values ($1,$2,$3,'confirmed',$4,$5::jsonb,$6,$7::timestamptz)`,
      [me.org_id, ext, s.best!.shipmentId, s.best!.score, JSON.stringify(s.best!.reason), me.user_id, t],
    );
    await q.query(`insert into fcd.wing_access_log (org_id, actor_id, action, detail, created_at) values ($1,$2,'matched',$3::jsonb,$4::timestamptz)`, [
      me.org_id,
      me.user_id,
      JSON.stringify({ externalNo: ext, shipmentId: s.best!.shipmentId, score: s.best!.score }),
      t,
    ]);
    n++;
  }
  return inbounds.length;
}
