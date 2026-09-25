# FC도착 — 작업 규칙

- 이 앱은 `fcdochak/` 안에서만 고친다. 저장소 뿌리(`index.html` 등 기존 데모)와 `main` 은 건드리지 않는다.
- 가지: 작업 가지 → `fcdochak` 으로 PR. `main`·`fcdochak` 에 직접 push·force push 하지 않는다.
- Next.js 16 — 바뀐 API 는 `node_modules/next/dist/docs/` 를 먼저 본다. params·searchParams 는 Promise.
- 끝내기 전에 `npm run verify`(시험 → tsc → 빌드). 화면을 바꿨으면 `npm run shots` 로 390/768/1440 을 본다.
- 운영 DB 자료를 지우거나 덮는 SQL(DELETE·TRUNCATE·DROP·대량 UPDATE)은 실행하지 않는다 — 파일로 만들어 사람에게.
- 마이그레이션은 `supabase/migrations/*.sql` 에 새 파일로. 고친 뒤 `node scripts/gen-migrations.mjs`.
- 새 표는 RLS 를 켜고 정책을 두고, 거래 기록이면 UPDATE 권한을 주지 않는다(새 판 = `supersedes_id`).
- 돈 계산(견적 합계·개당 원가·관세/부가세 추정·손익·수수료 기준)은 `src/lib/money` 순수 함수 + 시험으로만.
- 밖으로 나가는 것(메일·문자·카톡·외부 API 쓰기)은 `sendOutbound` 를 거치고 `OUTBOUND_ENABLED` 기본 꺼짐.
- 비밀값은 코드·문서·커밋·로그에 두지 않는다. `.env.example` 에는 이름만.
- 요율·기준치·환율·관세율은 코드에 박지 않고 `fcd.settings`·`fcd.duty_rates` 에서 읽는다.
- DB 접근: 로그인 사용자 `asUser`, 비로그인 `asPublic`, 신뢰 경로만 `asSystem`(좁게).
- 데모 자료는 `is_demo` 조직 아래에만. 새 표를 만들면 `DEMO_TABLES` 와 걷어내기 시험도 본다.
- 디자인 기준은 `docs/DESIGN.md`. 색은 역할 토큰으로만, 9구간 막대는 `NineBar` 하나만 쓴다.
- 문구는 쓰는 사람 말로. 행동 이름은 `src/lib/terms.ts` 의 `ACTION` 과 같게.
- 판단을 내렸으면 `docs/DECISIONS.md` 에 한 줄.
