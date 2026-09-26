/**
 * 성적표 표본 읽기 · 새 판 계산 — 서버(운영 버튼·예약 경로)와 데모 시드가 함께 쓴다. 신뢰 경로(asSystem·시드)에서만 부른다(여러 조직을 읽는다).
 *   · 원료는 5차 cargo_tracks + cargo_track_events(관세청 기록) + 이은 선적의 FC 입고 — 표를 새로 만들지 않는다.
 *   · 번호 출처: 물류사 조직 소유 번호 = 물류사 제출 · 선적과 이은 번호 = 플랫폼 선적 · 그 밖의 화주 번호 = 셀러 등록.
 *   · 실제 판은 관세청 기록(source = 'unipass')만, 예시 판은 예시 조직 자료(흉내 포함) — 5차와 같이 섞지 않는다.
 *   · 받아들인 이의의 화물번호는 뺀다.
 */
import type { Queryable } from '../db/driver';
import { kstYmd, type HolidaySet } from '../tracker/calendar';
import { EFFECTIVE_PORT_SQL } from '../tracker/store';
import { stageTimes } from '../unipass/stages';
import type { TrackStage } from '../unipass/types';
import { computeScorecards, hasInspection, mergeSamples, type RawSample, type ScoreRow } from './engine';
import type { ScorecardRules } from './settings';

export const SAMPLE_KEY_SQL = `coalesce(t.cargo_no, t.kind || ':' || t.number || ':' || coalesce(t.bl_year::text, ''))`;

export async function scorecardSamples(q: Queryable, demo: boolean): Promise<RawSample[]> {
  const rows = await q.query<{
    key: string; number: string; cargo_no: string | null; source: RawSample['source']; registrant: string; partner: string | null; broker: string | null; port: string | null; mode: string | null;
    evs: { stage: TrackStage | null; at: string; raw: string }[] | string | null; fc: string | null;
  }>(
    `select ${SAMPLE_KEY_SQL} key, t.number, t.cargo_no,
            case when o.kind = 'partner' then 'partner' when s.id is not null then 'platform' else 'seller' end source,
            t.org_id registrant,
            case when o.kind = 'partner' then t.org_id when s.id is not null then s.partner_org_id else t.partner_org_id end partner,
            case when o.kind = 'partner' then null else t.broker_org_id end broker,
            ${EFFECTIVE_PORT_SQL} port, coalesce(s.mode, t.mode) mode,
            (select json_agg(json_build_object('stage', e.stage, 'at', e.occurred_at, 'raw', e.raw_type)) from fcd.cargo_track_events e
              where e.track_id = t.id and ($1::boolean or e.source = 'unipass')) evs,
            coalesce((select min(se.occurred_at) from fcd.shipment_events se where se.shipment_id = s.id and se.stage = 9), s.delivered_at) fc
       from fcd.cargo_tracks t join fcd.orgs o on o.id = t.org_id left join fcd.shipments s on s.id = t.shipment_id
      where o.is_demo = $1::boolean and o.kind in ('shipper', 'partner')`,
    [demo],
  );
  return rows.map((r) => {
    const evs = (typeof r.evs === 'string' ? (JSON.parse(r.evs) as { stage: TrackStage | null; at: string; raw: string }[]) : r.evs) ?? [];
    const st = stageTimes(evs.map((e) => ({ stage: e.stage, at: new Date(e.at).toISOString() })));
    const y = (x: string | undefined | null) => (x ? kstYmd(x) : null);
    return {
      key: r.key,
      source: r.source,
      registrant: r.registrant,
      partner: r.partner,
      broker: r.broker,
      port: r.port,
      mode: r.mode,
      arrival: y(st.first.arrival ?? st.first.unloading),
      bondedIn: y(st.first.bonded_in),
      cleared: y(st.first.cleared ?? st.first.released),
      released: y(st.first.released),
      fc: y(r.fc),
      inspected: hasInspection(evs.map((e) => e.raw)),
      // 이의 cargo_ref 는 셀러·업체가 아는 번호(B/L 번호)나 화물관리번호로 적힌다 — 둘 다 맞출 수 있게(열쇠가 화물관리번호로 바뀌어도)
      refs: [r.number, r.cargo_no].filter((x): x is string => !!x),
    };
  });
}

/** 받아들인 이의의 화물번호 — 덧붙이기(note)를 뺀 마지막 줄이 accepted 인 이의(화면의 disputes() 와 같은 규칙) */
export async function acceptedDisputeRefs(q: Queryable, demo: boolean): Promise<string[]> {
  const r = await q.query<{ cargo_ref: string }>(
    `select d.cargo_ref from fcd.scorecard_disputes d join fcd.orgs o on o.id = d.partner_org_id
      where d.root_id is null and d.cargo_ref is not null and o.is_demo = $1::boolean
        and (select x.kind from fcd.scorecard_disputes x where x.root_id = d.id and x.kind <> 'note' order by x.created_at desc, x.id desc limit 1) = 'accepted'`,
    [demo],
  );
  return r.map((x) => x.cargo_ref);
}

/**
 * 이름 붙은 판을 만들 수 있는 업체 — 입점(공식·인증 대기)해 이의를 낼 수 있는 업체만. 공개정보 기준(public_info) 업체는
 * 계정이 없어 알림·답변권·이의가 없으므로 이름 붙은 성적을 만들지 않는다(기획 7-4 · 검토 고침). 그 화물은 전체 판에는 들어간다.
 */
export async function scorecardEligibleOrgs(q: Queryable, demo: boolean): Promise<Set<string>> {
  const r = await q.query<{ id: string }>(
    `select id from fcd.orgs where kind = 'partner' and status in ('official', 'pending_verification') and is_demo = $1::boolean`,
    [demo],
  );
  return new Set(r.map((x) => x.id));
}

export async function computeFor(q: Queryable, demo: boolean, cfg: { rules: ScorecardRules; calendar: HolidaySet }, today: string): Promise<ScoreRow[]> {
  const [raw, excluded, eligible] = await Promise.all([scorecardSamples(q, demo), acceptedDisputeRefs(q, demo), scorecardEligibleOrgs(q, demo)]);
  const rows = computeScorecards(mergeSamples(raw), { holidays: cfg.calendar, today, rules: cfg.rules, excluded });
  return rows.filter((r) => r.entityKind === 'overall' || (r.entity != null && eligible.has(r.entity)));
}

/**
 * 새 판 — 한 트랜잭션(부르는 쪽 asSystem)에서 모든 줄을 넣는다. 표본이 없어도 전체 판 한 줄(n = 0)은 늘 들어간다(엔진이 만든다) —
 * 그래서 「최근 판」이 늘 이번 계산이고, 옛 숫자가 남아 보이지 않는다(검토 고침). withSamples = 표본이 한 건이라도 있는 줄 수.
 */
export async function recomputeScorecards(q: Queryable, cfg: { rules: ScorecardRules; calendar: HolidaySet }, today: string): Promise<{ batchId: string; rows: number; withSamples: number }> {
  const batch = (await q.query<{ id: string }>(`select gen_random_uuid()::text id`))[0].id;
  const demoOrg = (await q.query<{ id: string }>(`select id from fcd.orgs where is_demo order by created_at, id limit 1`))[0]?.id ?? null;
  let n = 0;
  let withSamples = 0;
  for (const demo of [false, true]) {
    if (demo && !demoOrg) continue;
    const rows = await computeFor(q, demo, cfg, today);
    for (const r of rows) {
      await q.query(
        `insert into fcd.scorecard_snapshots (batch_id, entity_kind, entity_org_id, port, mode, window_days, from_on, to_on, n, metrics, sources, submission, certified, demo_org_id, supersedes_id)
         values ($1::uuid,$2,$3::uuid,$4,$5,$6,$7::date,$8::date,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14::uuid,
           (select p.id from fcd.scorecard_snapshots p where p.entity_kind = $2 and p.entity_org_id is not distinct from $3::uuid
              and p.port is not distinct from $4 and p.mode is not distinct from $5 and (p.demo_org_id is not null) = $15::boolean and p.batch_id <> $1::uuid
              and not exists (select 1 from fcd.scorecard_snapshots x where x.supersedes_id = p.id)
            order by p.computed_at desc limit 1))`,
        [batch, r.entityKind, r.entity, r.port, r.mode, cfg.rules.windowDays, r.fromOn, r.toOn, r.n, JSON.stringify(r.metrics), JSON.stringify(r.sources),
          r.submission ? JSON.stringify(r.submission) : null, r.certified, demo ? demoOrg : null, demo],
      );
      n++;
      if (r.n > 0) withSamples++;
    }
  }
  return { batchId: batch, rows: n, withSamples };
}
