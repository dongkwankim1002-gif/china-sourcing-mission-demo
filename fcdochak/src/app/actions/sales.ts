'use server';
/**
 * 쿠팡 API 제공 · 판매 분석 행동(v2 3차 sales) — 동의 · 연결 시험 · 판매 기록 가져오기.
 * 2차 wing 의 키 보관(암호문·꺼냄 함수)·HTTP 어댑터·접근 기록을 그대로 쓴다. 키 값은 응답·로그·오류 문구에 싣지 않는다.
 * WING_ENABLED 가 꺼져 있으면 쿠팡을 한 번도 부르지 않는다(「시험 모드」).
 */
import { revalidatePath } from 'next/cache';
import { asUser, todayKst } from '@/lib/db';
import { env } from '@/lib/env';
import { requireViewer, type Viewer } from '@/lib/server/viewer';
import { currentConnection, logWing, wingSettings } from '@/lib/server/wing';
import { consentOk, egressIps, latestConsent } from '@/lib/server/sales';
import { SALES_CONSENT, consentScopes } from '@/lib/sales/consent';
import { SalesHttpSource } from '@/lib/sales/http';
import { LIVE_BLOCK_MESSAGE, liveCallBlock } from '@/lib/sales/gate';
import { DEMO_SALES_SEED, mockSales } from '@/lib/sales/mock';
import { storeSalesDataset, type StoreSummary } from '@/lib/sales/store';
import { addDays } from '@/lib/money/sales';
import { decryptCredentials, kekFingerprint } from '@/lib/wing/crypto';
import { WingHttpAdapter } from '@/lib/wing/http';
import { keyExpiry, keyExpiryState } from '@/lib/wing/settings';
import { WingDisabledError, WingHttpError, WingUnsupportedError } from '@/lib/wing/types';
import { demoSalesProducts } from '@seed/demo/sales';

export interface SalesResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const isAdmin = (v: Viewer) => v.org.role === 'shipper_admin';
const refresh = () => {
  revalidatePath('/app/integrations/wing');
  revalidatePath('/app/sales', 'layout');
};

/** 「읽는 것·하지 않는 것」 동의 — 화주 관리자만. 쌓기만 한다 */
export async function recordWingConsent(): Promise<SalesResult> {
  const v = await requireViewer('app');
  if (!isAdmin(v)) return { ok: false, error: '동의는 조직 관리자만 할 수 있습니다(키를 넣는 사람과 같습니다)' };
  try {
    await asUser(v, (q) =>
      q.query(`insert into fcd.wing_consents (org_id, consent_version, scopes, agreed, agreed_by) values ($1,$2,$3::jsonb,true,$4)`, [v.org.id, SALES_CONSENT.version, JSON.stringify(consentScopes()), v.id]),
    );
  } catch {
    return { ok: false, error: '동의를 남기지 못했습니다 — 화면을 새로 고쳐 주세요' };
  }
  refresh();
  return { ok: true };
}

export interface TestCheck {
  label: string;
  ok: boolean;
  note?: string;
}

export interface TestResult {
  /** test = 시험 모드(쿠팡을 부르지 않음) · live = 쿠팡에 한 번 물어봄 */
  mode: 'test' | 'live';
  passed: boolean;
  checks: TestCheck[];
  message: string;
}

/**
 * 연결 시험 — 스위치가 꺼져 있으면(또는 데모) 「시험 모드」: 동의·키 저장·암호화 키 지문·만료·연동 IP 만 본다.
 * 켜져 있으면 관리자만, 로켓창고 재고 요약 GET 한 번. 200 → 「확인됨」 새 판 · 401/403 → 「확인 실패」 새 판(2차 규칙 그대로).
 */
export async function testWingConnection(): Promise<SalesResult<TestResult>> {
  const v = await requireViewer('app');
  const today = todayKst();
  const kek = env.wingKeyEncryptionKey;
  try {
    const r = await asUser(v, async (q) => {
      const cur = await currentConnection(q, v.org.id);
      const set = await wingSettings(q);
      const consent = await latestConsent(q, v.org.id);
      const ips = await egressIps(q);
      const exp = cur ? keyExpiry(cur.issued_on, set.keyValidDays) : null;
      const st = keyExpiryState(exp, today, set.keyWarnDays);
      const kid = cur?.has_key ? (await q.query<{ kek_id: string | null }>(`select kek_id from fcd.v_wing_connections_current where id = $1`, [cur.id]))[0]?.kek_id : null;
      const checks: TestCheck[] = [
        { label: '읽는 것·하지 않는 것 동의', ok: consentOk(consent), note: consentOk(consent) ? undefined : '관리자가 동의해야 합니다' },
        { label: 'WING 키 저장', ok: !!cur?.has_key, note: cur?.has_key ? `업체 코드 ••••${cur.vendor_last4 ?? ''}` : '키가 없습니다' },
        { label: '지금 암호화 키로 잠김', ok: !!kid && !!kek && kid === kekFingerprint(kek), note: !kek ? '운영자가 암호화 키를 설정하지 않았습니다' : kid && kid !== kekFingerprint(kek) ? '다른 암호화 키로 잠긴 기록 — 키를 다시 넣어 주세요' : undefined },
        { label: '유효기간', ok: st === 'ok' || st === 'soon', note: st === 'unknown' ? '발급일을 적지 않아 모릅니다' : st === 'expired' ? '만료됐습니다' : exp ? `${exp} 만료 예정` : undefined },
        { label: '연동 IP 준비', ok: ips.length > 0, note: ips.length ? ips.join(', ') : '준비 중 — 운영이 정하면 표시' },
      ];
      const basic = checks.slice(0, 3).every((c) => c.ok);
      if (!env.wingEnabled || v.org.is_demo) {
        if (cur) await logWing(q, { orgId: v.org.id, actorId: v.id, kind: 'wing_api_blocked', connectionId: cur.id, detail: { reason: 'test_mode' } });
        return {
          mode: 'test' as const,
          passed: basic,
          checks,
          message: basic ? '시험 모드 — 쿠팡을 부르지 않았습니다. 저장·암호화·동의는 준비됐습니다. 연동이 켜지면 이 키로 읽기만 합니다.' : '시험 모드 — 쿠팡을 부르지 않았습니다. 빠진 칸을 먼저 채워 주세요.',
        };
      }
      if (!isAdmin(v)) return { error: '쿠팡에 물어보는 연결 시험은 조직 관리자만 할 수 있습니다(키를 꺼내야 해서)' };
      if (!cur?.has_key || !kek) return { mode: 'live' as const, passed: false, checks, message: '먼저 키를 넣어 주세요' };
      // 동의(지금 판)·저장·암호화가 모두 되고 만료되지 않은 키만 꺼낸다 — 동의 없이는 쿠팡을 부르지 않는다
      const block = liveCallBlock({ consent: consentOk(consent), hasKey: !!cur.has_key, kekOk: checks[2].ok, expiry: st });
      if (block) {
        await logWing(q, { orgId: v.org.id, actorId: v.id, kind: 'wing_api_blocked', connectionId: cur.id, detail: { reason: block } });
        return { mode: 'live' as const, passed: false, checks, message: `${LIVE_BLOCK_MESSAGE[block]} 쿠팡을 부르지 않았습니다.` };
      }
      const blob = (await q.query<{ b: string | null }>(`select fcd.wing_key_blob($1) b`, [cur.id]))[0]?.b;
      if (!blob) return { error: '키를 꺼내지 못했습니다 — 키를 다시 넣어 주세요' };
      const src = new SalesHttpSource(new WingHttpAdapter({ enabled: env.wingEnabled, credentials: decryptCredentials(blob, v.org.id, kek), rule: set.call }), env.wingEnabled);
      const stack = async (status: 'verified' | 'failed') => {
        await q.query(
          `insert into fcd.wing_connections (org_id, version, supersedes_id, method, status, key_blob, kek_id, vendor_last4, access_last4, issued_on, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11)`,
          [v.org.id, cur.version + 1, cur.id, cur.method, status, blob, kid ?? kekFingerprint(kek), cur.vendor_last4, cur.access_last4, cur.issued_on, v.id],
        );
      };
      try {
        await src.testConnection();
        await logWing(q, { orgId: v.org.id, actorId: v.id, kind: 'api_called', connectionId: cur.id, detail: { purpose: 'connection_test' } });
        if (cur.status !== 'verified') await stack('verified');
        return { mode: 'live' as const, passed: true, checks: [...checks, { label: '쿠팡 응답', ok: true, note: '로켓창고 재고 요약 200' }], message: '연결 확인됨 — 쿠팡이 키를 받았습니다.' };
      } catch (e) {
        const status = e instanceof WingHttpError ? e.status : null;
        await logWing(q, { orgId: v.org.id, actorId: v.id, kind: 'api_failed', connectionId: cur.id, detail: { purpose: 'connection_test', code: (e as { code?: string }).code ?? 'error', status } });
        if ((status === 401 || status === 403) && cur.status !== 'failed') await stack('failed');
        return { mode: 'live' as const, passed: false, checks: [...checks, { label: '쿠팡 응답', ok: false, note: (e as Error).message }], message: (e as Error).message };
      }
    });
    if ('error' in r) return { ok: false, error: r.error };
    refresh();
    return { ok: true, data: r };
  } catch {
    return { ok: false, error: '연결 시험을 하지 못했습니다 — 화면을 새로 고쳐 주세요' };
  }
}

/**
 * 판매 기록 가져오기 — 데모 조직은 흉내 어댑터(같은 첫날에서 이어 만들어 바뀐 것만 새 판).
 * 실제 조직: 키가 없으면 안내, 스위치가 꺼져 있으면 「시험 모드」(막힘 기록), 켜져 있어도 응답 칸 확인 전이라 「확인 필요」 기록.
 */
export async function syncSales(): Promise<SalesResult<StoreSummary | null>> {
  const v = await requireViewer('app');
  const today = todayKst();
  const end = addDays(today, -1);
  try {
    const r = await asUser(v, async (q) => {
      if (v.org.is_demo) {
        const first = (await q.query<{ d: string | null }>(`select min(range_from)::text d from fcd.sales_sync_runs where org_id = $1 and source = 'mock' and status = 'ok'`, [v.org.id]))[0]?.d;
        const products = await demoSalesProducts(q, v.org.id, first ?? addDays(end, -179));
        const ds = mockSales({ seed: DEMO_SALES_SEED, today, start: first ?? undefined, days: 180, products });
        const s = await storeSalesDataset(q, { orgId: v.org.id, userId: v.id, source: 'mock', ds, range: { from: first ?? addDays(end, -179), to: end } });
        return { ok: true as const, s };
      }
      const cur = await currentConnection(q, v.org.id);
      if (!cur?.has_key) return { error: '먼저 쿠팡 연동 화면에서 키를 넣어 주세요. 그동안은 아래 예시로 화면을 미리 볼 수 있습니다.' };
      const range = { from: addDays(end, -29), to: end };
      const record = (status: 'blocked' | 'unsupported' | 'failed', detail: Record<string, unknown>) =>
        q.query(`insert into fcd.sales_sync_runs (org_id, source, status, range_from, range_to, detail, created_by) values ($1,'api',$2,$3::date,$4::date,$5::jsonb,$6)`, [
          v.org.id,
          status,
          range.from,
          range.to,
          JSON.stringify(detail),
          v.id,
        ]);
      if (!env.wingEnabled) {
        await record('blocked', { reason: 'WING_ENABLED off' });
        await logWing(q, { orgId: v.org.id, actorId: v.id, kind: 'wing_api_blocked', connectionId: cur.id, detail: { reason: 'sales_sync_test_mode' } });
        return { error: '시험 모드 — 쿠팡 연동이 아직 꺼져 있어 판매 기록을 가져오지 않았습니다. 켜지면 이 버튼으로 가져옵니다.', recorded: true };
      }
      // 실제 경로 — 지금 판 동의가 없거나 키가 만료됐으면 부르지 않는다(시험 연결과 같은 규칙)
      const consent = await latestConsent(q, v.org.id);
      const set = await wingSettings(q);
      const st = keyExpiryState(keyExpiry(cur.issued_on, set.keyValidDays), today, set.keyWarnDays);
      const block = liveCallBlock({ consent: consentOk(consent), hasKey: !!cur.has_key, kekOk: true, expiry: st });
      if (block) {
        await record('blocked', { reason: block });
        return { error: `${LIVE_BLOCK_MESSAGE[block]} 판매 기록을 읽지 않았습니다(쿠팡 연동 화면에서 고칠 수 있습니다).`, recorded: true };
      }
      // 켜져 있어도 주문·반품·상품 응답 칸을 확인하기 전에는 부르지 않는다(키도 꺼내지 않는다)
      try {
        await new SalesHttpSource(null, env.wingEnabled).fetchDataset(range);
        return { error: '가져오지 못했습니다' };
      } catch (e) {
        const unsupported = e instanceof WingUnsupportedError;
        await record(unsupported ? 'unsupported' : 'failed', { code: (e as { code?: string }).code ?? 'error' });
        return { error: e instanceof WingDisabledError || unsupported ? (e as Error).message : '가져오지 못했습니다', recorded: true };
      }
    });
    if ('error' in r) {
      if ('recorded' in r) refresh();
      return { ok: false, error: r.error };
    }
    refresh();
    return { ok: true, data: r.s };
  } catch {
    return { ok: false, error: '가져오지 못했습니다 — 화면을 새로 고쳐 주세요' };
  }
}

/**
 * 판매 상품 ↔ 우리 SKU 잇기 — 고치지 않고 새 판(sku_id 만 바꾼 다음 판)을 쌓는다. 같은 조직 SKU 만(0017 정책 함수가 한 번 더 본다).
 * 이어야 도착원가·「지금 견적 요청」·입고 성과가 그 상품에 붙는다. 가져오기가 나중에 다시 돌아도 사람이 이은 연결은 이어 간다(store.ts).
 */
export async function linkSalesProductSku(input: { ext: string; skuId: string | null }): Promise<SalesResult> {
  const v = await requireViewer('app');
  const ext = String(input?.ext ?? '');
  const skuId = input?.skuId ?? null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/.test(ext) || (skuId != null && !/^[0-9a-f-]{36}$/i.test(skuId))) return { ok: false, error: '요청을 읽지 못했습니다' };
  try {
    const r = await asUser(v, async (q) => {
      const cur = (
        await q.query<{ id: string; version: number; source: string; name: string; option_name: string | null; list_price: number | null; sku_id: string | null }>(
          `select id, version, source, name, option_name, list_price, sku_id from fcd.v_sales_products_current where org_id = $1 and external_id = $2`,
          [v.org.id, ext],
        )
      )[0];
      if (!cur) return { error: '상품을 찾지 못했습니다' };
      if ((cur.sku_id ?? null) === skuId) return { same: true };
      if (skuId) {
        const ok = (await q.query<{ n: number }>(`select count(*)::int n from fcd.skus where id = $1 and org_id = $2 and not archived`, [skuId, v.org.id]))[0].n > 0;
        if (!ok) return { error: '저장한 SKU 에서 골라 주세요' };
      }
      await q.query(
        `insert into fcd.sales_products (org_id, source, external_id, name, option_name, list_price, sku_id, version, supersedes_id, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [v.org.id, cur.source, ext, cur.name, cur.option_name, cur.list_price, skuId, Number(cur.version) + 1, cur.id, v.id],
      );
      return { same: false };
    });
    if ('error' in r) return { ok: false, error: r.error };
    refresh();
    return { ok: true };
  } catch {
    return { ok: false, error: 'SKU 를 잇지 못했습니다 — 화면을 새로 고쳐 주세요' };
  }
}
