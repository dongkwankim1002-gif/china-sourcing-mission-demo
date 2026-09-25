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
