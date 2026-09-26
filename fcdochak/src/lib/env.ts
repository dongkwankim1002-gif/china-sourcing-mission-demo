/**
 * 환경변수 — 이름만 여기 모은다. 값은 .env(커밋 안 함)나 Vercel 에만 둔다.
 * 비밀값을 로그에 찍지 않는다: 이 모듈은 「있다/없다」만 알려준다.
 */
function flag(v: string | undefined, dflt: boolean): boolean {
  if (v == null || v === '') return dflt;
  return ['1', 'on', 'true', 'yes'].includes(v.toLowerCase());
}

export const env = {
  /** 앱이 쓰는 DB — DATABASE_URL, 없으면 Vercel 의 Supabase 연동이 넣는 POSTGRES_URL(트랜잭션 풀러) */
  get databaseUrl() {
    return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
  },
  /** 마이그레이션용 — DATABASE_URL_DIRECT 를 따로 주면 그쪽. Supabase 직접 연결(POSTGRES_URL_NON_POOLING)은 IPv6 전용이라 쓰지 않는다 */
  get migrationUrl() {
    return process.env.DATABASE_URL_DIRECT || this.databaseUrl;
  },
  get pgliteDir() {
    return process.env.PGLITE_DIR || null;
  },
  /** 데모 보이기. 본게임 전까지 켜 둔다 — docs/DEMO.md */
  get demoMode() {
    return flag(process.env.DEMO_MODE, true);
  },
  /** PGlite 로 돌 때 데모 시드를 자동으로 넣을지 */
  get pgliteSeedDemo() {
    return flag(process.env.PGLITE_SEED_DEMO, flag(process.env.DEMO_MODE, true));
  },
  /** 메일·문자·카톡·외부 API 쓰기. 기본 꺼짐. */
  get outboundEnabled() {
    return flag(process.env.OUTBOUND_ENABLED, false);
  },
  get sessionSecret() {
    return process.env.SESSION_SECRET || null;
  },
  get demoPassword() {
    return process.env.DEMO_PASSWORD || null;
  },
  get supabaseUrl() {
    return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || null;
  },
  get supabaseAnonKey() {
    return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || null;
  },
  get supabaseServiceKey() {
    return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
  },
  get siteUrl() {
    return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  },
  /** 시험용 고정 오늘(YYYY-MM-DD). 비우면 실제 오늘(KST). */
  get today() {
    return process.env.FCD_TODAY || null;
  },
  /** 미리보기 띠 — 값이 있으면(v2 가지 미리보기에만 `v2`) 모든 화면 맨 위에 「v2 미리보기 — 운영 아님」. 운영에는 두지 않는다. */
  get previewBanner() {
    const v = process.env.PREVIEW_BANNER?.trim();
    return v ? v : null;
  },
  /** 쿠팡 WING 오픈 API 호출. 기본 꺼짐 — 꺼져 있으면 쿠팡을 한 번도 부르지 않는다(docs/wing-plan.md) */
  get wingEnabled() {
    return flag(process.env.WING_ENABLED, false);
  },
  /** WING 키 암호화 키(32자 이상). 값은 서버 환경변수에만 — 없으면 키를 받지 않는다 */
  get wingKeyEncryptionKey() {
    const v = process.env.WING_KEY_ENCRYPTION_KEY;
    // 너무 단순한 값(공백 있는 문장·반복 글자)은 없는 것으로 본다 — src/lib/wing/crypto.ts kekLooksRandom 과 같은 규칙
    return v && v.length >= 32 && !/\s/.test(v) && new Set(v).size >= 16 ? v : null;
  },
  get usingSupabaseAuth() {
    return !!(this.supabaseUrl && this.supabaseAnonKey && this.supabaseServiceKey);
  },
};
