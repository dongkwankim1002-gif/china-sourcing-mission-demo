# 배포 — FC도착

이 앱은 저장소 안 `fcdochak/` 폴더에만 삽니다. 저장소 뿌리의 GitHub Pages 데모(index.html 등)와
그 배포 설정은 건드리지 않습니다. 기존 Supabase·Vercel 프로젝트의 환경변수·DB 도 읽거나 쓰지 않습니다.

## 가지

| 가지 | 쓰임 |
|---|---|
| `main` | 기존 데모. FC도착 PR 을 여기로 올리지 않습니다. |
| `fcdochak` | FC도착의 기준 가지 = 운영 배포 가지. 직접 push 하지 않고 PR 로만 합칩니다. |
| 작업 가지 | `claude/…`, `fcdochak-<단계>` 등 → `fcdochak` 으로 PR |

## 지금 배포 상태 (2026-09-25)

- Vercel 프로젝트 **`fcdochak`** (팀 dongkwankim1002-gif's projects, 기존 프로젝트와 별개) · Root `fcdochak` · 함수 리전 `icn1` · Node 22 · Production Branch **`fcdochak`**
- 운영 주소 **https://fcdochak.vercel.app** — `fcdochak` 가지에 PR 을 합칠 때마다 운영 배포(`d740fbc` 부터 Supabase 로 동작)
- DB: 새 Supabase 프로젝트 **`fcdochak`**(서울, Vercel 마켓플레이스 연결). 연결값(`POSTGRES_*`·`SUPABASE_*`·`NEXT_PUBLIC_SUPABASE_*`)은 **Production 에만** 들어 있어 미리보기 배포는 여전히 PGlite 데모
- 빌드 앞단 `vercel:prepare` 가 스키마·참조 첫 판·데모(없을 때만)·비공개 버킷 `fcd-docs` 를 맞춘다(지우거나 덮지 않음)
- 환경변수: `DEMO_MODE=on` · `OUTBOUND_ENABLED=false` · `NEXT_PUBLIC_SITE_URL` · `SESSION_SECRET`·`DEMO_PASSWORD`(Sensitive, 무작위)
- 보호: Vercel 로그인은 미리보기 배포에만(운영 주소는 공개). `main` 가지 커밋은 빌드하지 않는다(Ignored Build Step)
- 빌드는 미국(iad1)에서 돌아 서울 DB 와 멀다 — 빌드 중 DB 읽기는 한 번에 모아서(DECISIONS.md)
- 알아 둘 것: 첫 Supabase 시드의 jsonb 값 일부가 글자로 한 겹 더 감싸여 저장돼 있다. 읽을 때 드라이버가 벗기므로 화면은 맞다. 고치는 SQL 은 사람이 판단해 돌린다(여기서 돌리지 않음)

## v2 미리보기 (fcdochak-v2 가지)

- 주소 **https://fcdochak-v2-live.vercel.app** — 공개 비교용 프로젝트 `fcdochak-v2-public` 이 `fcdochak-v2` 가지에 push 할 때마다 배포한다. **로그인 없이 열린다**(아래 「버전 비교실」). 옛 주소 `fcdochak-v2.vercel.app` 은 기존 프로젝트에 남은 로그인 필요 주소로, 더는 갱신되지 않는다.
- **임시 DB**: Supabase 연결값은 Production 에만 있어 v2 미리보기는 PGlite(프로세스 안 Postgres)로 뜬다. 스키마·참조 첫 판·데모를 뜰 때마다 새로 세우므로, 화면에서 넣은 자료는 인스턴스가 바뀌면 사라진다. v2 의 새 표(0006~0012)는 운영 DB 에 들어가지 않는다.
- **`PREVIEW_BANNER=v2`**(v2 미리보기 환경에만): 모든 화면 맨 위에 「v2 미리보기 — 운영 아님 · 임시 자료라 바뀌거나 사라질 수 있습니다」. 공개 화면은 빌드 때 그려지므로 값을 바꾸면 다시 배포한다. 운영에는 이 값을 넣지 않는다.
- v2 시범 스위치(`v2.*`)는 참조 시드에서 모두 꺼짐. 켜도 계약·결제·보장·발송은 없다(`docs/V2.md`).
- **2차 환경변수(이름만 — 값은 Vercel 서버 환경변수에만, 코드·문서·커밋에 쓰지 않는다)** · 2차 새 표 0013~0016 도 운영 DB 에 들어가지 않는다.
  - `WING_ENABLED` — 쿠팡 WING 실제 호출기. **비워 둔다(꺼짐)**. 꺼져 있으면 쿠팡 API 를 한 번도 부르지 않고 흉내 어댑터·파일 가져오기만 돈다. 켜는 조건은 `docs/wing-plan.md` 11절(사람이 정할 일).
  - `WING_KEY_ENCRYPTION_KEY` — 셀러가 넣는 WING 키를 잠그는 무작위 32바이트 값(예: `openssl rand -base64 32` 로 만든 값). **Sensitive** 로, 서버 쪽에만(`NEXT_PUBLIC_` 붙이지 않음). 없으면 키 넣기 칸이 키를 받지 않는다. 바꾸면 옛 키로 잠근 기록은 풀리지 않는다(셀러가 다시 넣음) — 관리·교체 절차는 사람이 정할 일.
  - 제휴 구조(`v2.alliance_enabled`)·셀러 인터뷰(`research.rules`)는 환경변수가 아니라 `fcd.settings` 값이다(어드민 설정 화면).
- **3차 환경변수: 새로 생긴 것 없음.** 판매 분석·쿠팡 API 제공은 2차의 `WING_ENABLED`(비워 둠 = 꺼짐)·`WING_KEY_ENCRYPTION_KEY`(Sensitive, 서버 쪽만) 두 이름을 그대로 쓴다. 3차 새 표 0017~0019 도 운영 DB 에 들어가지 않는다.
  - 스위치·규칙은 환경변수가 아니라 `fcd.settings` 값(어드민 설정 화면): `sourcing.enabled`(첫 판 꺼짐) · `sourcing.rules` · `sourcing.fees`(가정치) · `sales.rules` · `wing.egress_ips`(연동 IP, 첫 판 빈 목록 → 화면 「준비 중」). Postgres 에서는 참조 시드를 다시 올려야 새 키가 생긴다(덧붙이기만).
  - 연동 IP(`wing.egress_ips`)를 채우려면 FC도착의 나가는 호출이 고정 IP 로 나가야 한다. Vercel 에는 프로젝트별 「Static IPs」 설정이 있다(출처: https://vercel.com/docs/rest-api/networking/configures-static-ips-for-a-project) — 요금제·지역·비용은 **확인 필요**. 고정 IP 프록시·작은 서버와 견줘 어디서·얼마는 사람이 정할 일(`docs/V2.md`). 이 작업에서 Vercel 설정은 건드리지 않았다.
- 로컬에서 같은 모양 보기: `PREVIEW_BANNER=v2 npm run build && PREVIEW_BANNER=v2 npm start` (DATABASE_URL 없이 → PGlite). 캡처는 `node scripts/shots-all.mjs http://localhost:3000`.
- v2 를 운영으로 옮길지는 사람이 정한다. 옮길 때는 `fcdochak-v2` → `fcdochak` PR, 운영 DB 에는 빌드 앞단 `vercel:prepare` 가 0006~0012 를 덧붙인다(지우거나 덮지 않음) — 먼저 Supabase 백업.

## 버전 비교실 — https://fcdochak.vercel.app/lab

운영·v2·v3… 를 **한 주소에서** 나란히 띄워 비교한다(검색 제외). 판 목록은 `src/lib/lab-versions.ts`(또는 운영 환경변수 `LAB_VERSIONS` JSON).

| 판 | 주소 | Vercel 프로젝트 | DB |
|---|---|---|---|
| 운영 | https://fcdochak.vercel.app | `fcdochak`(Production Branch `fcdochak`) | Supabase |
| v2 | https://fcdochak-v2-live.vercel.app | `fcdochak-v2-public`(가지 `fcdochak-v2` 만 빌드 · 공개) | 임시 PGlite(예시 자료) |

- 기존 프로젝트 `fcdochak` 의 미리보기는 계속 Vercel 로그인으로 잠겨 있고, `fcdochak-v2` 가지는 거기서 빌드하지 않는다(중복 빌드 막기).
- 새 판(v3)을 더하는 법: 가지 `fcdochak-v3` → 공개 프로젝트 하나(그 가지만 빌드하는 Ignored Build Step, Root `fcdochak`) → 가지 주소 `fcdochak-v3-live.vercel.app` → 환경변수 이름 `DEMO_MODE` · `OUTBOUND_ENABLED` · `SESSION_SECRET` · `DEMO_PASSWORD` · `NEXT_PUBLIC_SITE_URL` · `PREVIEW_BANNER` · `FRAME_ANCESTORS` · `EMBED_COOKIES` · `NEXT_PUBLIC_LAB_ORIGIN` → `lab-versions.ts` 의 v3 줄에서 `planned` 를 뗀다.

## 로컬

```bash
cd fcdochak
npm ci
npm run dev            # 환경변수 없이 PGlite + 데모 시드로 뜹니다 (DEMO_PASSWORD 를 .env.local 에)
npm run verify         # 시험 → 형 검사 → 빌드
npm run verify:no-demo # + 데모 없이 한 번 더 빌드
npm run smoke          # DEMO_MODE on/off 각각 빌드 → 서버 → Playwright 한 바퀴
```

CLI(`db:migrate`, `demo:*`, `admin:create`)는 `DATABASE_URL` 이 없으면 `PGLITE_DIR`(기본 `.pglite`) 을 씁니다.
개발 서버와 같은 로컬 DB 를 보려면 `.env.local` 에 `PGLITE_DIR=.pglite` 를 넣고, CLI 는 개발 서버를 멈춘 뒤 돌립니다
(PGlite 폴더는 한 프로세스만 엽니다).

## 1-가. 새 Supabase — Vercel 마켓플레이스로(권장)

Vercel → 프로젝트 `fcdochak` → **Storage** → Create → **Supabase** → 지역 Seoul(ap-northeast-2) → 프로젝트 `fcdochak` 에 연결.
새 Supabase 프로젝트가 만들어지고 `POSTGRES_URL`·`SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY` 등이
환경변수로 자동 입력된다(값을 사람이 옮기지 않는다). 앱은 `DATABASE_URL` 이 없으면 `POSTGRES_URL` 을 쓴다.

그다음 재배포하면 `npm run vercel-build` 가 **빌드 앞단에서** `tsx scripts/fcd.ts vercel:prepare` 를 돈다:
스키마 만들기(마이그레이션)·참조 첫 판 → `DEMO_MODE` 가 켜져 있으면 데모 한 번(있으면 건너뜀, 데모 계정은 Supabase Auth 에) → 비공개 버킷 `fcd-docs`.
DB 연결값이 없으면 건너뛰고 PGlite 미리보기로 빌드한다. 자료를 지우거나 덮는 단계는 없다.

## 1-나. 새 Supabase 프로젝트 — 직접 (사람이 합니다)

1. supabase.com 에서 **새 프로젝트**를 만듭니다(기존 프로젝트 재사용 금지). 지역은 서울(ap-northeast-2).
2. Storage → 새 버킷 `fcd-docs`, **Public 끔**.
3. Authentication → Providers → Email: 켜기. 「Confirm email」은 앱이 서버에서 확인 처리하므로 그대로 둬도 됩니다.
4. 아래 값 이름을 Vercel(과 로컬 `.env.local`)에 넣습니다. 값은 어디에도 붙여 넣어 공유하지 않습니다.

```
DATABASE_URL                    Project Settings → Database → Connection string → Transaction pooler (postgres 역할)
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SESSION_SECRET                  임의 32자 이상
NEXT_PUBLIC_SITE_URL            https://<배포 주소>
DEMO_MODE                       on (본게임 전까지)
DEMO_PASSWORD                   데모 계정 비밀번호
OUTBOUND_ENABLED                false
```

5. 스키마와 첫 판 — 연결되면 이쪽(Claude)이 올립니다. 스키마를 만드는 SQL 만 있고, 지우거나 덮는 SQL 은 없습니다.

```bash
cd fcdochak
DATABASE_URL=… npm run db:migrate      # fcd 스키마·역할·RLS·잠금 + 참조표·설정 첫 판(이미 있으면 그대로)
DATABASE_URL=… NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… DEMO_PASSWORD=… npm run demo:seed
ADMIN_EMAIL=… ADMIN_PASSWORD=… … npm run admin:create
```

잠금: 모든 표는 `fcd` 스키마에 있고 RLS 가 켜져 있으며, Supabase 의 `anon`·`authenticated`·`service_role` 에는
어떤 표 권한도 없습니다(PostgREST 로 새지 않음). 앱은 서버에서만 DB 에 붙고, 요청마다 `fcd_user`/`fcd_public` 역할로
내려가 RLS 를 받습니다. 마이그레이션이 끝날 때마다 `fcd.lockdown()` 이 다시 잠급니다.

## 2. 새 Vercel 프로젝트 (사람이 합니다)

기존 Vercel 프로젝트는 그대로 둡니다. 같은 저장소로 **새 프로젝트**를 만듭니다.

| 항목 | 값 |
|---|---|
| Framework | Next.js |
| Root Directory | `fcdochak` |
| Production Branch | `fcdochak` |
| Install / Build | 기본값(`npm install` / `next build`) |
| Node | 22.x |
| 환경변수 | 위 목록(Production · Preview 각각). Preview 는 `DEMO_MODE=on` |

「Ignored Build Step」에 `git diff --quiet HEAD^ HEAD -- .` 을 넣으면 `fcdochak/` 밖만 바뀐 커밋은 빌드하지 않습니다.
환경변수가 없는 미리보기는 PGlite + 데모로 뜹니다(쓰기는 인스턴스가 재시작되면 사라짐).

`DEMO_MODE` 를 바꾸면 **다시 배포**해야 합니다 — 공개 쪽은 빌드 때 미리 그린 쪽이 있습니다(1시간마다 다시 그림).

## 3. git hook (선택, 기본 꺼짐)

저장소의 기존 hook 설정은 바꾸지 않았습니다. 쓰려면 각자 로컬에서:

```bash
git config core.hooksPath fcdochak/scripts/hooks   # 켜기
git config --unset core.hooksPath                  # 끄기
```

`pre-push` 는 `main`·`fcdochak` 으로의 직접 push 를 막고, `fcdochak/` 이 바뀌었으면 `npm run verify` 를 돌립니다.

## 밖으로 나가는 것

메일·문자·카톡·외부 API 쓰기는 `src/lib/server/notify.ts` 의 `sendOutbound` 한 곳을 지나고,
`OUTBOUND_ENABLED` 가 켜져 있지 않으면 기록만 남기고 보내지 않습니다. 발송 공급자는 아직 붙이지 않았습니다.
