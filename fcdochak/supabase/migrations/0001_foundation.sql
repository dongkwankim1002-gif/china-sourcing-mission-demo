-- FC도착 0001 — 역할·스키마·기본 권한
--
-- 왜 public 이 아니라 fcd 스키마인가:
--   Supabase 는 public 스키마에 새 표가 생길 때마다 anon·authenticated 에게
--   권한 전부(arwdDxtm)를 붙이는 기본 ACL 을 갖고 있고, public 은 REST(PostgREST)로
--   밖에 열려 있다. fcd 스키마는 REST 에 노출되지 않고, 기본 권한도 여기서 걷는다.
--
-- 왜 anon·authenticated 가 아니라 fcd_public·fcd_user 인가:
--   서버만 DB 에 붙는다. 브라우저는 Supabase 토큰을 받지 않는다. 서버는 요청마다
--   트랜잭션 안에서 `set local role` 로 이 두 역할 중 하나가 되어 RLS 를 그대로 받는다.
--   두 역할은 PostgREST 의 authenticator 에 부여되지 않으므로 밖에서 쓸 수 없다.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'fcd_public') then
    create role fcd_public nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'fcd_user') then
    create role fcd_user nologin noinherit;
  end if;
end $$;

-- 마이그레이션을 돌리는 역할(로컬=postgres 슈퍼유저, Supabase=postgres)이 set role 할 수 있게
do $$
begin
  execute format('grant fcd_public to %I', current_user);
  execute format('grant fcd_user to %I', current_user);
exception when others then
  -- 슈퍼유저는 부여 없이도 set role 이 된다
  null;
end $$;

create schema if not exists fcd;
revoke all on schema fcd from public;
grant usage on schema fcd to fcd_public, fcd_user;

-- 기본 ACL 걷기: 이 스키마에 앞으로 생기는 표·함수·시퀀스에 아무도 자동 권한을 받지 않는다.
alter default privileges in schema fcd revoke all on tables from public;
alter default privileges in schema fcd revoke all on sequences from public;
alter default privileges in schema fcd revoke all on functions from public;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('alter default privileges in schema fcd revoke all on tables from %I', r);
      execute format('alter default privileges in schema fcd revoke all on sequences from %I', r);
      execute format('alter default privileges in schema fcd revoke all on functions from %I', r);
      execute format('revoke all on schema fcd from %I', r);
    end if;
  end loop;
end $$;

-- 요청 문맥 ------------------------------------------------------------------

create or replace function fcd.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function fcd.demo_on() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.demo_mode', true), 'off') = 'on'
$$;

grant execute on function fcd.uid() to fcd_public, fcd_user;
grant execute on function fcd.demo_on() to fcd_public, fcd_user;
