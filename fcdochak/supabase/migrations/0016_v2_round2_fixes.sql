-- FC도착 0016 — v2 2차 검토에서 나온 고침(0013 alliance · 0014 wing · 0015 research 보강)
--
-- 자료를 지우거나 덮지 않는다. 기존 정책은 지우지 않고 제한(restrictive) 정책을 덧붙여 좁힌다.
-- 함수는 같은 이름·같은 인자로 다시 만든다(create or replace) — 부르는 쪽은 그대로다.
--
--   ① fcd.alliance_ready — 「제휴 중」으로 바꿀 수 있는가(요건·서명한 계약 판 유효·플랫폼 상태). 운영 화면과 화주 카드가 같은 규칙을 쓴다
--   ② fcd.alliance_contract_party — ①을 쓰고, 플랫폼 상태가 정지·삭제인 업체를 빼고, 특수관계 업체는 뒤로
--   ③ fcd.alliance_settlement_chain_ok — 정산 명세의 새 판은 앞 판과 같은 계약 판(terms_id)이어야 한다
--   ④ fcd.research_invite_open · research_save — 한 번이라도 끝낸 판이 있으면 끝남(research_consent 와 같은 규칙)
--   ⑤ 제휴 신청·요건 올리기, WING 키 저장·폐기·꺼냄 — 그 조직의 관리자만(거래처 초대와 같은 규칙)

-- ① ---------------------------------------------------------------------------
create or replace function fcd.alliance_ready(p_alliance uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  with cfg as (
    select
      coalesce((select array(select jsonb_array_elements_text(value -> 'requiredKinds')) from fcd.v_current_settings where key = 'alliance.rules'),
               array['registration_cert', 'guarantee_bond', 'biz_reg', 'incident_history']) as kinds,
      coalesce((select (value ->> 'minBondAmount')::bigint from fcd.v_current_settings where key = 'alliance.rules'), 100000000) as min_bond,
      (now() at time zone 'Asia/Seoul')::date as today
  )
  select exists (
    select 1
      from fcd.alliance_partners a
      join fcd.orgs o on o.id = a.partner_org_id
      cross join cfg
     where a.id = p_alliance
       and o.status in ('official', 'pending_verification')
       and exists (
         select 1 from fcd.alliance_terms t
          where t.alliance_id = a.id and t.status = 'agreed' and cfg.today between t.valid_from and t.valid_until
            and not exists (select 1 from fcd.alliance_terms n where n.supersedes_id = t.id))
       and exists (
         select 1 from fcd.alliance_requirements r
          where r.alliance_id = a.id and r.kind = 'registration_cert' and r.status = 'verified'
            and not exists (select 1 from fcd.alliance_requirements n where n.supersedes_id = r.id))
       and not exists (
         select 1 from unnest(cfg.kinds) k(kind)
          where not exists (
            select 1 from fcd.alliance_requirements r
             where r.alliance_id = a.id and r.kind = k.kind and r.status = 'verified'
               and not exists (select 1 from fcd.alliance_requirements n where n.supersedes_id = r.id)
               and (r.valid_until is null or r.valid_until >= cfg.today)
               and (r.kind <> 'guarantee_bond' or coalesce(r.amount, 0) >= cfg.min_bond)))
  )
$$;
revoke all on function fcd.alliance_ready(uuid) from public;
grant execute on function fcd.alliance_ready(uuid) to fcd_user;

-- ② ---------------------------------------------------------------------------
create or replace function fcd.alliance_contract_party(p_prefer uuid)
returns table (partner_name text, reg_tail text, terms_no text, valid_until date, preferred boolean)
language sql stable security definer set search_path = fcd, pg_temp as $$
  with cfg as (
    select
      coalesce((select value = 'true'::jsonb from fcd.v_current_settings where key = 'v2.alliance_enabled'), false) as on_,
      (now() at time zone 'Asia/Seoul')::date as today
  ),
  cur_req as (
    select r.* from fcd.alliance_requirements r
    where not exists (select 1 from fcd.alliance_requirements n where n.supersedes_id = r.id)
  ),
  cur_terms as (
    select t.* from fcd.alliance_terms t
    where not exists (select 1 from fcd.alliance_terms n where n.supersedes_id = t.id)
  )
  select o.name, fcd.alliance_tail(reg.ref_no), t.terms_no, t.valid_until, (a.partner_org_id = p_prefer)
  from fcd.alliance_partners a
  join fcd.orgs o on o.id = a.partner_org_id
  cross join cfg
  join cur_terms t on t.alliance_id = a.id and t.status = 'agreed' and cfg.today between t.valid_from and t.valid_until
  join cur_req reg on reg.alliance_id = a.id and reg.kind = 'registration_cert' and reg.status = 'verified'
  where cfg.on_ and a.status = 'active' and fcd.org_visible(a.partner_org_id) and fcd.alliance_ready(a.id)
  -- 고른 업체 먼저 · 특수관계 업체는 뒤로(docs/alliance-plan.md 위험 표) · 가장 최근 서명
  order by (a.partner_org_id = p_prefer) desc, (o.related_party_note is not null) asc, t.signed_on desc nulls last, t.created_at desc
  limit 1
$$;

-- ③ ---------------------------------------------------------------------------
create or replace function fcd.alliance_settlement_chain_ok(p_alliance uuid, p_terms uuid, p_no text, p_super uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (select 1 from fcd.alliance_terms t where t.id = p_terms and t.alliance_id = p_alliance)
    and case when p_super is null then
      not exists (select 1 from fcd.alliance_settlements s where s.statement_no = p_no)
    else exists (
      select 1 from fcd.alliance_settlements s
      where s.id = p_super and s.alliance_id = p_alliance and s.statement_no = p_no and s.terms_id = p_terms
        and not exists (select 1 from fcd.alliance_settlements n where n.supersedes_id = s.id)
    ) end
$$;

-- ④ ---------------------------------------------------------------------------
create or replace function fcd.research_invite_open(p_hash text)
returns table (status text, consent_state text, head_id uuid, head_version integer, step text, answers jsonb, expires_at timestamptz)
language plpgsql security definer set search_path = fcd, pg_temp as $$
declare inv record; h record; st text; ever_done boolean;
begin
  select i.id, i.participant_id, i.org_id, i.expires_at, i.revoked_at into inv
    from fcd.research_invites i where i.token_hash = p_hash;
  if not found or not fcd.org_visible(inv.org_id) then
    return query select 'not_found'::text, null::text, null::uuid, null::integer, null::text, null::jsonb, null::timestamptz; return;
  end if;
  select r.id, r.version, r.step, r.answers, r.completed into h
    from fcd.research_responses r
   where r.participant_id = inv.participant_id and not exists (select 1 from fcd.research_responses n where n.supersedes_id = r.id);
  ever_done := exists (select 1 from fcd.research_responses r where r.participant_id = inv.participant_id and r.completed);
  st := case
    when inv.revoked_at is not null then 'revoked'
    when ever_done then 'completed'
    when inv.expires_at <= now() then 'expired'
    else 'open' end;
  return query select st, fcd.research_consent_now(inv.participant_id),
    case when st = 'open' then h.id end, case when st = 'open' then h.version end,
    case when st = 'open' then h.step end, case when st = 'open' then h.answers end, inv.expires_at;
end $$;

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
  -- 한 번이라도 끝낸 판이 있으면(운영이 대신 고친 판이 뒤에 쌓였어도) 링크로는 더 받지 않는다
  if exists (select 1 from fcd.research_responses r where r.participant_id = inv.participant_id and r.completed) then
    return query select 'completed'::text, null::uuid, null::integer; return;
  end if;
  select r.id, r.version into h from fcd.research_responses r
   where r.participant_id = inv.participant_id and not exists (select 1 from fcd.research_responses n where n.supersedes_id = r.id);
  nv := coalesce(h.version, 0) + 1;
  insert into fcd.research_responses (org_id, participant_id, invite_id, version, supersedes_id, source, step, completed, answers)
    values (inv.org_id, inv.participant_id, inv.id, nv, h.id, 'self',
            case when coalesce(p_complete, false) then 'done' else p_step end, coalesce(p_complete, false), p_answers)
    returning research_responses.id into nid;
  return query select 'ok'::text, nid, nv;
end $$;

-- ⑤ ---------------------------------------------------------------------------
-- 제휴 신청(applied)은 물류사 관리자만. 운영자의 후보 등록(candidate)은 그대로
create policy ap_insert_admin_only on fcd.alliance_partners as restrictive for insert to fcd_user with check (
  status <> 'applied' or fcd.is_org_admin(partner_org_id)
);
-- 요건 서류 올리기(submitted)는 물류사 관리자만. 운영자의 확인·반려 판은 그대로
create policy ar_insert_admin_only on fcd.alliance_requirements as restrictive for insert to fcd_user with check (
  fcd.is_platform() or fcd.is_org_admin(partner_org_id)
);
-- WING 키 저장·폐기(새 판)는 화주 관리자만
create policy wing_conn_insert_admin_only on fcd.wing_connections as restrictive for insert to fcd_user with check (
  fcd.is_org_admin(org_id)
);

-- 암호문 꺼내기 — 그 화주 조직의 관리자만(키를 넣고 거둘 수 있는 사람과 같다)
create or replace function fcd.wing_key_blob(p_conn uuid) returns text
language plpgsql volatile security definer set search_path = fcd, pg_temp as $$
declare
  c record;
begin
  if fcd.uid() is null then return null; end if;
  select w.id, w.org_id, w.key_blob into c
    from fcd.wing_connections w
   where w.id = p_conn and w.status <> 'revoked'
     and not exists (select 1 from fcd.wing_connections n where n.supersedes_id = w.id);
  if not found or not fcd.is_org_admin(c.org_id) or not fcd.org_visible(c.org_id) then return null; end if;
  insert into fcd.wing_access_log (org_id, connection_id, actor_id, action) values (c.org_id, c.id, fcd.uid(), 'key_decrypted');
  return c.key_blob;
end $$;

-- ⑥ 선적 화면의 WING 입고 요청 한 줄 ------------------------------------------------------
-- 짝을 확정한 입고 요청(현재 판)을 그 선적을 볼 수 있는 사람(화주·맡은 물류사·운영)에게 낸다.
-- 물류사는 wing_* 표를 읽지 못하므로 이 함수로만, 번호·FC·예정일·수량·입고 결과만 받는다(키·접근 기록 없음).
create or replace function fcd.wing_inbound_for_shipment(p_ship uuid)
returns table (external_no text, fc_code text, center_name text, planned_on date, units integer, boxes integer, status_raw text, received_units integer, returned_units integer, source text)
language sql stable security definer set search_path = fcd, pg_temp as $$
  select r.external_no, r.fc_code, r.center_name, r.planned_on, r.units, r.boxes, r.status_raw, r.received_units, r.returned_units, r.source
    from fcd.wing_matches m
    join fcd.shipments s on s.id = m.shipment_id
    join fcd.wing_inbound_requests r on r.org_id = m.org_id and r.external_no = m.external_no
   where m.shipment_id = p_ship and m.action = 'confirmed' and m.org_id = s.shipper_org_id
     and not exists (select 1 from fcd.wing_matches n where n.supersedes_id = m.id)
     and not exists (select 1 from fcd.wing_inbound_requests n where n.supersedes_id = r.id)
     and fcd.can_see_shipment(p_ship)
   limit 1
$$;
revoke all on function fcd.wing_inbound_for_shipment(uuid) from public;
grant execute on function fcd.wing_inbound_for_shipment(uuid) to fcd_user;
