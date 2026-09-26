/**
 * 데모 시드 — 물류사 성적표(v2 6차 scorecard). 관세청을 부르지 않는다. 결정적(고정 시드), 미래 날짜 없음(지금보다 뒤 기록은 넣지 않는다).
 *   · 예시 물류사(공식·인증 대기)마다 그 업체의 항구 × 방식별로 예시 화물 5~12건:
 *       셀러 등록(예시 화주가 저장, 물류사 태그 · 일부는 예시 관세사도) 약 70% · 물류사만 낸 화물 약 30%.
 *       업체 성향(데모 정의의 정시율)에 따라 입항 → 수리가 빠르거나 느리고, 검사 지정(예시 낱말 「검사대상 지정(예시)」)이 섞인다.
 *   · 물류사 제출: 셀러 등록 화물 중 업체 성향에 따라 55~92% 를 같은 번호로 다시 낸다(교차 확인 · 제출률) + 물류사만 낸 화물.
 *   · 귀속 충돌 둘(셀러는 A, 같은 번호를 B 가 냄) · 이상치 몇(입항 → 수리 25영업일 이상) — 운영 자료 품질 화면에 보이게.
 *   · 업체 ↔ 관세청 부호(흉내, 새 판 첫 줄) · 관세사 기본 정보(흉내) · 이의 제기 둘(하나는 열림, 하나는 받아들임).
 *   · 끝에 소요 통계(5차)와 성적표 스냅숏을 새 판으로 셈한다.
 * 모두 is_demo 조직 아래라 걷어내기(조직 삭제) 한 번에 CASCADE 로 사라진다.
 */
import type { Queryable } from '@/lib/db/driver';
import { addBusinessDays, holidaySet, kstYmd } from '@/lib/tracker/calendar';
import { HolidaysSchema, TrackerRulesSchema } from '@/lib/tracker/settings';
import { recomputeLeadTimeStats } from '@/lib/tracker/store';
import { recomputeScorecards } from '@/lib/scorecard/store';
import { ScorecardRulesSchema } from '@/lib/scorecard/settings';
import { mockForwarderCode } from '@/lib/unipass/forwarders';
import { toKstIso } from '@/lib/unipass/mock';
import { eventFingerprint, normalizeStage, stageTimes } from '@/lib/unipass/stages';
import { SCORECARD_SETTINGS, TRACKER_SETTINGS } from '../reference/data';
import { PARTNERS } from './orgs';
import { Rng } from './rng';

const HOUR = 3600_000;
const DAY = 86_400_000;
const PORT_CODE: Record<string, string> = { ICN: 'KRINC', PTK: 'KRPTK' };
const SEED = 0x5c0e_ca7d;

const RAW = {
  manifest: '입항적하목록 제출',
  arrival: '입항보고 수리',
  unloading: '하선신고 수리',
  bonded_in: '반입신고',
  declared: '수입신고',
  inspection: '검사대상 지정(예시)',
  cleared: '수입신고수리',
  released: '반출신고',
} as const;

async function bulk(q: Queryable, table: string, cols: string[], casts: string[], rows: unknown[][]) {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const params: unknown[] = [];
    const values = chunk
      .map((r) => `(${r.map((v, j) => (params.push(v), `$${params.length}${casts[j] ?? ''}`)).join(',')})`)
      .join(',');
    await q.query(`insert into fcd.${table} (${cols.join(',')}) values ${values}`, params);
  }
}

export async function seedScorecardDemo(q: Queryable, opts: { now: number; today: string; adminEmail: string; onlyIfEmpty?: boolean }) {
  if (opts.onlyIfEmpty && (await q.query<{ n: number }>(`select count(*)::int n from fcd.scorecard_snapshots where demo_org_id is not null`))[0].n > 0) return 0;
  const rng = new Rng(SEED);
  const cal = holidaySet(HolidaysSchema.parse(TRACKER_SETTINGS.find((s) => s.key === 'calendar.kr_holidays')!.value).days);
  const trackerRules = TrackerRulesSchema.parse(TRACKER_SETTINGS.find((s) => s.key === 'tracker.rules')!.value);
  const rules = ScorecardRulesSchema.parse(SCORECARD_SETTINGS.find((s) => s.key === 'scorecard.rules')!.value);
  const orgs = await q.query<{ id: string; slug: string; kind: string; name: string; user_id: string | null }>(
    `select o.id, o.slug, o.kind, o.name, (select m.user_id from fcd.memberships m where m.org_id = o.id order by m.user_id limit 1) user_id
       from fcd.orgs o where o.is_demo order by o.slug`,
  );
  if (!orgs.length) return 0;
  const bySlug = new Map(orgs.map((o) => [o.slug, o]));
  const shippers = orgs.filter((o) => o.kind === 'shipper' && o.user_id);
  const admin = (await q.query<{ id: string }>(`select id from fcd.profiles where lower(email) = $1`, [opts.adminEmail.toLowerCase()]))[0]?.id ?? null;
  const brokers = PARTNERS.filter((d) => d.type === 'customs_broker' && d.status === 'official' && bySlug.has(d.key));
  const carriers = PARTNERS.filter((d) => ['forwarder', 'consolidator', 'ferry_agent', 'air_forwarder'].includes(d.type) && ['official', 'pending_verification'].includes(d.status) && bySlug.has(d.key));
  if (!shippers.length || !carriers.length) return 0;

  const tracks: unknown[][] = [];
  const events: unknown[][] = [];
  const subs: unknown[][] = [];
  const seen = new Set<string>();
  const cutoff = opts.now - HOUR;
  let seq = 0;

  /** 한 화물의 단계 시각(밀리초) — 업체 성향(slow 0~1)·관세사 성향·검사·이상치 */
  const timeline = (slow: number, brokerSlow: number, forceOutlier: boolean) => {
    const back = forceOutlier ? rng.int(55, 170) : rng.int(12, 172);
    const arrivalYmd = kstYmd(opts.now - back * DAY);
    const arrival = Date.parse(`${arrivalYmd}T00:00:00+09:00`) + rng.int(6, 15) * HOUR;
    const unloading = arrival + rng.int(2, 6) * HOUR;
    const bonded = unloading + rng.int(2, 9) * HOUR;
    const declYmd = addBusinessDays(kstYmd(bonded), rng.chance(0.5) ? 0 : 1, cal);
    const declared = Math.max(Date.parse(`${declYmd}T00:00:00+09:00`) + rng.int(10, 14) * HOUR, bonded + HOUR);
    const inspected = rng.chance(0.04 + slow * 0.22);
    const u = rng.f();
    let k = u < 0.5 - slow * 0.35 ? 0 : u < 0.85 - slow * 0.3 ? 1 : u < 0.95 - slow * 0.15 ? 2 : rng.int(3, 5);
    if (inspected) k += rng.int(2, 4);
    if (rng.chance(brokerSlow)) k += 1;
    if (forceOutlier) k = rng.int(24, 30);
    const clrYmd = addBusinessDays(declYmd, k, cal);
    const cleared = Math.max(Date.parse(`${clrYmd}T00:00:00+09:00`) + rng.int(11, 17) * HOUR, declared + 2 * HOUR);
    // 반입 → 반출: 창고 처리 — 느린 업체는 반출도 하루쯤 늦다
    const released = cleared + (rng.chance(slow) ? rng.int(18, 40) : rng.int(1, 8)) * HOUR;
    const evs: [keyof typeof RAW, number][] = [
      ['manifest', arrival - rng.int(12, 30) * HOUR],
      ['arrival', arrival],
      ['unloading', unloading],
      ['bonded_in', bonded],
      ['declared', declared],
      ...(inspected ? ([['inspection', declared + HOUR]] as [keyof typeof RAW, number][]) : []),
      ['cleared', cleared],
      ['released', released],
    ];
    return { evs: evs.filter(([, at]) => at <= cutoff), arrival, shed: `예시 보세창고 ${String.fromCharCode(65 + rng.int(0, 5))}` };
  };

  const addTrack = (x: { org: string; by: string | null; number: string; year: number; mode: string; port: string; partner: string | null; broker: string | null; createdAt: number; tl: ReturnType<typeof timeline> }) => {
    const id = rng.uuid();
    const st = stageTimes(x.tl.evs.filter(([k]) => k !== 'inspection').map(([k, at]) => ({ stage: k as never, at: new Date(at).toISOString() })));
    const last = x.tl.evs[x.tl.evs.length - 1];
    tracks.push([id, x.org, x.by, 'hbl', x.number, x.year, x.mode, x.port, PORT_CODE[x.port] ?? null, x.partner, x.broker, st.current, last ? RAW[last[0]] : null,
      st.first.arrival ? kstYmd(st.first.arrival) : null, new Date(Math.min(cutoff, x.createdAt + 2 * HOUR)).toISOString(), new Date(Math.min(cutoff, x.createdAt)).toISOString()]);
    for (const [k, at] of x.tl.evs) {
      const iso = toKstIso(at);
      events.push([id, x.org, normalizeStage(RAW[k]), RAW[k], x.tl.shed, iso, 'mock', eventFingerprint({ rawType: RAW[k], at: iso }), iso]);
    }
    return id;
  };

  const outlierBudget = { n: 4 };
  for (const d of carriers) {
    const p = bySlug.get(d.key)!;
    const slow = Math.max(0, Math.min(1, (0.97 - d.onTime) * 6));
    const submitRate = d.onTime >= 0.9 ? 0.92 : 0.55;
    const tag = d.key.toUpperCase().slice(0, 8);
    const combos: [string, string][] = [];
    for (const port of d.ports) for (const mode of d.modes) if (!(mode === 'AIR' && port !== 'ICN')) combos.push([port, mode]);
    for (const [port, mode] of combos) {
      const count = 5 + (d.weight >= 5 ? 4 : 0) + rng.int(0, 3);
      for (let i = 0; i < count; i++) {
        seq++;
        const outlier = outlierBudget.n > 0 && seq % 97 === 13 && (outlierBudget.n--, true);
        const br = brokers.filter((b) => b.ports.includes(port));
        const brokerDef = br.length && rng.chance(0.5) ? rng.pick(br) : null;
        const tl = timeline(slow, brokerDef ? Math.max(0, (0.96 - brokerDef.onTime) * 4) : 0.1, outlier);
        if (!tl.evs.some(([k]) => k === 'arrival')) continue;
        const year = new Date(tl.arrival + 9 * HOUR).getUTCFullYear();
        const number = `EXSC-${tag}-${port}${mode.slice(0, 2)}${String(seq).padStart(4, '0')}`;
        if (seen.has(number)) continue;
        seen.add(number);
        const created = tl.arrival - rng.int(20, 60) * HOUR;
        const partnerOnly = rng.chance(0.3);
        if (!partnerOnly) {
          const s = shippers[seq % shippers.length];
          addTrack({ org: s.id, by: s.user_id, number, year, mode, port, partner: p.id, broker: brokerDef ? bySlug.get(brokerDef.key)!.id : null, createdAt: created, tl });
        }
        if (partnerOnly || rng.chance(submitRate)) {
          addTrack({ org: p.id, by: p.user_id, number, year, mode, port, partner: null, broker: null, createdAt: created + rng.int(1, 30) * HOUR, tl });
          subs.push([p.id, p.user_id, `00000000-0000-4000-8000-${String(carriers.indexOf(d)).padStart(12, '0')}`, 'hbl', number, year, port, mode, new Date(Math.min(cutoff, created + 2 * HOUR)).toISOString()]);
        }
      }
    }
  }

  // 5차 데모가 선적과 이은 번호(플랫폼 선적)도 업체 성향대로 다시 낸다 — 제출률이 셀러 등록만이 아니라 선적 화물에도 걸리게
  const copies: { src: string; dst: string; org: string }[] = [];
  const platform = await q.query<{ id: string; kind: string; number: string; bl_year: number | null; mode: string | null; port: string | null; port_raw: string | null; stage: string | null; status_raw: string | null; arrival_on: string | null; created_at: string; partner: string }>(
    `select t.id, t.kind, t.number, t.bl_year, t.mode, t.port, t.port_raw, t.stage, t.status_raw, t.arrival_on::text, t.created_at, s.partner_org_id partner
       from fcd.cargo_tracks t join fcd.orgs o on o.id = t.org_id join fcd.shipments s on s.id = t.shipment_id
      where o.is_demo and o.kind = 'shipper' order by t.number`,
  );
  const defById = new Map(carriers.map((d) => [bySlug.get(d.key)!.id, d]));
  for (const t of platform) {
    const d = defById.get(t.partner);
    if (!d || !rng.chance(d.onTime >= 0.9 ? 0.9 : 0.5)) continue;
    const p = bySlug.get(d.key)!;
    const id = rng.uuid();
    const created = Math.min(cutoff, Date.parse(t.created_at) + rng.int(1, 20) * HOUR);
    tracks.push([id, p.id, p.user_id, t.kind, t.number, t.bl_year, t.mode, t.port, t.port_raw, null, null, t.stage, t.status_raw, t.arrival_on, new Date(created).toISOString(), new Date(created).toISOString()]);
    copies.push({ src: t.id, dst: id, org: p.id });
    subs.push([p.id, p.user_id, `00000000-0000-4000-8000-${String(carriers.indexOf(d)).padStart(12, '0')}`, t.kind, t.number, t.bl_year, t.port, t.mode, new Date(created).toISOString()]);
  }

  // 귀속 충돌 둘 — 셀러는 첫 업체로 적었는데 같은 번호를 다른 업체가 냈다
  const [ca, cb] = [bySlug.get(carriers[0].key)!, bySlug.get(carriers[1 % carriers.length].key)!];
  for (let i = 0; i < 2 && ca.id !== cb.id; i++) {
    seq++;
    const tl = timeline(0.2, 0.1, false);
    if (!tl.evs.some(([k]) => k === 'arrival')) continue;
    const number = `EXSC-CONFLICT-${i + 1}`;
    const year = new Date(tl.arrival + 9 * HOUR).getUTCFullYear();
    const created = tl.arrival - 30 * HOUR;
    addTrack({ org: shippers[i % shippers.length].id, by: shippers[i % shippers.length].user_id, number, year, mode: 'LCL', port: 'ICN', partner: ca.id, broker: null, createdAt: created, tl });
    addTrack({ org: cb.id, by: cb.user_id, number, year, mode: 'LCL', port: 'ICN', partner: null, broker: null, createdAt: created + 5 * HOUR, tl });
    subs.push([cb.id, cb.user_id, '00000000-0000-4000-8000-0000000000cf', 'hbl', number, year, 'ICN', 'LCL', new Date(Math.min(cutoff, created + 6 * HOUR)).toISOString()]);
  }

  await bulk(
    q,
    'cargo_tracks',
    ['id', 'org_id', 'created_by', 'kind', 'number', 'bl_year', 'mode', 'port', 'port_raw', 'partner_org_id', 'broker_org_id', 'stage', 'status_raw', 'arrival_on', 'last_checked_at', 'created_at'],
    ['::uuid', '::uuid', '::uuid', '', '', '::smallint', '', '', '', '::uuid', '::uuid', '', '', '::date', '::timestamptz', '::timestamptz'],
    tracks,
  );
  await bulk(q, 'cargo_track_events', ['track_id', 'org_id', 'stage', 'raw_type', 'raw_summary', 'occurred_at', 'source', 'fingerprint', 'created_at'], ['::uuid', '::uuid', '', '', '', '::timestamptz', '', '', '::timestamptz'], events);
  if (copies.length) {
    await q.query(
      `insert into fcd.cargo_track_events (track_id, org_id, stage, raw_type, raw_summary, occurred_at, source, fingerprint, created_at)
       select c.dst, c.org, e.stage, e.raw_type, e.raw_summary, e.occurred_at, e.source, e.fingerprint, e.created_at
         from jsonb_to_recordset($1::jsonb) as c(src uuid, dst uuid, org uuid) join fcd.cargo_track_events e on e.track_id = c.src`,
      [JSON.stringify(copies)],
    );
  }
  await bulk(q, 'partner_cargo_submissions', ['partner_org_id', 'submitted_by', 'batch_id', 'kind', 'number', 'bl_year', 'port', 'mode', 'created_at'], ['::uuid', '::uuid', '::uuid', '', '', '::smallint', '', '', '::timestamptz'], subs);

  // 업체 ↔ 관세청 부호(흉내) — 공식 업체는 연결, 인증 대기는 「연결 안 됨」 한 줄
  const codes: unknown[][] = [];
  for (const d of [...carriers, ...brokers]) {
    const o = bySlug.get(d.key)!;
    const linked = d.status === 'official';
    codes.push([o.id, linked ? mockForwarderCode(d.name) : null, linked ? `${d.name}(예시)` : null, 'mock', linked ? 'linked' : 'unlinked', linked ? '흉내 목록에서 이름으로 연결(예시)' : '흉내 목록에서 찾지 못함 — 운영 확인 필요(예시)', admin, new Date(opts.now - 20 * DAY).toISOString()]);
  }
  await bulk(q, 'partner_customs_codes', ['org_id', 'code', 'registered_name', 'source', 'status', 'note', 'created_by', 'created_at'], ['::uuid', '', '', '', '', '', '::uuid', '::timestamptz'], codes);

  // 관세사 기본 정보(흉내)
  const OFFICE: Record<string, string> = { ICN: '인천세관(예시)', PTK: '평택세관(예시)' };
  const profiles = PARTNERS.filter((d) => d.type === 'customs_broker' && bySlug.has(d.key)).map((d) => [
    bySlug.get(d.key)!.id, d.license ?? null, d.ports.map((p) => OFFICE[p] ?? p), d.ports, d.caps.length ? `${d.caps.length}개 품목군 요건 확인 경험(예시)` : null, 'mock', admin, new Date(opts.now - 30 * DAY).toISOString(),
  ]);
  await bulk(q, 'broker_profiles', ['org_id', 'registration_no', 'customs_offices', 'ports', 'specialties', 'source', 'created_by', 'created_at'], ['::uuid', '', '::text[]', '::text[]', '', '', '::uuid', '::timestamptz'], profiles);

  // 이의 제기 — 느린 업체 하나가 열어 둔 것, 다른 업체의 이상치 한 건은 받아들여 성적에서 뺐다
  const slowest = [...carriers].sort((a, b) => a.onTime - b.onTime)[0];
  const so = bySlug.get(slowest.key)!;
  const soNum = (await q.query<{ number: string }>(`select number from fcd.cargo_tracks where org_id = $1 order by number limit 1`, [so.id]))[0]?.number ?? null;
  const d1 = rng.uuid();
  await q.query(
    `insert into fcd.scorecard_disputes (id, partner_org_id, kind, metric, cargo_ref, body, created_by, created_at) values ($1,$2,'open','clearance',$3,$4,$5,$6::timestamptz)`,
    [d1, so.id, soNum, '이 화물은 화주가 서류(원산지증명)를 늦게 줘서 수리가 늦었습니다. 저희 처리 지연이 아닙니다(예시).', so.user_id, new Date(opts.now - 3 * DAY).toISOString()],
  );
  const outlier = (await q.query<{ number: string; org_id: string; user_id: string | null }>(
    `select t.number, t.partner_org_id org_id, (select m.user_id from fcd.memberships m where m.org_id = t.partner_org_id order by m.user_id limit 1) user_id
       from fcd.cargo_tracks t join fcd.orgs o on o.id = t.org_id
      where o.is_demo and o.kind = 'shipper' and t.number like 'EXSC-%' and t.partner_org_id is not null and t.partner_org_id <> $1
        and exists (select 1 from fcd.cargo_track_events e where e.track_id = t.id and e.stage = 'cleared')
      order by (select max(e.occurred_at) - min(e.occurred_at) from fcd.cargo_track_events e where e.track_id = t.id) desc limit 1`,
    [so.id],
  ))[0];
  if (outlier) {
    const d2 = rng.uuid();
    await q.query(
      `insert into fcd.scorecard_disputes (id, partner_org_id, kind, metric, cargo_ref, body, created_by, created_at) values ($1,$2,'open','clearance',$3,$4,$5,$6::timestamptz)`,
      [d2, outlier.org_id, outlier.number, '저희가 맡은 화물이 아닙니다 — 다른 포워더 화물로 보입니다(예시).', outlier.user_id, new Date(opts.now - 9 * DAY).toISOString()],
    );
    await q.query(
      `insert into fcd.scorecard_disputes (root_id, partner_org_id, kind, body, created_by, created_at) values ($1,$2,'accepted',$3,$4,$5::timestamptz)`,
      [d2, outlier.org_id, '셀러에게 확인했습니다 — 물류사를 잘못 골랐다고 합니다. 이 화물을 성적에서 뺍니다(예시).', admin, new Date(opts.now - 7 * DAY).toISOString()],
    );
  }

  await recomputeLeadTimeStats(q, { calendar: cal, rules: trackerRules }, opts.today);
  await recomputeScorecards(q, { calendar: cal, rules }, opts.today);
  return tracks.length;
}
