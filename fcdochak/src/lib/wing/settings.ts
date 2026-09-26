/**
 * WING 기준치 읽기·키 만료 — 순수 함수. 값은 fcd.settings(wing.*)에서 온다.
 */
import { WING_SETTING_SCHEMAS } from '../v2-setting-schemas';
import type { WingCallRule, WingMatchRule } from './types';

export interface WingSettings {
  call: WingCallRule;
  match: WingMatchRule;
  keyValidDays: number;
  /** 만료 며칠 전부터 화면에 「곧 만료」 */
  keyWarnDays: number;
}

export function parseWingSettings(m: Map<string, unknown>): WingSettings {
  const get = <K extends keyof typeof WING_SETTING_SCHEMAS>(k: K) => {
    const r = WING_SETTING_SCHEMAS[k].safeParse(m.get(k));
    if (!r.success) throw new Error(`설정 ${k} 가 없거나 올바르지 않습니다. 참조 시드를 올려 주세요.`);
    return r.data;
  };
  return { call: get('wing.call_rule') as WingCallRule, match: get('wing.match_rule') as WingMatchRule, keyValidDays: get('wing.key_valid_days') as number, keyWarnDays: get('wing.key_warn_days') as number };
}

/** 키 만료 예정일(발급일 + 유효 일수) */
export function keyExpiry(issuedOn: string | null, validDays: number): string | null {
  if (!issuedOn) return null;
  const t = Date.parse(`${issuedOn.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t + validDays * 86_400_000).toISOString().slice(0, 10);
}

/** 만료 상태 — warnDays(설정 wing.key_warn_days) 안이면 곧 만료 */
export function keyExpiryState(expiresOn: string | null, today: string, warnDays: number): 'unknown' | 'ok' | 'soon' | 'expired' {
  if (!expiresOn) return 'unknown';
  const d = Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (d < 0) return 'expired';
  return d <= warnDays ? 'soon' : 'ok';
}

/** 업체 코드 — 쿠팡 예시 「A00******」 모양(확인 필요). 너무 좁히지 않고 영문·숫자 4~20자 */
export const VENDOR_ID_RE = /^[A-Za-z0-9]{4,20}$/;
/** access·secret key — 영문·숫자·-_ 16~128자(실제 길이 확인 필요) */
export const API_KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;
