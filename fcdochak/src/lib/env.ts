/**
 * 환경변수 — 이름만 여기 모은다. 값은 .env(커밋 안 함)나 Vercel 에만 둔다.
 * 비밀값을 로그에 찍지 않는다: 이 모듈은 「있다/없다」만 알려준다.
 */
function flag(v: string | undefined, dflt: boolean): boolean {
  if (v == null || v === '') return dflt;
  return ['1', 'on', 'true', 'yes'].includes(v.toLowerCase());
}

export const env = {
  get databaseUrl() {
    return process.env.DATABASE_URL || null;
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
    return process.env.NEXT_PUBLIC_SUPABASE_URL || null;
  },
  get supabaseAnonKey() {
    return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null;
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
  get usingSupabaseAuth() {
    return !!(this.supabaseUrl && this.supabaseAnonKey && this.supabaseServiceKey);
  },
};
