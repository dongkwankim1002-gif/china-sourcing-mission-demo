-- FC도착 0021 — v2 4차 onestop 검토에서 나온 고침(0020 보강)
--
-- 자료를 지우거나 덮지 않는다(DELETE·TRUNCATE·UPDATE 없음). 기존 표·정책은 그대로 두고 함수만 같은 이름으로 다시 쓰고(create or replace),
-- 단계 기록에 BEFORE INSERT 트리거 하나를 덧붙인다.
--
--   ① 보이는 단계 순서 fcd.onestop_shown_rank — 원스톱 기록과 이은 선적(지금 판의 shipment_id) 중 더 앞선 쪽.
--      선적 9단계 5(출항) → 혼적 출항 5 · 7(통관) → 통관 6 · 9(FC 입고) → FC 입고 7. 화면의 effectiveStage 와 같은 규칙.
--   ② onestop_event_ok — 앞으로만·취소 판정을 ① 로 한다(이은 선적이 이미 출항했으면 운영도 「취소」를 못 남긴다,
--      화주 취소도 보이는 단계가 접수일 때만).
--   ③ SECURITY DEFINER 함수(onestop_current_rank · onestop_version_ok · onestop_event_ok · ①)는 부르는 사람이
--      운영자이거나 그 주문 조직의 구성원일 때만 값을 낸다 — 남의 주문 번호(uuid)로 단계·존재를 알아내지 못하게.
--   ④ 단계 기록 넣기를 주문마다 줄 세운다(pg_advisory_xact_lock) — 화주 취소와 운영 단계가 동시에 들어와 둘 다
--      통과하던 것(READ COMMITTED 에서 서로의 커밋 전 줄을 못 봄)을 막는다. 잠근 뒤 새 스냅숏으로 ② 를 다시 본다.
--      사용자 경로(role fcd_user)에서만 다시 본다 — 시드·신뢰 경로는 RLS 밖이라 규칙이 원래 걸리지 않는다.

-- ③ 부르는 사람이 이 주문을 볼 수 있는가(운영자 또는 그 조직 구성원) ------------------------------------
create or replace function fcd.onestop_order_member(p_order uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select fcd.is_platform() or exists (select 1 from fcd.onestop_orders o where o.id = p_order and fcd.is_member(o.org_id))
$$;
revoke all on function fcd.onestop_order_member(uuid) from public;
grant execute on function fcd.onestop_order_member(uuid) to fcd_user;

create or replace function fcd.onestop_current_rank(p_order uuid) returns integer
language sql stable security definer set search_path = fcd, pg_temp as $$
  select case when fcd.onestop_order_member(p_order) then
    coalesce((select max(fcd.onestop_stage_rank(e.stage)) from fcd.onestop_order_events e where e.order_id = p_order and e.stage <> 'issue'), 0)
  end
$$;

create or replace function fcd.onestop_version_ok(p_root uuid, p_super uuid, p_version integer, p_org uuid, p_no text, p_shipment uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select fcd.onestop_order_member(p_root)
    and exists (
      select 1 from fcd.onestop_orders o
       where o.id = p_super and coalesce(o.root_id, o.id) = p_root and o.org_id = p_org and o.order_no = p_no
         and o.version + 1 = p_version
         and not exists (select 1 from fcd.onestop_orders n where n.supersedes_id = o.id)
    )
    and (p_shipment is null or exists (select 1 from fcd.shipments s where s.id = p_shipment and s.shipper_org_id = p_org))
$$;

-- ① 보이는 단계 순서(취소면 99) --------------------------------------------------------------
create or replace function fcd.onestop_shown_rank(p_order uuid) returns integer
language sql stable security definer set search_path = fcd, pg_temp as $$
  select case when not fcd.onestop_order_member(p_order) then null
              when r.ev = 99 then 99
              else greatest(r.ev, coalesce(r.sh, 0)) end
    from (
      select coalesce((select max(fcd.onestop_stage_rank(e.stage)) from fcd.onestop_order_events e where e.order_id = p_order and e.stage <> 'issue'), 0) ev,
             (select case when s.stage >= 9 then 7 when s.stage >= 7 then 6 when s.stage >= 5 then 5 else 0 end
                from fcd.onestop_orders o join fcd.shipments s on s.id = o.shipment_id
               where coalesce(o.root_id, o.id) = p_order
                 and not exists (select 1 from fcd.onestop_orders n where n.supersedes_id = o.id)
               limit 1) sh
    ) r
$$;
revoke all on function fcd.onestop_shown_rank(uuid) from public;
grant execute on function fcd.onestop_shown_rank(uuid) to fcd_user;

-- ② 이 단계를 남겨도 되는가 — 운영: 앞으로만(보이는 단계보다 뒤)·문제는 언제든·취소는 보이는 단계가 출항 전
--    화주: 보이는 단계가 접수일 때 취소만 · 취소 뒤에는 아무것도 · 볼 수 없는 주문이면 거절(null → 거절)
create or replace function fcd.onestop_event_ok(p_order uuid, p_stage text, p_platform boolean) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select coalesce(case
    when r is null then false
    when r = 99 then false
    when p_platform then case
      when p_stage = 'issue' then true
      when p_stage = 'cancelled' then r < 5
      when p_stage = 'received' then false
      else fcd.onestop_stage_rank(p_stage) > r
    end
    else p_stage = 'cancelled' and r = 0
  end, false)
  from (select fcd.onestop_shown_rank(p_order) r) x
$$;

-- ④ 주문마다 줄 세우고 다시 보기 ---------------------------------------------------------------
create or replace function fcd.onestop_event_serialize() returns trigger
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('fcd.onestop:' || new.order_id::text));
  if current_user = 'fcd_user' then
    -- 잠근 뒤의 새 스냅숏으로 다시 본다(먼저 커밋된 취소·단계가 보인다)
    if not fcd.onestop_event_ok(new.order_id, new.stage, fcd.is_platform()) then
      raise exception '이 단계는 지금 남길 수 없습니다(다른 기록이 먼저 들어왔습니다)' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
revoke all on function fcd.onestop_event_serialize() from public;
grant execute on function fcd.onestop_event_serialize() to fcd_user;

create trigger onestop_event_serialize before insert on fcd.onestop_order_events
  for each row execute function fcd.onestop_event_serialize();
