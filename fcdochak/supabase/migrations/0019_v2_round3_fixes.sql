-- FC도착 0019 — v2 3차 검토에서 나온 고침(0017 sales · 0018 sourcing 보강)
--
-- 자료를 지우거나 덮지 않는다(DELETE·TRUNCATE·UPDATE 없음). 기존 정책은 지우지 않고 제한(restrictive) 정책을 덧붙여 좁힌다.
-- ⑤만 제약을 바꾼다: 0018 의 프로필 FK 가 ON DELETE CASCADE 라 사람 한 명을 지우면 그 사람이 쌓은 소싱 기록이 함께 사라진다.
--   같은 이름의 FK 를 ON DELETE SET NULL 로 다시 건다(기록은 남고 「누가」 칸만 빈다). 자료 줄은 한 줄도 지우지 않는다.
--
--   ① sales_settlements — 사용자 경로로는 verified = false 만(확인은 신뢰 경로에서), source 'api' 는 못 넣는다
--   ② sales_orders · sales_returns · sales_inventory_snapshots — 사용자 경로로 source 'api' 를 못 넣는다(쿠팡에서 온 척 못 하게)
--   ③ sales_products — 'api' 줄은 앞 판이 'api' 이고 이름·옵션·판매가가 같을 때만(= SKU 잇기 새 판) 넣는다
--   ④ sales_sync_runs — 사용자 경로로 「api 가져옴(ok)」 기록을 못 넣는다(막힘·확인 필요·실패 기록은 된다)
--      → 실제 쿠팡 가져오기를 만들 때는 신뢰 경로(asSystem, 좁게)로 쓴다(docs/DECISIONS.md)
--   ⑤ sourcing_* 의 created_by · actor_id · user_id FK → ON DELETE SET NULL(칸은 비어도 되게). 넣을 때는 여전히 본인 id 여야 한다(0018 정책)
--   ⑥ sourcing_requests — 스위치가 꺼져 있으면 preview = true 만 · origin 'sku'/'sales' 이면 origin_ref 가 같은 조직의 SKU·판매 상품
--   ⑦ sourcing_sample_interests — 후보의 지금 판 조건이 내림(withdrawn)이면 못 넣는다

-- ① ---------------------------------------------------------------------------------
create policy sales_settlements_insert_unverified on fcd.sales_settlements as restrictive for insert to fcd_user with check (
  verified = false and source <> 'api'
);

-- ② ---------------------------------------------------------------------------------
create policy sales_orders_insert_no_api on fcd.sales_orders as restrictive for insert to fcd_user with check (source <> 'api');
create policy sales_returns_insert_no_api on fcd.sales_returns as restrictive for insert to fcd_user with check (source <> 'api');
create policy sales_inv_insert_no_api on fcd.sales_inventory_snapshots as restrictive for insert to fcd_user with check (source <> 'api');

-- ③ ---------------------------------------------------------------------------------
-- 'api' 상품 줄의 다음 판이 SKU 연결만 바꾸는가(이름·옵션·판매가·번호가 앞 판과 같다)
create or replace function fcd.sales_product_relink_only(p_org uuid, p_ext text, p_super uuid, p_name text, p_opt text, p_price integer) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select p_super is not null and exists (
    select 1 from fcd.sales_products r
     where r.id = p_super and r.org_id = p_org and r.external_id = p_ext and r.source = 'api'
       and r.name = p_name and r.option_name is not distinct from p_opt and r.list_price is not distinct from p_price
  )
$$;
revoke all on function fcd.sales_product_relink_only(uuid, text, uuid, text, text, integer) from public;
grant execute on function fcd.sales_product_relink_only(uuid, text, uuid, text, text, integer) to fcd_user;

create policy sales_products_insert_no_api on fcd.sales_products as restrictive for insert to fcd_user with check (
  source <> 'api' or fcd.sales_product_relink_only(org_id, external_id, supersedes_id, name, option_name, list_price)
);

-- ④ ---------------------------------------------------------------------------------
create policy sales_sync_insert_no_api_ok on fcd.sales_sync_runs as restrictive for insert to fcd_user with check (
  not (source = 'api' and status = 'ok')
);

-- ⑤ ---------------------------------------------------------------------------------
alter table fcd.sourcing_requests alter column created_by drop not null;
alter table fcd.sourcing_requests drop constraint sourcing_requests_created_by_fkey;
alter table fcd.sourcing_requests add constraint sourcing_requests_created_by_fkey
  foreign key (created_by) references fcd.profiles (id) on delete set null;

alter table fcd.sourcing_request_events alter column actor_id drop not null;
alter table fcd.sourcing_request_events drop constraint sourcing_request_events_actor_id_fkey;
alter table fcd.sourcing_request_events add constraint sourcing_request_events_actor_id_fkey
  foreign key (actor_id) references fcd.profiles (id) on delete set null;

alter table fcd.sourcing_candidates alter column created_by drop not null;
alter table fcd.sourcing_candidates drop constraint sourcing_candidates_created_by_fkey;
alter table fcd.sourcing_candidates add constraint sourcing_candidates_created_by_fkey
  foreign key (created_by) references fcd.profiles (id) on delete set null;

alter table fcd.candidate_quotes alter column created_by drop not null;
alter table fcd.candidate_quotes drop constraint candidate_quotes_created_by_fkey;
alter table fcd.candidate_quotes add constraint candidate_quotes_created_by_fkey
  foreign key (created_by) references fcd.profiles (id) on delete set null;

alter table fcd.sourcing_sample_interests alter column user_id drop not null;
alter table fcd.sourcing_sample_interests drop constraint sourcing_sample_interests_user_id_fkey;
alter table fcd.sourcing_sample_interests add constraint sourcing_sample_interests_user_id_fkey
  foreign key (user_id) references fcd.profiles (id) on delete set null;

-- ⑥ ---------------------------------------------------------------------------------
create or replace function fcd.sourcing_request_ok(p_org uuid, p_origin text, p_ref text, p_preview boolean) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select (p_preview or coalesce((select value = 'true'::jsonb from fcd.v_current_settings where key = 'sourcing.enabled'), false))
    and case p_origin
      when 'sku' then p_ref is null or exists (select 1 from fcd.skus s where s.org_id = p_org and s.id::text = p_ref)
      when 'sales' then p_ref is null or exists (select 1 from fcd.sales_products p where p.org_id = p_org and p.external_id = p_ref)
      else true
    end
$$;
revoke all on function fcd.sourcing_request_ok(uuid, text, text, boolean) from public;
grant execute on function fcd.sourcing_request_ok(uuid, text, text, boolean) to fcd_user;

create policy sreq_insert_checked on fcd.sourcing_requests as restrictive for insert to fcd_user with check (
  fcd.sourcing_request_ok(org_id, origin, origin_ref, preview)
);

-- ⑦ ---------------------------------------------------------------------------------
create or replace function fcd.sourcing_candidate_active(p_cand uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (
    select 1 from fcd.candidate_quotes c
     where c.candidate_id = p_cand and c.status = 'active'
       and not exists (select 1 from fcd.candidate_quotes n where n.supersedes_id = c.id)
  )
$$;
revoke all on function fcd.sourcing_candidate_active(uuid) from public;
grant execute on function fcd.sourcing_candidate_active(uuid) to fcd_user;

create policy ssi_insert_active on fcd.sourcing_sample_interests as restrictive for insert to fcd_user with check (
  fcd.sourcing_candidate_active(candidate_id)
);
