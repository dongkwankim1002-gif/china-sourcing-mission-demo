-- FC도착 0011 — 목적지 넓히기(v2 metrics)
--
-- 도착지는 지금까지 쿠팡 FC(fcd.fc_centers)뿐이었다. 같은 참조표에 국내 3PL 창고·다른 쇼핑몰 물류센터를
-- 함께 두고 kind 로 가른다 — 견적 요청·선적의 fc_code 외래키를 그대로 쓸 수 있다.
-- 표 이름은 바꾸지 않는다(운영 자료·쿼리를 건드리지 않는다). 기존 줄은 kind 기본값 'coupang_fc' 가 된다.
-- 줄은 참조 시드(seed/reference)가 넣는다. 예시 창고는 is_example = true 이고 이름에 「예시」가 붙는다.

alter table fcd.fc_centers add column if not exists kind text not null default 'coupang_fc';
alter table fcd.fc_centers add column if not exists is_example boolean not null default false;
alter table fcd.fc_centers add column if not exists ord smallint not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fc_centers_kind_check') then
    alter table fcd.fc_centers add constraint fc_centers_kind_check check (kind in ('coupang_fc', '3pl', 'mall_wh'));
  end if;
end $$;

-- 목적지 보기 — 누구나 읽는다(참조표와 같은 권한)
create view fcd.v_destinations with (security_invoker = true) as
  select code, name, region, kind, is_example, km_incheon, km_pyeongtaek, ord
  from fcd.fc_centers;

grant select on fcd.v_destinations to fcd_public, fcd_user;
