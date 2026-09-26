/**
 * 데모 시드 — 통관·입고 알리미(v2 5차 tracker). 관세청을 부르지 않는다(흉내 어댑터의 단계 생성기만 쓴다).
 *   · 예시 화주의 한국 도착(6단계)한 선적마다 H B/L 번호 하나(「EXHBL-」로 시작 — 실제 번호와 헷갈리지 않게)를 잇고,
 *     선적의 한국 도착 시각을 입항 기준으로 흉내 단계 기록(적하목록 → 반출)을 지금까지 쌓는다(source = mock).
 *     물류사 기록(선적 7단계)과 흉내 실측이 조금 다를 수 있다 — 화면이 둘을 나란히 보여 준다.
 *   · 일부에는 예시 관세사를 잇는다(관세사별 통계가 보이게).
 *   · 데모 화주 계정에는 선적과 잇지 않은 번호 셋(화물관리번호·M B/L·H B/L)도 — 알림 켬.
 *   · 마지막에 예시 판 소요 통계 한 벌(demo_org_id).
 * 모두 is_demo 조직 아래라 걷어내기(조직 삭제) 한 번에 CASCADE 로 사라진다.
 */
import type { Queryable } from '@/lib/db/driver';
import { holidaySet, kstYmd } from '@/lib/tracker/calendar';
import { TrackerRulesSchema, HolidaysSchema } from '@/lib/tracker/settings';
import { recomputeLeadTimeStats } from '@/lib/tracker/store';
import { defaultArrival, MOCK_RAW, mockTimeline, querySeed, toKstIso } from '@/lib/unipass/mock';
import { eventFingerprint, normalizeStage, stageTimes } from '@/lib/unipass/stages';
import type { TrackKind, TrackQuery } from '@/lib/unipass/types';
import { TRACKER_SETTINGS } from '../reference/data';

const HOUR = 3600_000;
const PORT_CODE: Record<string, string> = { ICN: 'KRINC', PTK: 'KRPTK' };

export async function seedTrackerDemo(q: Queryable, opts: { now: number; today: string; shipperEmail: string; onlyIfEmpty?: boolean }) {
  if (opts.onlyIfEmpty && (await q.query<{ n: number }>(`select count(*)::int n from fcd.cargo_tracks t join fcd.orgs o on o.id = t.org_id where o.is_demo`))[0].n > 0) return 0;
  const rules = TrackerRulesSchema.parse(TRACKER_SETTINGS.find((s) => s.key === 'tracker.rules')!.value);
  const cal = holidaySet(HolidaysSchema.parse(TRACKER_SETTINGS.find((s) => s.key === 'calendar.kr_holidays')!.value).days);
  const me = (
    await q.query<{ user_id: string; org_id: string }>(
      `select p.id user_id, p.home_org_id org_id from fcd.profiles p join fcd.orgs o on o.id = p.home_org_id where lower(p.email) = $1 and o.is_demo`,
      [opts.shipperEmail.toLowerCase()],
    )
  )[0];
  const brokers = await q.query<{ id: string }>(`select id from fcd.orgs where is_demo and kind = 'partner' and business_type = 'customs_broker' order by name`);
  const ships = await q.query<{ id: string; shipment_no: string; shipper_org_id: string; partner_org_id: string; port: string; mode: string; arrived: string; user_id: string | null }>(
    `select s.id, s.shipment_no, s.shipper_org_id, s.partner_org_id, s.port, s.mode,
            (select min(e.occurred_at) from fcd.shipment_events e where e.shipment_id = s.id and e.stage = 6) arrived,
            (select m.user_id from fcd.memberships m where m.org_id = s.shipper_org_id order by m.user_id limit 1) user_id
       from fcd.shipments s join fcd.orgs o on o.id = s.shipper_org_id
      where o.is_demo and s.stage >= 6
        and exists (select 1 from fcd.shipment_events e where e.shipment_id = s.id and e.stage = 6 and e.occurred_at > to_timestamp($1::double precision / 1000) - interval '100 days')
      order by s.shipment_no`,
    [opts.now],
  );

  let n = 0;
  const insertTrack = async (x: { org: string; by: string | null; kind: TrackKind; number: string; year: number | null; label: string | null; mode: string | null; port: string | null; shipment: string | null; partner: string | null; broker: string | null; createdAt: number; arrivalMs: number; watch: string | null }) => {
    const query: TrackQuery = { kind: x.kind, number: x.number, year: x.year };
    const seed = querySeed(query);
    const evs = mockTimeline(seed, x.arrivalMs, cal).filter((e) => e.at <= opts.now);
    const t = (
      await q.query<{ id: string }>(
        `insert into fcd.cargo_tracks (org_id, created_by, kind, number, bl_year, label, mode, port, port_raw, shipment_id, partner_org_id, broker_org_id, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz) returning id`,
        [x.org, x.by, x.kind, x.number, x.year, x.label, x.mode, x.port, x.port ? PORT_CODE[x.port] ?? null : null, x.shipment, x.partner, x.broker, new Date(x.createdAt).toISOString()],
      )
    )[0];
    for (const e of evs) {
      const at = toKstIso(e.at);
      const rawType = MOCK_RAW[e.stage];
      await q.query(
        `insert into fcd.cargo_track_events (track_id, org_id, stage, raw_type, raw_summary, occurred_at, source, fingerprint, created_at)
         values ($1,$2,$3,$4,$5,$6::timestamptz,'mock',$7,$6::timestamptz)`,
        [t.id, x.org, normalizeStage(rawType), rawType, e.shed, at, eventFingerprint({ rawType, at })],
      );
    }
    const st = stageTimes(evs.map((e) => ({ stage: e.stage, at: new Date(e.at).toISOString() })));
    await q.query(
      `update fcd.cargo_tracks set stage = $2, status_raw = $3, arrival_on = $4::date, last_checked_at = $5::timestamptz where id = $1`,
      [t.id, st.current, evs.length ? MOCK_RAW[evs[evs.length - 1].stage] : null, st.first.arrival ? kstYmd(st.first.arrival) : null, new Date(Math.min(opts.now, x.createdAt + 2 * HOUR)).toISOString()],
    );
    if (x.watch) await q.query(`insert into fcd.track_watches (track_id, org_id, user_id, enabled, created_at) values ($1,$2,$3,true,$4::timestamptz)`, [t.id, x.org, x.watch, new Date(x.createdAt).toISOString()]);
    n++;
    return t.id;
  };

  for (const [i, s] of ships.entries()) {
    const arrivalMs = Date.parse(s.arrived);
    const tail = s.shipment_no.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(-12);
    const broker = brokers.length && i % 5 < 2 ? brokers[i % brokers.length].id : null;
    // 데모 화주 본인 선적은 알림 켬(지금 진행 중인 것을 보이게), 다른 예시 화주는 절반만
    const watch = s.user_id && (s.shipper_org_id === me?.org_id || i % 2 === 0) ? s.user_id : null;
    await insertTrack({
      org: s.shipper_org_id, by: s.user_id, kind: 'hbl', number: `EXHBL-${tail}`, year: new Date(arrivalMs + 9 * HOUR).getUTCFullYear(), label: null,
      mode: s.mode, port: s.port, shipment: s.id, partner: s.partner_org_id, broker, createdAt: arrivalMs - 36 * HOUR, arrivalMs, watch,
    });
  }

  // 데모 화주 — 선적과 잇지 않은 번호 셋(흉내 규칙대로: 저장한 때 기준 입항)
  if (me) {
    const loose: { kind: TrackKind; number: string; year: number | null; label: string; ago: number; mode: string }[] = [
      { kind: 'cargo_no', number: '26EXMP00ANLU0830001', year: null, label: '여름 이불 2차(예시)', ago: 30 * HOUR, mode: 'FCL' },
      { kind: 'mbl', number: 'EXMBL-7731042', year: 2026, label: '주방 소품 혼적(예시)', ago: 6 * HOUR, mode: 'LCL' },
      { kind: 'hbl', number: 'EXHBL-AIR-2291', year: 2026, label: '샘플 항공(예시)', ago: 50 * HOUR, mode: 'AIR' },
    ];
    for (const l of loose) {
      const created = opts.now - l.ago;
      const arrivalMs = defaultArrival(querySeed({ kind: l.kind, number: l.number, year: l.year }), created);
      await insertTrack({ org: me.org_id, by: me.user_id, kind: l.kind, number: l.number, year: l.year, label: l.label, mode: l.mode, port: 'ICN', shipment: null, partner: null, broker: null, createdAt: created, arrivalMs, watch: me.user_id });
    }
  }

  if (n) await recomputeLeadTimeStats(q, { calendar: cal, rules }, opts.today);
  return n;
}
