-- FC도착 0025 — 물류사 성적표(v2 6차 scorecard) 검토 고침 · 기획 docs/scorecard-plan.md
--
--   ① 색인 — 새 판마다 앞 판을 찾는 supersedes_id·(업체·항구·방식·시각) 조회가 표가 커질수록 느려지지 않게.
--   ② 이름 붙은 성적은 입점 업체(공식·인증 대기)만 — 공개정보 기준(public_info) 업체는 계정이 없어 알림·답변권·이의가 없다(기획 7-4).
--      읽기 정책 하나 더(restrictive)로 좁힌다(운영자·그 업체 구성원은 그대로). 공개 보기 v_scorecard_public 도 같은 조건을 더한다.
--   ③ 이의 — 받아들이기·돌려보내기·거두기는 이의가 아직 열려 있을 때만(받아들인 뒤 업체가 거둬 제외를 푸는 일을 막는다).
--
-- 이 파일은 자료를 지우거나 덮지 않는다(DELETE·TRUNCATE·UPDATE 없음). 기존 정책을 지우지 않고 제한 정책을 덧붙인다.
-- 보기 v_scorecard_public 은 같은 칸 그대로 조건만 더해 다시 만든다(create or replace — 자료와 무관).

-- ① 색인 -----------------------------------------------------------------------------------------
create index if not exists scorecard_snapshots_supersedes_idx on fcd.scorecard_snapshots (supersedes_id) where supersedes_id is not null;
create index if not exists scorecard_snapshots_lookup_idx on fcd.scorecard_snapshots (entity_kind, entity_org_id, port, mode, computed_at desc);

-- ② 이름 붙은 성적은 입점 업체만 ------------------------------------------------------------------------
create or replace function fcd.scorecard_named_ok(o uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (select 1 from fcd.orgs where id = o and kind = 'partner' and status in ('official', 'pending_verification'))
$$;
revoke all on function fcd.scorecard_named_ok(uuid) from public;
grant execute on function fcd.scorecard_named_ok(uuid) to fcd_public, fcd_user;

create policy scorecard_read_listed on fcd.scorecard_snapshots as restrictive for select to fcd_user using (
  entity_org_id is null or fcd.is_platform() or fcd.is_member(entity_org_id) or fcd.scorecard_named_ok(entity_org_id)
);

create or replace view fcd.v_scorecard_public as
  with cur as (select batch_id from fcd.scorecard_snapshots order by computed_at desc, created_at desc limit 1),
       rule as (select coalesce((select (value ->> 'minSamples')::int from fcd.v_current_settings where key = 'scorecard.rules'), 5) as min_n)
  select s.entity_kind, s.entity_org_id, s.port, s.mode, s.window_days, s.from_on, s.to_on, s.n, s.metrics, s.sources,
         case when s.entity_org_id is null then null else s.submission end as submission, s.certified,
         (s.demo_org_id is not null) as is_example, s.computed_at
    from fcd.scorecard_snapshots s, cur, rule
   where s.batch_id = cur.batch_id and s.n >= rule.min_n
     and (s.demo_org_id is null or fcd.demo_on())
     and (s.entity_org_id is null or (fcd.scorecard_named_public() and fcd.partner_listed(s.entity_org_id) and fcd.scorecard_named_ok(s.entity_org_id)));
grant select on fcd.v_scorecard_public to fcd_public, fcd_user;

-- ③ 이의 — 닫힌 이의는 받아들이기·돌려보내기·거두기를 더 받지 않는다 -------------------------------------------
-- 지금 상태 = 덧붙이기(note)를 뺀 마지막 줄(없으면 open) — 화면(src/lib/server/scorecard.ts disputes())·셈(store.ts)과 같은 규칙
create or replace function fcd.dispute_status(p_root uuid) returns text
language sql stable security definer set search_path = fcd, pg_temp as $$
  select coalesce(
    (select x.kind from fcd.scorecard_disputes x where x.root_id = p_root and x.kind <> 'note' order by x.created_at desc, x.id desc limit 1),
    'open')
$$;
revoke all on function fcd.dispute_status(uuid) from public;
grant execute on function fcd.dispute_status(uuid) to fcd_user;

create policy disputes_insert_open_only on fcd.scorecard_disputes as restrictive for insert to fcd_user with check (
  kind not in ('accepted', 'rejected', 'withdrawn') or fcd.dispute_status(root_id) = 'open'
);
