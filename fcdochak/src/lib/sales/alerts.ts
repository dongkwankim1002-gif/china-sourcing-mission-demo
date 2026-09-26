/**
 * WING 키 만료 알림(v2 3차 sales) — 순수 판정. 발급일 + wing.key_valid_days(180) 가 만료일,
 * 남은 날이 wing.key_warn_days(14) 이하면 「곧 만료」, 지나면 「만료」. 같은 발급일마다 종류별로 한 번(fcd.wing_key_alerts).
 * 알림은 화면 안 알림 표에만 — 메일·문자를 보내지 않는다.
 */
import { daysBetween } from '../money/sales';
import { keyExpiry, keyExpiryState } from '../wing/settings';

export interface ExpiryAlert {
  kind: 'soon' | 'expired';
  issuedOn: string;
  expiresOn: string;
  daysLeft: number;
  title: string;
  body: string;
}

export function expiryAlertFor(conn: { has_key: boolean; issued_on: string | null } | null, set: { keyValidDays: number; keyWarnDays: number }, today: string): ExpiryAlert | null {
  if (!conn?.has_key || !conn.issued_on) return null;
  const issuedOn = conn.issued_on.slice(0, 10);
  const expiresOn = keyExpiry(issuedOn, set.keyValidDays);
  const st = keyExpiryState(expiresOn, today, set.keyWarnDays);
  if (!expiresOn || (st !== 'soon' && st !== 'expired')) return null;
  const daysLeft = daysBetween(today, expiresOn);
  return st === 'expired'
    ? {
        kind: 'expired',
        issuedOn,
        expiresOn,
        daysLeft,
        title: '쿠팡 OPEN API 키가 만료됐습니다',
        body: `${expiresOn} 에 만료됐습니다. WING 에서 키를 지우고 다시 발급받아 쿠팡 연동 화면에 새로 넣어 주세요. 그전까지 판매 기록을 가져오지 않습니다.`,
      }
    : {
        kind: 'soon',
        issuedOn,
        expiresOn,
        daysLeft,
        title: `쿠팡 OPEN API 키 만료 D-${daysLeft}`,
        body: `${expiresOn} 에 만료됩니다(발급 ${issuedOn}). WING 에서 새 키를 받아 쿠팡 연동 화면에 넣어 주세요.`,
      };
}
