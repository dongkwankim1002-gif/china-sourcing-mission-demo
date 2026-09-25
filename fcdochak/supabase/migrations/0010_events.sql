-- FC도착 0010 — 이벤트 기록(v2 metrics)
--
-- 견적 요청 → 응찰 → 선택 → 예약 → 선적(출항) → FC 입고 → 청구 → 회송 · 평가 · 가입을 한 줄씩 쌓는다.
-- 쌓기만 한다: 어떤 역할에도 UPDATE·DELETE 권한이 없다. 조직을 지우면 CASCADE 로 함께 사라진다(데모 걷어내기).
-- 금액은 여기에 복사하지 않는다 — 지표는 대상(응찰·청구·선적)을 따라가 원래 기록에서 읽는다.

create table fcd.events (
  id uuid primary key default gen_random_uuid(),
  -- 행동한 쪽 조직
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  -- 이 일이 걸린 셀러(화주) 조직 — 월간 활성 셀러·재선적률의 기준
  seller_org_id uuid references fcd.orgs (id) on delete cascade,
  actor_id uuid,
  kind text not null check (kind in (
    'signed_up', 'quote_requested', 'request_cancelled', 'bid_submitted', 'bid_selected', 'booked',
    'shipped', 'fc_inbound', 'invoiced', 'returned', 'reviewed'
  )),
  target_kind text check (target_kind in ('org', 'quote_request', 'shipment')),
  target_id uuid,
  detail jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index events_kind_idx on fcd.events (kind, occurred_at desc);
create index events_seller_idx on fcd.events (seller_org_id, occurred_at desc);
create index events_org_idx on fcd.events (org_id, occurred_at desc);
create index events_target_idx on fcd.events (target_id);

alter table fcd.events enable row level security;

grant select, insert on fcd.events to fcd_user;

-- 읽기: 운영자는 전부, 조직은 자기가 한 일만(데모 숨김을 따른다)
create policy events_read on fcd.events for select to fcd_user using (
  fcd.is_platform() or (fcd.org_visible(org_id) and fcd.is_member(org_id))
);

-- 쓰기: 로그인한 본인이, 자기 조직 이름으로만. 셀러를 적을 때는 그 셀러와 걸린 일이어야 한다.
create policy events_insert on fcd.events for insert to fcd_user with check (
  actor_id = fcd.uid()
  and fcd.is_member(org_id)
  and (
    seller_org_id is null
    or fcd.is_member(seller_org_id)
    or fcd.has_booking_with(seller_org_id)
    or (target_kind = 'quote_request' and exists (
          select 1 from fcd.quote_requests q where q.id = target_id and q.org_id = seller_org_id))
  )
);
