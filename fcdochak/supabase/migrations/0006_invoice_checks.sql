-- FC도착 0006 — 청구서 점검 보관 (v2 check)
--
-- 공개 /check 는 로그인 없이 결과만 보여 주고 저장하지 않는다. 로그인한 화주가 「이 결과 보관」을 누르면 여기에 한 줄.
-- 규칙
--   · 본인만 읽는다(같은 조직 동료도 못 본다 — 받은 청구서는 개인이 올린 자료).
--   · 고치지 않는다: UPDATE·DELETE 권한이 없다. 다시 점검해 보관하면 새 판(supersedes_id = 이전 판)이 쌓인다.
--   · 조직(화주)에 매달려 조직을 지우면 함께 사라진다(데모 걷어내기 = is_demo 조직 삭제로 끝난다).

create table fcd.invoice_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references fcd.orgs (id) on delete cascade,
  user_id uuid not null references fcd.profiles (id) on delete cascade,
  version integer not null default 1 check (version >= 1),
  supersedes_id uuid references fcd.invoice_checks (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  origin_hub text not null references fcd.hubs (code),
  port text not null references fcd.ports (code),
  mode text references fcd.modes (code),
  cargo jsonb not null,
  lines jsonb not null,
  result jsonb not null,
  invoice_total bigint not null,
  market_median bigint,
  -- (빠진 구간 예상을 더한 합계 − 중간값) / 중간값, bp. 표본이 모자라면 null
  over_median_bp integer,
  high_count smallint not null default 0 check (high_count between 0 and 9),
  missing_count smallint not null default 0 check (missing_count between 0 and 9),
  created_at timestamptz not null default now()
);
create index invoice_checks_user_idx on fcd.invoice_checks (user_id, created_at desc);
create unique index invoice_checks_one_successor on fcd.invoice_checks (supersedes_id) where supersedes_id is not null;

-- 새 판을 쌓을 때 이전 판이 본인 것인지 — 정책 안에서 같은 표를 다시 읽지 않게 security definer 로
create or replace function fcd.owns_invoice_check(c uuid) returns boolean
language sql stable security definer set search_path = fcd, pg_temp as $$
  select exists (select 1 from fcd.invoice_checks where id = c and user_id = fcd.uid())
$$;
revoke all on function fcd.owns_invoice_check(uuid) from public;
grant execute on function fcd.owns_invoice_check(uuid) to fcd_user;

alter table fcd.invoice_checks enable row level security;
grant select, insert on fcd.invoice_checks to fcd_user;

create policy invoice_checks_read on fcd.invoice_checks for select to fcd_user
  using (user_id = fcd.uid() and fcd.org_visible(org_id));

create policy invoice_checks_insert on fcd.invoice_checks for insert to fcd_user with check (
  user_id = fcd.uid()
  and fcd.is_member(org_id)
  and fcd.org_kind(org_id) = 'shipper'
  and (supersedes_id is null or fcd.owns_invoice_check(supersedes_id))
);

create view fcd.v_invoice_checks_current with (security_invoker = true) as
  select c.* from fcd.invoice_checks c
  where not exists (select 1 from fcd.invoice_checks n where n.supersedes_id = c.id);

grant select on fcd.v_invoice_checks_current to fcd_user;
