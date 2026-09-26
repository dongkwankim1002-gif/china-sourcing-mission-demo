-- FC도착 0015 — 셀러 인터뷰 · 먼저 검증할 실험 셋(v2 interview) — docs/research-plan.md
--   ① research_participants   인터뷰 대상 — 운영이 넣는다. 연락처는 선택이고 화면에는 가려서
--      research_consents      동의 여부·시각·방식(스스로/구두)·문구 판 — 쌓기만(철회도 한 줄)
--   ② research_invites        1회용 링크 — 토큰은 sha-256 만, 만료·거두기, 응답을 끝내면 닫힘
--   ③ research_responses      답변 — 쌓기만 한다. 진행 저장·고침은 새 판(supersedes_id), 참여자마다 한 줄기
--   ④ research_vendor_quotes  실험 3 — 콘솔사·포워더 물량별 CBM 당 단가(운영이 넣음, 새 판)
--   ⑤ check_funnel_events     실험 2 — /check 방문·입력·점검·보관(익명 기기 번호 해시만). fcd.events 는 조직이 필수라 따로 둔다
--
-- 읽기는 운영(플랫폼 관리자)만. 링크를 받은 셀러는 표 권한이 없고, 아래 security definer 함수로
-- 자기 토큰의 자기 응답만 이어 읽고 쓴다. 데모 자료는 데모 운영 조직(is_demo) 아래 — 조직을 지우면 CASCADE.
-- 이 파일은 자료를 지우거나 덮지 않는다.

-- ① 대상 -------------------------------------------------------------------------
create table fcd.research_participants (
  id uuid primary key default gen_random_uuid(),
  -- 조사를 하는 운영 조직(플랫폼)
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  code text not null check (code ~ '^P-[0-9]{2,4}$'),
  -- 부르는 이름 — 실명이 아니어도 된다(「셀러 07」)
  label text not null check (length(btrim(label)) between 1 and 60),
  -- 선택. 화면에는 가려서 보이고, 풀어 볼 때 감사 기록이 남는다(fcd.research_contact)
  contact text check (contact is null or length(contact) <= 120),
  -- 모집 기준: chinaSourcing·rocketGrowth·lcl(참/거짓), monthlyShipments(정수), channel(모집 경로)
  recruit jsonb not null default '{}'::jsonb check (jsonb_typeof(recruit) = 'object' and pg_column_size(recruit) < 2000),
  scheduled_at timestamptz,
  note text check (note is null or length(note) <= 400),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (org_id, code)
);
create index research_participants_org_idx on fcd.research_participants (org_id, created_at desc);

-- 동의 기록 — 쌓기만 한다(동의·거부·철회가 모두 한 줄씩 남는다). 지금 상태 = 가장 최근 줄
create table fcd.research_consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  participant_id uuid not null references fcd.research_participants (id) on delete cascade,
  state text not null check (state in ('agreed', 'declined', 'withdrawn')),
  -- self = 셀러가 링크 화면에서 · verbal = 통화에서 받은 구두 동의(운영이 적음)
  method text not null check (method in ('self', 'verbal')),
  version text not null check (length(version) between 1 and 40),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index research_consents_part_idx on fcd.research_consents (participant_id, created_at desc);

create or replace function fcd.research_consent_now(p_participant uuid) returns text
language sql stable security definer set search_path = fcd, pg_temp as $$
  select coalesce((select c.state from fcd.research_consents c where c.participant_id = p_participant order by c.created_at desc, c.id desc limit 1), 'none')
$$;
revoke all on function fcd.research_consent_now(uuid) from public;

-- 연락처 가리기 — 010-****-5678 · ab***@example.com · 그 밖은 앞 두 글자만
create or replace function fcd.mask_contact(p text) returns text
language sql immutable as $$
  select case
    when p is null or btrim(p) = '' then null
    when p ~ '@' then left(split_part(p, '@', 1), 2) || '***@' || split_part(p, '@', 2)
    when regexp_replace(p, '[^0-9]', '', 'g') ~ '^[0-9]{8,}$' then
      left(regexp_replace(p, '[^0-9]', '', 'g'), 3) || '-****-' || right(regexp_replace(p, '[^0-9]', '', 'g'), 4)
    else left(p, 2) || repeat('*', greatest(length(p) - 2, 1))
  end
$$;
revoke all on function fcd.mask_contact(text) from public;
grant execute on function fcd.mask_contact(text) to fcd_user;

-- ② 1회용 링크 -----------------------------------------------------------------------
create table fcd.research_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  participant_id uuid not null references fcd.research_participants (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index research_invites_part_idx on fcd.research_invites (participant_id, created_at desc);

-- ③ 답변 ---------------------------------------------------------------------------
create table fcd.research_responses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  participant_id uuid not null references fcd.research_participants (id) on delete cascade,
  invite_id uuid references fcd.research_invites (id) on delete set null,
  version integer not null check (version >= 1),
  supersedes_id uuid references fcd.research_responses (id) on delete cascade,
  -- self = 셀러가 링크로 · interviewer = 운영이 통화하며 대신 적음
  source text not null check (source in ('self', 'interviewer')),
  step text not null check (step in ('consent', 'lane', 'screens', 'ladder', 'habits', 'comment', 'done')),
  completed boolean not null default false,
  answers jsonb not null check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) < 32000),
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((supersedes_id is null) = (version = 1)),
  check (not completed or step = 'done')
);
create unique index research_responses_one_root on fcd.research_responses (participant_id) where supersedes_id is null;
create unique index research_responses_one_successor on fcd.research_responses (supersedes_id) where supersedes_id is not null;
create index research_responses_org_idx on fcd.research_responses (org_id, created_at desc);

create view fcd.v_research_responses_current with (security_invoker = true) as
  select r.* from fcd.research_responses r
  where not exists (select 1 from fcd.research_responses n where n.supersedes_id = r.id);

-- 새 판을 이어도 되는가: 첫 판이면 그 참여자에게 아직 판이 없고, 새 판이면 같은 참여자의 현재 판을 잇는다
create or replace function fcd.research_chain_ok(p_participant uuid, p_super uuid, p_version integer) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select case
    when p_super is null then p_version = 1 and not exists (select 1 from fcd.research_responses r where r.participant_id = p_participant)
    else exists (
      select 1 from fcd.research_responses r
      where r.id = p_super and r.participant_id = p_participant and r.version + 1 = p_version
        and not exists (select 1 from fcd.research_responses n where n.supersedes_id = r.id))
  end
$$;
revoke all on function fcd.research_chain_ok(uuid, uuid, integer) from public;
grant execute on function fcd.research_chain_ok(uuid, uuid, integer) to fcd_user;

-- ④ 실험 3 — 물량 단가 ---------------------------------------------------------------
create table fcd.research_vendor_quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  -- 운영이 넣는 부르는 이름(공개하지 않음)
  vendor_label text not null check (length(btrim(vendor_label)) between 1 and 60),
  vendor_kind text not null check (vendor_kind in ('consolidator', 'forwarder')),
  hub text references fcd.hubs (code),
  port text references fcd.ports (code),
  mode text check (mode in ('LCL', 'FERRY', 'FCL', 'AIR')),
  -- 무엇까지 포함한 단가인가 — 다른 범위끼리는 곡선에 섞지 않는다
  includes text not null check (includes in ('sea_cfs', 'to_port', 'to_fc')),
  volume_cbm numeric(8, 2) not null check (volume_cbm > 0 and volume_cbm <= 10000),
  unit_price_krw bigint not null check (unit_price_krw >= 0 and unit_price_krw <= 100000000),
  source text not null check (source in ('call', 'email', 'quote_doc', 'other')),
  quoted_on date not null,
  note text check (note is null or length(note) <= 400),
  supersedes_id uuid references fcd.research_vendor_quotes (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index research_vendor_quotes_one_successor on fcd.research_vendor_quotes (supersedes_id) where supersedes_id is not null;
create index research_vendor_quotes_org_idx on fcd.research_vendor_quotes (org_id, created_at desc);

create view fcd.v_research_vendor_quotes_current with (security_invoker = true) as
  select v.* from fcd.research_vendor_quotes v
  where not exists (select 1 from fcd.research_vendor_quotes n where n.supersedes_id = v.id);

-- ⑤ 실험 2 — /check 퍼널 ---------------------------------------------------------------
-- 사람을 알아보지 않는다: 브라우저가 만든 무작위 기기 번호의 sha-256 만. IP·계정·청구서 내용 없음.
-- org_id 는 데모 자료에만 채운다(데모 운영 조직 — 걷어내기 CASCADE). 실제 방문은 비어 있다.
create table fcd.check_funnel_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references fcd.orgs (id) on delete cascade,
  kind text not null check (kind in ('check_visit', 'check_input', 'check_run', 'check_saved')),
  method text check (method in ('paste', 'excel', 'manual')),
  visitor_hash text not null check (visitor_hash ~ '^[0-9a-f]{64}$'),
  logged_in boolean not null default false,
  occurred_at timestamptz not null default now()
);
create index check_funnel_kind_idx on fcd.check_funnel_events (kind, occurred_at desc);

-- 권한 · RLS ------------------------------------------------------------------------
alter table fcd.research_participants enable row level security;
alter table fcd.research_invites enable row level security;
alter table fcd.research_responses enable row level security;
alter table fcd.research_vendor_quotes enable row level security;
alter table fcd.check_funnel_events enable row level security;

-- 대상: 운영만. 연락처 칸은 읽기 권한에서 뺀다(가린 값은 v_research_participants, 푼 값은 fcd.research_contact 로만)
grant select (id, org_id, code, label, recruit, scheduled_at, note, created_by, created_at)
  on fcd.research_participants to fcd_user;
grant insert (org_id, code, label, contact, recruit, scheduled_at, note, created_by) on fcd.research_participants to fcd_user;
-- 고치기는 일정·메모·모집 기준·연락처(지우기 포함)만. 동의는 research_consents 에 새 줄로
grant update (label, contact, recruit, scheduled_at, note) on fcd.research_participants to fcd_user;
create policy research_participants_read on fcd.research_participants for select to fcd_user using (
  fcd.is_platform() and fcd.org_visible(org_id)
);
create policy research_participants_insert on fcd.research_participants for insert to fcd_user with check (
  fcd.is_platform() and fcd.is_member(org_id) and fcd.org_kind(org_id) = 'platform' and created_by = fcd.uid()
);
create policy research_participants_update on fcd.research_participants for update to fcd_user
  using (fcd.is_platform() and fcd.org_visible(org_id))
  with check (fcd.is_platform() and fcd.org_visible(org_id));

-- 가린 연락처와 함께 보기 — 보기 주인 권한으로 돌지만 운영자에게만 줄을 낸다
create view fcd.v_research_participants as
  select p.id, p.org_id, p.code, p.label, fcd.mask_contact(p.contact) contact_masked, (p.contact is not null) has_contact,
         p.recruit, p.scheduled_at, p.note,
         coalesce(c.state, 'none') consent_state, c.created_at consent_at, c.method consent_method, c.version consent_version,
         p.created_by, p.created_at, o.is_demo
    from fcd.research_participants p join fcd.orgs o on o.id = p.org_id
    left join lateral (
      select x.state, x.created_at, x.method, x.version from fcd.research_consents x
       where x.participant_id = p.id order by x.created_at desc, x.id desc limit 1
    ) c on true
   where fcd.is_platform() and fcd.org_visible(p.org_id);
grant select on fcd.v_research_participants to fcd_user;

-- 연락처 풀어 보기 — 운영자만, 볼 때마다 감사 기록
create or replace function fcd.research_contact(p_id uuid) returns text
language plpgsql security definer set search_path = fcd, pg_temp as $$
declare c text; o uuid;
begin
  if fcd.uid() is null or not fcd.is_platform() then return null; end if;
  select contact, org_id into c, o from fcd.research_participants where id = p_id and fcd.org_visible(org_id);
  if not found then return null; end if;
  insert into fcd.audit_log (actor_id, org_id, action, target, detail)
    values (fcd.uid(), o, 'research.contact_viewed', 'research_participant:' || p_id, null);
  return c;
end $$;
revoke all on function fcd.research_contact(uuid) from public;
grant execute on function fcd.research_contact(uuid) to fcd_user;

-- 초대: 운영만. 해시 칸은 읽기 권한에서 뺀다. 고치기는 거두기(한 번, 지금 이전 시각)만
grant select (id, org_id, participant_id, expires_at, revoked_at, created_by, created_at) on fcd.research_invites to fcd_user;
grant insert (org_id, participant_id, token_hash, expires_at, created_by) on fcd.research_invites to fcd_user;
grant update (revoked_at) on fcd.research_invites to fcd_user;
create policy research_invites_read on fcd.research_invites for select to fcd_user using (fcd.is_platform() and fcd.org_visible(org_id));
create policy research_invites_insert on fcd.research_invites for insert to fcd_user with check (
  fcd.is_platform() and fcd.is_member(org_id) and created_by = fcd.uid()
  and exists (select 1 from fcd.research_participants p where p.id = participant_id and p.org_id = research_invites.org_id)
);
create policy research_invites_revoke on fcd.research_invites for update to fcd_user
  using (fcd.is_platform() and fcd.org_visible(org_id) and revoked_at is null)
  with check (revoked_at is not null and revoked_at <= now());

-- 동의: 운영만 읽기. 운영이 넣는 것은 구두 동의(verbal)만 — 셀러 스스로의 동의는 아래 함수로만
alter table fcd.research_consents enable row level security;
grant select, insert on fcd.research_consents to fcd_user;
create policy research_consents_read on fcd.research_consents for select to fcd_user using (fcd.is_platform() and fcd.org_visible(org_id));
create policy research_consents_insert on fcd.research_consents for insert to fcd_user with check (
  fcd.is_platform() and fcd.is_member(org_id) and created_by = fcd.uid() and method = 'verbal'
  and exists (select 1 from fcd.research_participants p where p.id = participant_id and p.org_id = research_consents.org_id)
);

-- 답변: 운영만 읽기. 운영의 쓰기는 인터뷰어 모드(대신 적기)만, 새 판으로. UPDATE·DELETE 없음
grant select, insert on fcd.research_responses to fcd_user;
grant select on fcd.v_research_responses_current to fcd_user;
create policy research_responses_read on fcd.research_responses for select to fcd_user using (fcd.is_platform() and fcd.org_visible(org_id));
create policy research_responses_insert on fcd.research_responses for insert to fcd_user with check (
  fcd.is_platform() and fcd.is_member(org_id) and created_by = fcd.uid() and source = 'interviewer'
  and exists (select 1 from fcd.research_participants p where p.id = participant_id and p.org_id = research_responses.org_id)
  and fcd.research_chain_ok(participant_id, supersedes_id, version)
);

-- 물량 단가: 운영만. 새 판으로만(UPDATE·DELETE 없음)
grant select, insert on fcd.research_vendor_quotes to fcd_user;
grant select on fcd.v_research_vendor_quotes_current to fcd_user;
create policy research_vendor_quotes_read on fcd.research_vendor_quotes for select to fcd_user using (fcd.is_platform() and fcd.org_visible(org_id));
create policy research_vendor_quotes_insert on fcd.research_vendor_quotes for insert to fcd_user with check (
  fcd.is_platform() and fcd.is_member(org_id) and created_by = fcd.uid()
  and (supersedes_id is null or exists (
        select 1 from fcd.research_vendor_quotes v where v.id = supersedes_id and v.org_id = research_vendor_quotes.org_id))
);

-- 퍼널: 운영만 읽기. 쓰기는 아래 함수로만(표 INSERT 권한 없음)
grant select on fcd.check_funnel_events to fcd_user;
create policy check_funnel_read on fcd.check_funnel_events for select to fcd_user using (
  fcd.is_platform() and (org_id is null or fcd.org_visible(org_id))
);

create or replace function fcd.record_check_event(p_kind text, p_method text, p_visitor text, p_logged_in boolean) returns boolean
language plpgsql security definer set search_path = fcd, pg_temp as $$
begin
  if p_kind not in ('check_visit', 'check_input', 'check_run', 'check_saved') then return false; end if;
  if p_method is not null and p_method not in ('paste', 'excel', 'manual') then return false; end if;
  if p_visitor is null or p_visitor !~ '^[0-9a-f]{64}$' then return false; end if;
  insert into fcd.check_funnel_events (kind, method, visitor_hash, logged_in) values (p_kind, p_method, p_visitor, coalesce(p_logged_in, false));
  return true;
end $$;
revoke all on function fcd.record_check_event(text, text, text, boolean) from public;
grant execute on function fcd.record_check_event(text, text, text, boolean) to fcd_public, fcd_user;

-- 링크를 받은 셀러(로그인 없음)용 함수 ------------------------------------------------------
-- 상태: open · completed · expired · revoked · not_found. 열린 링크일 때만 자기 현재 판 답변을 돌려준다.
create or replace function fcd.research_invite_open(p_hash text)
returns table (status text, consent_state text, head_id uuid, head_version integer, step text, answers jsonb, expires_at timestamptz)
language plpgsql security definer set search_path = fcd, pg_temp as $$
declare inv record; h record; st text;
begin
  select i.id, i.participant_id, i.org_id, i.expires_at, i.revoked_at into inv
    from fcd.research_invites i where i.token_hash = p_hash;
  if not found or not fcd.org_visible(inv.org_id) then
    return query select 'not_found'::text, null::text, null::uuid, null::integer, null::text, null::jsonb, null::timestamptz; return;
  end if;
  select r.id, r.version, r.step, r.answers, r.completed into h
    from fcd.research_responses r
   where r.participant_id = inv.participant_id and not exists (select 1 from fcd.research_responses n where n.supersedes_id = r.id);
  st := case
    when inv.revoked_at is not null then 'revoked'
    when h.completed is true then 'completed'
    when inv.expires_at <= now() then 'expired'
    else 'open' end;
  return query select st, fcd.research_consent_now(inv.participant_id),
    case when st = 'open' then h.id end, case when st = 'open' then h.version end,
    case when st = 'open' then h.step end, case when st = 'open' then h.answers end, inv.expires_at;
end $$;
revoke all on function fcd.research_invite_open(text) from public;
grant execute on function fcd.research_invite_open(text) to fcd_public, fcd_user;

-- 동의 — 열린 링크에서만. 동의하지 않으면 declined 로 적고 아무 답도 받지 않는다.
create or replace function fcd.research_consent(p_hash text, p_agree boolean, p_version text) returns text
language plpgsql security definer set search_path = fcd, pg_temp as $$
declare inv record;
begin
  select i.id, i.participant_id, i.org_id, i.expires_at, i.revoked_at into inv from fcd.research_invites i where i.token_hash = p_hash for update;
  if not found or not fcd.org_visible(inv.org_id) then return 'not_found'; end if;
  if inv.revoked_at is not null then return 'revoked'; end if;
  if inv.expires_at <= now() then return 'expired'; end if;
  if exists (select 1 from fcd.research_responses r where r.participant_id = inv.participant_id and r.completed) then return 'completed'; end if;
  if p_version is null or length(p_version) > 40 then return 'bad_version'; end if;
  insert into fcd.research_consents (org_id, participant_id, state, method, version)
    values (inv.org_id, inv.participant_id, case when p_agree then 'agreed' else 'declined' end, 'self', p_version);
  return case when p_agree then 'ok' else 'declined' end;
end $$;
revoke all on function fcd.research_consent(text, boolean, text) from public;
grant execute on function fcd.research_consent(text, boolean, text) to fcd_public, fcd_user;

-- 진행 저장 — 열린 링크 · 동의함 · 아직 안 끝남. 참여자의 현재 판을 잇는 새 판을 넣는다(두 창이 겨루면 한쪽만 들어간다).
create or replace function fcd.research_save(p_hash text, p_step text, p_answers jsonb, p_complete boolean)
returns table (result text, id uuid, version integer)
language plpgsql security definer set search_path = fcd, pg_temp as $$
declare inv record; h record; nid uuid; nv integer;
begin
  select i.id, i.participant_id, i.org_id, i.expires_at, i.revoked_at into inv from fcd.research_invites i where i.token_hash = p_hash for update;
  if not found or not fcd.org_visible(inv.org_id) then return query select 'not_found'::text, null::uuid, null::integer; return; end if;
  if inv.revoked_at is not null then return query select 'revoked'::text, null::uuid, null::integer; return; end if;
  if inv.expires_at <= now() then return query select 'expired'::text, null::uuid, null::integer; return; end if;
  if fcd.research_consent_now(inv.participant_id) <> 'agreed' then
    return query select 'no_consent'::text, null::uuid, null::integer; return;
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then return query select 'bad_answers'::text, null::uuid, null::integer; return; end if;
  select r.id, r.version, r.completed into h from fcd.research_responses r
   where r.participant_id = inv.participant_id and not exists (select 1 from fcd.research_responses n where n.supersedes_id = r.id);
  if h.completed is true then return query select 'completed'::text, null::uuid, null::integer; return; end if;
  nv := coalesce(h.version, 0) + 1;
  insert into fcd.research_responses (org_id, participant_id, invite_id, version, supersedes_id, source, step, completed, answers)
    values (inv.org_id, inv.participant_id, inv.id, nv, h.id, 'self',
            case when coalesce(p_complete, false) then 'done' else p_step end, coalesce(p_complete, false), p_answers)
    returning research_responses.id into nid;
  return query select 'ok'::text, nid, nv;
end $$;
revoke all on function fcd.research_save(text, text, jsonb, boolean) from public;
grant execute on function fcd.research_save(text, text, jsonb, boolean) to fcd_public, fcd_user;
