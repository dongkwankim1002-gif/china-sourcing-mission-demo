-- FC도착 0003 — 누가 무엇을 보는가 (RLS)
--
-- 원칙
--   · 모든 표에 RLS 를 켠다. 정책이 없으면 아무도 못 본다.
--   · 어떤 역할에도 DELETE 권한이 없다 — 예외는 조직의 거점·방식·취급 능력·알림 설정(편집용 연결표).
--   · 요금표·응찰·청구서·상태 이력·등급·감사·설정에는 UPDATE 권한이 없다 — 새 판으로만 쌓인다.
--   · DEMO_MODE=off 면 데모 조직과 그 아래 전부가 안 보인다. 운영자는 늘 본다(화면에 표시가 붙는다).

-- 도움 함수 — 정책 안에서 RLS 가 되돌아 걸리지 않게 security definer 로.

create or replace function fcd.my_org_ids() returns setof uuid
language sql stable security definer set search_path = fcd, pg_temp as $$
  select org_id from fcd.memberships where user_id = fcd.uid()
$$;

create or replace function fcd.is_member(o uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (select 1 from fcd.memberships where user_id = fcd.uid() and org_id = o)
$$;

create or replace function fcd.is_org_admin(o uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (
    select 1 from fcd.memberships
    where user_id = fcd.uid() and org_id = o and role in ('shipper_admin', 'partner_admin', 'platform_admin')
  )
$$;

create or replace function fcd.is_platform() returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (
    select 1 from fcd.memberships m join fcd.orgs o on o.id = m.org_id
    where m.user_id = fcd.uid() and m.role = 'platform_admin' and o.kind = 'platform'
  )
$$;

create or replace function fcd.org_visible(o uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select fcd.is_platform() or fcd.demo_on() or not coalesce((select is_demo from fcd.orgs where id = o), false)
$$;

create or replace function fcd.org_kind(o uuid) returns text
language sql stable security definer set search_path = fcd, pg_temp as $$
  select kind from fcd.orgs where id = o
$$;

create or replace function fcd.org_status(o uuid) returns text
language sql stable security definer set search_path = fcd, pg_temp as $$
  select status from fcd.orgs where id = o
$$;

-- 공개 면에 실리는 업체 상태
create or replace function fcd.partner_listed(o uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (
    select 1 from fcd.orgs
    where id = o and kind = 'partner' and status in ('public_info', 'pending_verification', 'official')
  ) and fcd.org_visible(o)
$$;

-- 요금을 낼 수 있는 업체 상태(공식 + 인증 대기)
create or replace function fcd.partner_priced(o uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (
    select 1 from fcd.orgs where id = o and kind = 'partner' and status in ('pending_verification', 'official')
  ) and fcd.org_visible(o)
$$;

-- 두 조직 사이에 예약이 있는가(화주 이름은 예약 뒤에만 물류사에 보인다)
create or replace function fcd.has_booking_with(o uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (
    select 1 from fcd.bookings b
    where (b.shipper_org_id = o and b.partner_org_id in (select fcd.my_org_ids()))
       or (b.partner_org_id = o and b.shipper_org_id in (select fcd.my_org_ids()))
  )
$$;

-- 행 값으로 판정 — 자기 표의 읽기 정책은 이쪽을 쓴다.
-- (INSERT … RETURNING 때 같은 문장이 넣은 새 행은 id 로 다시 찾아도 보이지 않는다)
create or replace function fcd.request_row_visible(p_org uuid, p_id uuid, p_status text, p_hub text) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select fcd.org_visible(p_org) and (
    fcd.is_member(p_org)
    or fcd.is_platform()
    or exists (select 1 from fcd.bids b where b.request_id = p_id and b.org_id in (select fcd.my_org_ids()))
    or (p_status = 'open' and exists (
          select 1 from fcd.org_hubs h
          where h.hub = p_hub and h.org_id in (select fcd.my_org_ids()) and fcd.partner_priced(h.org_id)))
  )
$$;

create or replace function fcd.can_see_request(r uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (
    select 1 from fcd.quote_requests q
    where q.id = r and fcd.request_row_visible(q.org_id, q.id, q.status, q.origin_hub)
  )
$$;

create or replace function fcd.shipment_row_visible(p_shipper uuid, p_partner uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select fcd.org_visible(p_shipper) and fcd.org_visible(p_partner)
    and (fcd.is_member(p_shipper) or fcd.is_member(p_partner) or fcd.is_platform())
$$;

create or replace function fcd.can_see_shipment(s uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (
    select 1 from fcd.shipments x
    where x.id = s and fcd.shipment_row_visible(x.shipper_org_id, x.partner_org_id)
  )
$$;

create or replace function fcd.is_shipment_partner(s uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (select 1 from fcd.shipments x where x.id = s and fcd.is_member(x.partner_org_id))
$$;

create or replace function fcd.is_shipment_shipper(s uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (select 1 from fcd.shipments x where x.id = s and fcd.is_member(x.shipper_org_id))
$$;

-- 화주 조직 소속인가(요금표 전체는 화주만 본다 — 물류사끼리는 서로의 비공개 요금을 못 본다)
create or replace function fcd.i_am_shipper() returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (
    select 1 from fcd.memberships m join fcd.orgs o on o.id = m.org_id
    where m.user_id = fcd.uid() and o.kind = 'shipper' and fcd.org_visible(o.id)
  )
$$;

create or replace function fcd.rate_card_row_visible(p_org uuid, p_public boolean, p_status text) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select fcd.org_visible(p_org) and (
    fcd.is_member(p_org) or fcd.is_platform()
    or (fcd.i_am_shipper() and fcd.partner_priced(p_org))
    or (p_public and fcd.partner_priced(p_org) and p_status = 'active')
  )
$$;

create or replace function fcd.can_see_rate_card(c uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (
    select 1 from fcd.rate_cards r
    where r.id = c and fcd.rate_card_row_visible(r.org_id, r.is_public_price, r.status)
  )
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'my_org_ids()', 'is_member(uuid)', 'is_org_admin(uuid)', 'is_platform()', 'org_visible(uuid)',
    'org_kind(uuid)', 'org_status(uuid)', 'partner_listed(uuid)', 'partner_priced(uuid)',
    'has_booking_with(uuid)', 'can_see_request(uuid)', 'can_see_shipment(uuid)',
    'is_shipment_partner(uuid)', 'is_shipment_shipper(uuid)', 'can_see_rate_card(uuid)', 'i_am_shipper()',
    'request_row_visible(uuid, uuid, text, text)', 'shipment_row_visible(uuid, uuid)', 'rate_card_row_visible(uuid, boolean, text)'
  ] loop
    execute format('revoke all on function fcd.%s from public', f);
    execute format('grant execute on function fcd.%s to fcd_public, fcd_user', f);
  end loop;
end $$;

-- RLS 켜기: fcd 스키마의 모든 표 ----------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'fcd' loop
    execute format('alter table fcd.%I enable row level security', t);
  end loop;
end $$;

-- 참조: 누구나 읽는다 --------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['hubs', 'ports', 'modes', 'fc_centers', 'segments', 'cargo_traits', 'settings', 'duty_rates'] loop
    execute format('grant select on fcd.%I to fcd_public, fcd_user', t);
    execute format('create policy %I on fcd.%I for select to fcd_public, fcd_user using (true)', t || '_read', t);
  end loop;
end $$;

grant insert on fcd.settings, fcd.duty_rates to fcd_user;
create policy settings_write on fcd.settings for insert to fcd_user with check (fcd.is_platform());
create policy duty_rates_write on fcd.duty_rates for insert to fcd_user with check (fcd.is_platform());

-- 조직 -----------------------------------------------------------------------
grant select on fcd.orgs to fcd_public, fcd_user;
grant insert, update on fcd.orgs to fcd_user;
create policy orgs_public on fcd.orgs for select to fcd_public using (fcd.partner_listed(id));
create policy orgs_user on fcd.orgs for select to fcd_user using (
  fcd.org_visible(id) and (
    fcd.is_member(id) or fcd.is_platform() or fcd.partner_listed(id) or fcd.has_booking_with(id)
  )
);
create policy orgs_insert on fcd.orgs for insert to fcd_user with check (fcd.is_platform());
create policy orgs_update on fcd.orgs for update to fcd_user
  using (fcd.is_org_admin(id) or fcd.is_platform())
  with check (fcd.is_org_admin(id) or fcd.is_platform());

do $$
declare t text;
begin
  foreach t in array array['org_hubs', 'org_modes', 'org_capabilities'] loop
    execute format('grant select on fcd.%I to fcd_public, fcd_user', t);
    execute format('grant insert, delete on fcd.%I to fcd_user', t);
    execute format('create policy %I on fcd.%I for select to fcd_public using (fcd.partner_listed(org_id))', t || '_public', t);
    execute format('create policy %I on fcd.%I for select to fcd_user using (fcd.org_visible(org_id) and (fcd.is_member(org_id) or fcd.is_platform() or fcd.partner_listed(org_id)))', t || '_user', t);
    execute format('create policy %I on fcd.%I for insert to fcd_user with check (fcd.is_org_admin(org_id) or fcd.is_platform())', t || '_insert', t);
    execute format('create policy %I on fcd.%I for delete to fcd_user using (fcd.is_org_admin(org_id) or fcd.is_platform())', t || '_delete', t);
  end loop;
end $$;

-- 사람 -----------------------------------------------------------------------
grant select, update on fcd.profiles to fcd_user;
create policy profiles_read on fcd.profiles for select to fcd_user using (
  id = fcd.uid() or fcd.is_platform() or (fcd.is_member(home_org_id) and fcd.org_visible(home_org_id))
);
create policy profiles_update on fcd.profiles for update to fcd_user
  using (id = fcd.uid()) with check (id = fcd.uid());

grant select on fcd.memberships to fcd_user;
create policy memberships_read on fcd.memberships for select to fcd_user using (
  user_id = fcd.uid() or fcd.is_member(org_id) or fcd.is_platform()
);
-- local_credentials: 어떤 요청 역할에도 권한 없음(서버 시스템 경로만).

-- 요금표 — 수정 권한 없음, 새 판만 --------------------------------------------
grant select on fcd.rate_cards, fcd.rate_card_lines, fcd.rate_card_tiers to fcd_public, fcd_user;
grant insert on fcd.rate_cards, fcd.rate_card_lines, fcd.rate_card_tiers to fcd_user;
create policy rate_cards_read on fcd.rate_cards for select to fcd_public, fcd_user using (fcd.rate_card_row_visible(org_id, is_public_price, status));
create policy rate_cards_insert on fcd.rate_cards for insert to fcd_user with check (
  fcd.is_member(org_id) and fcd.org_kind(org_id) = 'partner' and fcd.org_status(org_id) <> 'deleted'
);
create policy rate_card_lines_read on fcd.rate_card_lines for select to fcd_public, fcd_user using (fcd.can_see_rate_card(rate_card_id));
create policy rate_card_lines_insert on fcd.rate_card_lines for insert to fcd_user with check (
  exists (select 1 from fcd.rate_cards r where r.id = rate_card_id and fcd.is_member(r.org_id))
);
create policy rate_card_tiers_read on fcd.rate_card_tiers for select to fcd_public, fcd_user using (fcd.can_see_rate_card(rate_card_id));
create policy rate_card_tiers_insert on fcd.rate_card_tiers for insert to fcd_user with check (
  exists (select 1 from fcd.rate_cards r where r.id = rate_card_id and fcd.is_member(r.org_id))
);

-- SKU -----------------------------------------------------------------------
grant select, insert, update on fcd.skus to fcd_user;
create policy skus_read on fcd.skus for select to fcd_user using (
  fcd.org_visible(org_id) and (fcd.is_member(org_id) or fcd.is_platform())
);
create policy skus_insert on fcd.skus for insert to fcd_user with check (fcd.is_member(org_id) and fcd.org_kind(org_id) = 'shipper');
create policy skus_update on fcd.skus for update to fcd_user using (fcd.is_member(org_id)) with check (fcd.is_member(org_id));

-- 견적 요청 ------------------------------------------------------------------
grant select, insert, update on fcd.quote_requests to fcd_user;
create policy qr_read on fcd.quote_requests for select to fcd_user using (fcd.request_row_visible(org_id, id, status, origin_hub));
create policy qr_insert on fcd.quote_requests for insert to fcd_user with check (
  fcd.is_member(org_id) and fcd.org_kind(org_id) = 'shipper'
);
create policy qr_update on fcd.quote_requests for update to fcd_user
  using (fcd.is_member(org_id)) with check (fcd.is_member(org_id));

grant select, insert on fcd.quote_request_events to fcd_user;
create policy qre_read on fcd.quote_request_events for select to fcd_user using (fcd.can_see_request(request_id));
create policy qre_insert on fcd.quote_request_events for insert to fcd_user with check (fcd.can_see_request(request_id));

-- 응찰 — 수정 권한 없음 --------------------------------------------------------
grant select, insert on fcd.bids to fcd_user;
create policy bids_read on fcd.bids for select to fcd_user using (
  fcd.org_visible(org_id) and (
    fcd.is_member(org_id) or fcd.is_platform()
    or exists (select 1 from fcd.quote_requests q where q.id = request_id and fcd.is_member(q.org_id))
  )
);
create policy bids_insert on fcd.bids for insert to fcd_user with check (
  fcd.is_member(org_id) and fcd.partner_priced(org_id) and fcd.can_see_request(request_id)
);

-- 예약·선적 ------------------------------------------------------------------
grant select, insert on fcd.bookings to fcd_user;
create policy bookings_read on fcd.bookings for select to fcd_user using (
  fcd.org_visible(shipper_org_id) and fcd.org_visible(partner_org_id) and
  (fcd.is_member(shipper_org_id) or fcd.is_member(partner_org_id) or fcd.is_platform())
);
create policy bookings_insert on fcd.bookings for insert to fcd_user with check (fcd.is_member(shipper_org_id));

grant select, insert, update on fcd.shipments to fcd_user;
create policy shipments_read on fcd.shipments for select to fcd_user using (fcd.shipment_row_visible(shipper_org_id, partner_org_id));
create policy shipments_insert on fcd.shipments for insert to fcd_user with check (fcd.is_member(shipper_org_id));
create policy shipments_update on fcd.shipments for update to fcd_user
  using (fcd.is_member(partner_org_id) or fcd.is_platform())
  with check (fcd.is_member(partner_org_id) or fcd.is_platform());

grant select, insert on fcd.shipment_events to fcd_user;
create policy se_read on fcd.shipment_events for select to fcd_user using (fcd.can_see_shipment(shipment_id));
create policy se_insert on fcd.shipment_events for insert to fcd_user with check (
  fcd.is_shipment_partner(shipment_id) or fcd.is_platform()
  or (stage = 1 and fcd.is_shipment_shipper(shipment_id))
);

grant select, insert, update on fcd.exceptions to fcd_user;
create policy ex_read on fcd.exceptions for select to fcd_user using (fcd.can_see_shipment(shipment_id));
create policy ex_insert on fcd.exceptions for insert to fcd_user with check (fcd.can_see_shipment(shipment_id));
create policy ex_update on fcd.exceptions for update to fcd_user
  using (fcd.is_shipment_partner(shipment_id) or fcd.is_platform())
  with check (fcd.is_shipment_partner(shipment_id) or fcd.is_platform());

grant select, insert on fcd.documents to fcd_user;
create policy docs_read on fcd.documents for select to fcd_user using (fcd.can_see_shipment(shipment_id));
create policy docs_insert on fcd.documents for insert to fcd_user with check (
  fcd.is_member(org_id) and fcd.can_see_shipment(shipment_id)
);

-- 청구서 — 수정 권한 없음 ------------------------------------------------------
grant select, insert on fcd.invoices to fcd_user;
create policy inv_read on fcd.invoices for select to fcd_user using (fcd.can_see_shipment(shipment_id));
create policy inv_insert on fcd.invoices for insert to fcd_user with check (
  fcd.is_member(partner_org_id) and fcd.is_shipment_partner(shipment_id)
);

-- 평가 -----------------------------------------------------------------------
grant select on fcd.reviews to fcd_public, fcd_user;
grant insert on fcd.reviews to fcd_user;
create policy reviews_public on fcd.reviews for select to fcd_public using (published and fcd.partner_listed(partner_org_id));
create policy reviews_user on fcd.reviews for select to fcd_user using (
  fcd.org_visible(shipper_org_id) and fcd.org_visible(partner_org_id) and
  ((published and fcd.partner_listed(partner_org_id)) or fcd.is_member(shipper_org_id) or fcd.is_member(partner_org_id) or fcd.is_platform())
);
create policy reviews_insert on fcd.reviews for insert to fcd_user with check (
  fcd.is_member(shipper_org_id) and fcd.is_shipment_shipper(shipment_id)
);

-- 알림 -----------------------------------------------------------------------
grant select, update on fcd.notifications to fcd_user;
create policy notif_read on fcd.notifications for select to fcd_user using (user_id = fcd.uid() and fcd.org_visible(org_id));
create policy notif_update on fcd.notifications for update to fcd_user using (user_id = fcd.uid()) with check (user_id = fcd.uid());

grant select, insert, update, delete on fcd.notification_prefs to fcd_user;
create policy np_all on fcd.notification_prefs for all to fcd_user using (user_id = fcd.uid()) with check (user_id = fcd.uid());

-- 운영 큐 — 공개 면에서 접수, 운영자가 처리 ------------------------------------------
grant insert on fcd.verification_requests, fcd.deletion_requests to fcd_public, fcd_user;
grant select, update on fcd.verification_requests, fcd.deletion_requests to fcd_user;
create policy vr_insert on fcd.verification_requests for insert to fcd_public, fcd_user
  with check (status = 'pending' and decided_at is null and fcd.partner_listed(org_id));
create policy vr_read on fcd.verification_requests for select to fcd_user using (fcd.is_platform());
create policy vr_update on fcd.verification_requests for update to fcd_user using (fcd.is_platform()) with check (fcd.is_platform());
create policy dr_insert on fcd.deletion_requests for insert to fcd_public, fcd_user
  with check (status = 'pending' and decided_at is null and fcd.partner_listed(org_id));
create policy dr_read on fcd.deletion_requests for select to fcd_user using (fcd.is_platform());
create policy dr_update on fcd.deletion_requests for update to fcd_user using (fcd.is_platform()) with check (fcd.is_platform());

grant select on fcd.grade_records, fcd.ad_slots to fcd_public, fcd_user;
grant insert on fcd.grade_records, fcd.ad_slots to fcd_user;
grant update on fcd.ad_slots to fcd_user;
create policy gr_read on fcd.grade_records for select to fcd_public, fcd_user using (fcd.org_visible(org_id));
create policy gr_insert on fcd.grade_records for insert to fcd_user with check (fcd.is_platform());
create policy ads_read on fcd.ad_slots for select to fcd_public, fcd_user using (fcd.org_visible(org_id));
create policy ads_insert on fcd.ad_slots for insert to fcd_user with check (fcd.is_platform());
create policy ads_update on fcd.ad_slots for update to fcd_user using (fcd.is_platform()) with check (fcd.is_platform());

grant select, insert on fcd.audit_log to fcd_user;
create policy audit_insert on fcd.audit_log for insert to fcd_user with check (actor_id = fcd.uid());
create policy audit_read on fcd.audit_log for select to fcd_user using (fcd.is_platform());
