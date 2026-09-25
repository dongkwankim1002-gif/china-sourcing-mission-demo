-- FC도착 0005 — 잠금
-- Supabase 의 기본 ACL(전역·스키마)이 어떤 모양이든, fcd 스키마의 표·보기·함수에서
-- anon·authenticated·service_role·PUBLIC 의 권한을 걷는다.
-- 마이그레이션 실행기가 매번 끝에 fcd.lockdown() 을 다시 부른다 — 새 표가 생겨도 새지 않는다.

create or replace function fcd.lockdown() returns void
language plpgsql as $$
declare r text; t record;
begin
  execute 'revoke all on all tables in schema fcd from public';
  execute 'revoke all on all sequences in schema fcd from public';
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema fcd from %I', r);
      execute format('revoke all on all sequences in schema fcd from %I', r);
      execute format('revoke all on all functions in schema fcd from %I', r);
      execute format('revoke all on schema fcd from %I', r);
    end if;
  end loop;
  -- 새로 생긴 표에 RLS 가 빠졌으면 켠다(정책이 없으면 아무도 못 본다 — 안전한 쪽)
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'fcd' and c.relkind in ('r', 'p') and not c.relrowsecurity loop
    execute format('alter table fcd.%I enable row level security', t.relname);
  end loop;
end $$;

revoke all on function fcd.lockdown() from public;
select fcd.lockdown();
