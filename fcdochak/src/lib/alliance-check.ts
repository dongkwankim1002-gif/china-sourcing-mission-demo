/**
 * 제휴 요건 체크리스트 — 순수 함수. 운영·물류사 화면과 시험이 같은 규칙을 쓴다.
 * 화주 카드의 「계약 상대」 판정은 DB 함수 fcd.alliance_contract_party 가 같은 규칙으로 한다(시험으로 맞춘다).
 */
import { expiryState, type ExpiryState } from './money/alliance';
import { REQUIREMENT_KINDS, type AllianceRules, type RequirementKind } from './alliance-settings';

export interface CurrentReq {
  id: string;
  kind: RequirementKind;
  version: number;
  status: 'submitted' | 'verified' | 'rejected';
  ref_no: string | null;
  amount: number | null;
  valid_until: string | null;
  file_name: string | null;
  storage_path?: string | null;
  note: string | null;
  created_at: string;
}

export type CheckState = 'missing' | 'submitted' | 'rejected' | 'verified' | 'expired' | 'bond_low';

export interface CheckItem {
  kind: RequirementKind;
  required: boolean;
  state: CheckState;
  expiry: ExpiryState;
  req: CurrentReq | null;
}

export function checklist(current: CurrentReq[], rules: AllianceRules, today: string): { items: CheckItem[]; ready: boolean; soon: CheckItem[] } {
  const items = REQUIREMENT_KINDS.map((kind): CheckItem => {
    const req = current.find((r) => r.kind === kind) ?? null;
    const required = rules.requiredKinds.includes(kind);
    const expiry = req ? expiryState(req.valid_until, today, rules.expiryWarnDays) : 'none';
    let state: CheckState = !req ? 'missing' : req.status;
    if (req && req.status === 'verified') {
      if (expiry === 'expired') state = 'expired';
      else if (kind === 'guarantee_bond' && (req.amount ?? 0) < rules.minBondAmount) state = 'bond_low';
    }
    return { kind, required, state, expiry, req };
  });
  const ready = items.filter((i) => i.required).every((i) => i.state === 'verified') && items.some((i) => i.kind === 'registration_cert' && i.state === 'verified');
  return { items, ready, soon: items.filter((i) => i.req && i.state === 'verified' && i.expiry === 'soon') };
}

export const CHECK_STATE_LABEL: Record<CheckState, { ko: string; zh: string; tone: 'neutral' | 'info' | 'ok' | 'stamp' | 'caution' }> = {
  missing: { ko: '아직 없음', zh: '未提交', tone: 'neutral' },
  submitted: { ko: '올림 — 확인 전', zh: '已提交 — 待审核', tone: 'info' },
  rejected: { ko: '반려 — 다시 올려 주세요', zh: '已驳回 — 请重新提交', tone: 'stamp' },
  verified: { ko: '확인함', zh: '已确认', tone: 'ok' },
  expired: { ko: '만료', zh: '已过期', tone: 'stamp' },
  bond_low: { ko: '보험 금액 부족', zh: '保险金额不足', tone: 'caution' },
};
