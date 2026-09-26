-- FC도착 0023 — 통관·입고 알리미(v2 5차 tracker) 검토 고침 · 기획 docs/tracker-plan.md
--
--   ① cargo_tracks.cargo_no — 관세청 화물관리번호(조회 뒤 서버가 채운다). 통계가 같은 화물을 한 번만 세게(M B/L·H B/L·여러 조직).
--      사용자는 넣지도 고치지도 못한다(칸 단위 UPDATE 권한에 없다 · 아래 넣기 정책).
--   ② 넣기 정책 하나 더(restrictive) — 서버가 쓰는 칸 port_raw·cargo_no 도 사용자가 채우지 못한다(기존 tracks_insert 는 그대로 두고 조건만 더한다).
--   ③ fcd.track_same_day — 방식을 반드시 받는다(방식 없이 부른 전체 수에서 방식별 수를 빼 표본 기준 미만 건수를 알아내지 못하게).
--
-- 이 파일은 자료를 지우거나 덮지 않는다(DELETE·TRUNCATE·UPDATE 없음). 기존 정책을 지우지 않는다.

-- ① 화물관리번호 ----------------------------------------------------------------------------------
alter table fcd.cargo_tracks add column if not exists cargo_no text
  check (cargo_no is null or cargo_no ~ '^[A-Z0-9-]{4,40}$');
create index if not exists cargo_tracks_cargo_no_idx on fcd.cargo_tracks (cargo_no) where cargo_no is not null;

-- ② 서버 칸은 사용자가 채우지 못한다 --------------------------------------------------------------
create policy tracks_insert_server_cols on fcd.cargo_tracks as restrictive for insert to fcd_user
  with check (port_raw is null and cargo_no is null);

-- ③ 같은 날 입항분 — 방식이 없으면 빈 결과 -----------------------------------------------------------
create or replace function fcd.track_same_day(p_port text, p_mode text, p_day date)
returns table (total integer, cleared integer)
language sql stable security definer set search_path = fcd, pg_temp as $$
  with x as (
    select count(*)::int total,
           count(*) filter (where coalesce(fcd.track_stage_rank(t.stage), 0) >= 6)::int cleared
      from fcd.cargo_tracks t
     where p_mode is not null and t.port = p_port and t.mode = p_mode and t.arrival_on = p_day
       and t.archived_at is null and fcd.org_visible(t.org_id)
  )
  select x.total, x.cleared from x
   where x.total >= coalesce((select (value ->> 'minSamples')::int from fcd.v_current_settings where key = 'tracker.rules'), 5)
$$;
revoke all on function fcd.track_same_day(text, text, date) from public;
grant execute on function fcd.track_same_day(text, text, date) to fcd_public, fcd_user;
