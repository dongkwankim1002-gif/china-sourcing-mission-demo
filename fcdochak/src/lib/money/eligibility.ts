/**
 * 사전 판정 — 화물 특성 × 업체 취급 능력 × 운송 방식 × 요금표 유효기간.
 * 비교 목록에서 빠지는 업체와 그 사유를 만든다. 순수 함수.
 */
export interface TraitRule {
  code: string;
  name: string;
  /** 업체가 이 능력을 등록해야 취급 가능 */
  needsCapability: boolean;
  /** 이 방식으로는 못 보낸다 */
  blockedModes: string[];
}

export interface Candidate {
  orgId: string;
  capabilities: string[];
  mode: string;
  validFrom: string; // YYYY-MM-DD
  validTo: string;
  status: 'active' | 'withdrawn';
}

export type ExclusionReason =
  | { kind: 'expired'; validTo: string }
  | { kind: 'not_started'; validFrom: string }
  | { kind: 'withdrawn' }
  | { kind: 'capability'; trait: string; traitName: string }
  | { kind: 'mode_blocked'; trait: string; traitName: string; mode: string };

export function exclusionReasons(c: Candidate, traits: string[], rules: TraitRule[], today: string): ExclusionReason[] {
  const out: ExclusionReason[] = [];
  if (c.status === 'withdrawn') out.push({ kind: 'withdrawn' });
  if (c.validTo < today) out.push({ kind: 'expired', validTo: c.validTo });
  if (c.validFrom > today) out.push({ kind: 'not_started', validFrom: c.validFrom });
  for (const t of traits) {
    const r = rules.find((x) => x.code === t);
    if (!r) continue;
    if (r.blockedModes.includes(c.mode)) out.push({ kind: 'mode_blocked', trait: t, traitName: r.name, mode: c.mode });
    else if (r.needsCapability && !c.capabilities.includes(t))
      out.push({ kind: 'capability', trait: t, traitName: r.name });
  }
  return out;
}

export function reasonText(r: ExclusionReason): string {
  switch (r.kind) {
    case 'expired':
      return `요금표 만료(${r.validTo})`;
    case 'not_started':
      return `요금표 시작 전(${r.validFrom})`;
    case 'withdrawn':
      return '업체가 요금표를 거둠';
    case 'capability':
      return `${r.traitName} 취급 등록 없음`;
    case 'mode_blocked':
      return `${r.traitName}은(는) 이 운송 방식으로 보낼 수 없음`;
  }
}

/** 요금표 만료까지 남은 날(오늘 포함 안 함). 음수면 지남. */
export function daysUntil(dateYmd: string, todayYmd: string): number {
  const a = Date.UTC(+dateYmd.slice(0, 4), +dateYmd.slice(5, 7) - 1, +dateYmd.slice(8, 10));
  const b = Date.UTC(+todayYmd.slice(0, 4), +todayYmd.slice(5, 7) - 1, +todayYmd.slice(8, 10));
  return Math.round((a - b) / 86_400_000);
}
