/**
 * 소요 통계 새 판 — 서버(운영 버튼·폴링 뒤)와 데모 시드가 함께 쓴다. 신뢰 경로(asSystem·시드)에서만 부른다(여러 조직을 읽는다).
 *   · 실제 판: 실제 조직 번호의 관세청 기록(source = 'unipass')만
 *   · 예시 판: 예시(데모) 조직 번호(흉내 포함) — demo_org_id 로 데모 조직 하나에 매단다(걷어내면 함께 사라진다)
 *   · 같은 판 줄의 앞 판을 supersedes_id 로 가리킨다(고치지 않고 쌓는다)
 */
import type { Queryable } from '../db/driver';
import { kstYmd } from './calendar';
import { computeLeadTimeStats, type LeadSample } from './leadtime';
import type { TrackerConfig } from './settings';

export async function leadSamples(q: Queryable, demo: boolean): Promise<LeadSample[]> {
  const rows = await q.query<{ partner: string | null; broker: string | null; port: string | null; mode: string | null; arrival: string | null; cleared: string | null; fc: string | null }>(
    `select coalesce(t.partner_org_id, s.partner_org_id) partner, t.broker_org_id broker, coalesce(t.port, s.port) port, coalesce(t.mode, s.mode) mode,
            (select min(e.occurred_at) from fcd.cargo_track_events e where e.track_id = t.id and e.stage in ('arrival', 'unloading') and ($1::boolean or e.source = 'unipass')) arrival,
            (select min(e.occurred_at) from fcd.cargo_track_events e where e.track_id = t.id and e.stage in ('cleared', 'released') and ($1::boolean or e.source = 'unipass')) cleared,
            coalesce((select min(se.occurred_at) from fcd.shipment_events se where se.shipment_id = s.id and se.stage = 9), s.delivered_at) fc
       from fcd.cargo_tracks t join fcd.orgs o on o.id = t.org_id left join fcd.shipments s on s.id = t.shipment_id
      where o.is_demo = $1::boolean`,
    [demo],
  );
  return rows.map((r) => ({
    partner: r.partner,
    broker: r.broker,
    port: r.port,
    mode: r.mode,
    arrival: r.arrival ? kstYmd(r.arrival) : null,
    cleared: r.cleared ? kstYmd(r.cleared) : null,
    fc: r.fc ? kstYmd(r.fc) : null,
  }));
}

export async function recomputeLeadTimeStats(q: Queryable, cfg: Pick<TrackerConfig, 'calendar' | 'rules'>, today: string): Promise<{ batchId: string; rows: number }> {
  const batch = (await q.query<{ id: string }>(`select gen_random_uuid()::text id`))[0].id;
  const demoOrg = (await q.query<{ id: string }>(`select id from fcd.orgs where is_demo order by created_at, id limit 1`))[0]?.id ?? null;
  let n = 0;
  for (const demo of [false, true]) {
    if (demo && !demoOrg) continue;
    const rows = computeLeadTimeStats(await leadSamples(q, demo), { holidays: cfg.calendar, today, windowDays: cfg.rules.windowDays });
    for (const r of rows) {
      await q.query(
        `insert into fcd.lead_time_stats (batch_id, metric, level, partner_org_id, broker_org_id, port, mode, window_days, from_on, to_on, p50, p90, n, hist, demo_org_id, supersedes_id)
         values ($1::uuid,$2,$3,$4::uuid,$5::uuid,$6,$7,$8,$9::date,$10::date,$11,$12,$13,$14::jsonb,$15::uuid,
           (select p.id from fcd.lead_time_stats p where p.metric = $2 and p.level = $3 and p.partner_org_id is not distinct from $4::uuid and p.broker_org_id is not distinct from $5::uuid
              and p.port = $6 and p.mode = $7 and (p.demo_org_id is not null) = $16::boolean and p.batch_id <> $1::uuid
              and not exists (select 1 from fcd.lead_time_stats x where x.supersedes_id = p.id)
            order by p.computed_at desc limit 1))`,
        [batch, r.metric, r.level, r.partner, r.broker, r.port, r.mode, cfg.rules.windowDays, r.fromOn, r.toOn, r.p50, r.p90, r.n, JSON.stringify(r.hist), demo ? demoOrg : null, demo],
      );
      n++;
    }
  }
  return { batchId: batch, rows: n };
}
