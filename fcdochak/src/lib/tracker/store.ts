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
import { stageTimes } from '../unipass/stages';
import type { TrackStage } from '../unipass/types';

/**
 * 번호의 「쓰는 항구」 — 번호의 항구(관세청 양륙항에서 온 값), 관세청이 우리가 모르는 항구를 말했으면 없음, 조회 전이면 이은 선적의 항구.
 * t = cargo_tracks, s = 이은 shipments 로 부른다.
 */
export const EFFECTIVE_PORT_SQL = `(case when t.port is not null then t.port when t.port_raw is not null then null else s.port end)`;

/**
 * 번호마다 실측 표본 하나. 고른 규칙(검토 고침):
 *   · 같은 화물은 한 번만 — 관세청 화물관리번호(cargo_no, 조회 뒤 서버가 채움), 없으면 (종류·번호·연도)로 묶고 선적과 이은 줄을 앞세운다.
 *     한 조직이 M B/L·H B/L 로 따로 저장하거나 여러 조직이 같은 번호를 저장해도 표본이 부풀지 않게.
 *   · 물류사·관세사 귀속은 FC도착 선적과 이은 번호만 — 선적의 물류사(화주가 고른 칸이 아니라 실제 거래), 관세사는 그 선적에 이은 번호에서만.
 *     선적 없이 화주가 고른 물류사·관세사는 업체별 판에 넣지 않는다(남의 B/L 로 경쟁 업체 실측을 흔들지 못하게). 항구·방식 판에는 들어간다.
 *   · 단계 첫 시각은 화면과 같은 stageTimes(신고 전 반출은 반출로 세지 않는다).
 */
export async function leadSamples(q: Queryable, demo: boolean): Promise<LeadSample[]> {
  const rows = await q.query<{ partner: string | null; broker: string | null; port: string | null; mode: string | null; evs: { stage: TrackStage | null; at: string }[] | null; fc: string | null }>(
    `select distinct on (coalesce(t.cargo_no, t.kind || ':' || t.number || ':' || coalesce(t.bl_year::text, '')))
            s.partner_org_id partner, case when s.id is not null then t.broker_org_id end broker,
            ${EFFECTIVE_PORT_SQL} port, coalesce(s.mode, t.mode) mode,
            (select json_agg(json_build_object('stage', e.stage, 'at', e.occurred_at)) from fcd.cargo_track_events e
              where e.track_id = t.id and e.stage is not null and ($1::boolean or e.source = 'unipass')) evs,
            coalesce((select min(se.occurred_at) from fcd.shipment_events se where se.shipment_id = s.id and se.stage = 9), s.delivered_at) fc
       from fcd.cargo_tracks t join fcd.orgs o on o.id = t.org_id left join fcd.shipments s on s.id = t.shipment_id
      where o.is_demo = $1::boolean
      order by coalesce(t.cargo_no, t.kind || ':' || t.number || ':' || coalesce(t.bl_year::text, '')), (s.id is null), t.created_at, t.id`,
    [demo],
  );
  return rows.map((r) => {
    const evs = (typeof r.evs === 'string' ? (JSON.parse(r.evs) as typeof r.evs) : r.evs) ?? [];
    const st = stageTimes(evs.map((e) => ({ stage: e.stage, at: new Date(e.at).toISOString() })));
    const arrival = st.first.arrival ?? st.first.unloading ?? null;
    const cleared = st.first.cleared ?? st.first.released ?? null;
    return {
      partner: r.partner,
      broker: r.broker,
      port: r.port,
      mode: r.mode,
      arrival: arrival ? kstYmd(arrival) : null,
      cleared: cleared ? kstYmd(cleared) : null,
      fc: r.fc ? kstYmd(r.fc) : null,
    };
  });
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
