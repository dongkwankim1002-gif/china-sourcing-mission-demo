# 데모 — 넣기 · 숨기기 · 걷어내기

## 구조

- 예시 데이터는 모두 `is_demo = true` 조직 아래에만 있습니다. 표마다 조직에 FK `ON DELETE CASCADE` 로 매달려 있어
  조직을 지우면 그 아래가 함께 사라집니다.
- `seed/reference` = 본게임에도 쓰는 참조(거점·항구·FC·구간·화물 성격·설정 첫 판·관세율 첫 판).
  `seed/demo` = 가상 기초값(데모 조직만).
- 고정 시드 난수(`DEMO_SEED`)라 같은 날 돌리면 같은 결과. 날짜는 실행일 기준으로 옮겨 늘 최근입니다.
- 규모: 물류사 30(업종 6·상태 섞임·FC 입고 준비 인증·광고·특수관계 2·청구 편차 좋고 나쁜 곳·중국어 콘솔 일부),
  화주 12, 상품 묶음 8, 요금표 400판 이상, 최근 요청 40건(7가지 상태) + 지난 기록, 진행 선적 52건(9단계·예외 5종),
  90일 추이, 알림 200건. 회사 이름은 모두 가상입니다(실제 회사 아님). 로고는 글자 표시로 생성합니다.
- 데모 계정 3개: `demo-shipper@fcdochak.example`, `demo-partner@fcdochak.example`, `demo-admin@fcdochak.example`.
  비밀번호는 `DEMO_PASSWORD` 환경변수에서만 읽습니다. 공개 헤더의 「데모로 둘러보기」가 이 계정으로 들어갑니다.

## 명령

```bash
npm run demo:seed     # 멱등 — 데모 조직이 이미 있으면 아무것도 넣지 않습니다
npm run demo:status   # 표별 예시·실제 건수
npm run demo:purge    # 지울 건수를 보여 주고 supabase/purge-demo.sql 만 만듭니다(실행하지 않음)
```

## DEMO_MODE

| | 켜짐(`on`, 기본) | 꺼짐(`off`) |
|---|---|---|
| 공개·화주·물류사 화면 | 예시가 섞여 보이고 위에 「예시 데이터」 띠 | 예시가 어디에도 없음(RLS + 조회 조건 양쪽) |
| 운영 화면 | 「예시」 표시와 함께 보임 | 그대로 보임(표시 유지) |
| 데모 계정 로그인 | 됨 | 막힘 |

## 본게임으로 넘어갈 때 — 순서

1. **숨기기**: Vercel 환경변수 `DEMO_MODE=off` → 다시 배포. 며칠 둡니다. 화면이 빈 상태 안내로 바르게 보이는지 봅니다.
2. **백업 확인**: Supabase → Database → Backups.
3. **파일 만들기**: `DATABASE_URL=… npm run demo:purge` → `supabase/purge-demo.sql` (커밋되지 않음).
4. **읽어 보기**: 파일 머리의 건수, `delete from fcd.orgs where is_demo;` 와 데모 계정 id 목록을 확인합니다.
5. **사람이 실행**: Supabase SQL 편집기에 붙여 넣고 실행. 한 트랜잭션이라 실패하면 아무것도 지워지지 않습니다.
   끝의 확인 쿼리가 모두 0 이어야 합니다.
6. Storage `fcd-docs` 버킷의 데모 조직 폴더를 비웁니다.
7. `npm run demo:status` 로 예시 0 을 확인합니다. 감사 기록(audit_log)의 데모 행은 조직과 함께 지워집니다.

시험: `tests/purge.test.ts` 가 메모리 PGlite 에서 이 SQL 을 실제로 돌려, 데모만 0 이 되고 함께 넣은 실제 조직·요금표는
그대로인지 확인합니다. `npm run verify:no-demo`, `npm run smoke off` 는 데모 없이 빌드·한 바퀴를 돕니다.
