/**
 * 정산 명세 줄 읽기 — 운영자가 붙여 넣는 선적별 숫자(엑셀에서 복사 = 탭, 또는 쉼표).
 *
 *   참조 | 확정가 | 프리미엄 | 관세사 보수 | 실제 원가 | 초과 귀책 | 회송 | 회송 귀책 | 분실 | 분실 귀책 | 지연 | 지연 귀책
 *
 * 앞의 다섯 칸은 꼭 있어야 한다. 귀책은 「외부·주선사·셀러」(external·partner·seller). 비우면 초과는 외부, 사건은 주선사.
 * 금액의 천 단위 쉼표는 탭으로 나눴을 때만 읽는다(쉼표로 나누면 칸이 갈라진다 — 그때는 숫자에 쉼표를 쓰지 않는다).
 */
import type { Fault, SettlementLineInput } from './money/alliance';

const FAULT_WORDS: Record<string, Fault> = {
  외부: 'external', 외부요인: 'external', external: 'external', ext: 'external',
  주선사: 'partner', 업체: 'partner', partner: 'partner',
  셀러: 'seller', 화주: 'seller', seller: 'seller',
};

function fault(s: string | undefined, fallback: Fault): Fault | null {
  const t = (s ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return fallback;
  return FAULT_WORDS[t] ?? null;
}

function amount(s: string | undefined): number | null {
  const t = (s ?? '').trim().replace(/[,원\s]/g, '');
  if (!t) return 0;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

export function parseSettlementLines(text: string): { lines: SettlementLineInput[]; errors: string[] } {
  const lines: SettlementLineInput[] = [];
  const errors: string[] = [];
  const rows = text.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  rows.forEach((row, i) => {
    const n = i + 1;
    const cells = row.includes('\t') ? row.split('\t') : row.split(',');
    if (/^(참조|ref)/i.test(cells[0]?.trim() ?? '')) return; // 머리줄
    if (cells.length < 5) return void errors.push(`${n}번째 줄: 참조·확정가·프리미엄·관세사 보수·실제 원가 다섯 칸이 필요합니다`);
    const ref = cells[0].trim().slice(0, 40);
    const [firmPrice, premium, brokerFee, actualCost] = [1, 2, 3, 4].map((k) => amount(cells[k]));
    if (!ref || firmPrice == null || premium == null || brokerFee == null || actualCost == null) return void errors.push(`${n}번째 줄: 금액은 0 이상 원 단위 숫자로 적어 주세요`);
    if (firmPrice <= 0) return void errors.push(`${n}번째 줄: 확정가가 0 입니다`);
    if (premium > firmPrice || brokerFee > firmPrice) return void errors.push(`${n}번째 줄: 프리미엄·관세사 보수가 확정가보다 큽니다`);
    const overrunFault = fault(cells[5], 'external');
    if (!overrunFault) return void errors.push(`${n}번째 줄: 초과 귀책은 외부·주선사·셀러 중 하나`);
    const incidents: NonNullable<SettlementLineInput['incidents']> = [];
    for (const [kind, at] of [['return', 6], ['loss', 8], ['delay', 10]] as const) {
      const a = amount(cells[at]);
      const f = fault(cells[at + 1], 'partner');
      if (a == null || !f) return void errors.push(`${n}번째 줄: ${kind === 'return' ? '회송' : kind === 'loss' ? '분실' : '지연'} 금액·귀책을 읽지 못했습니다`);
      if (a > 0) incidents.push({ kind, amount: a, fault: f });
    }
    lines.push({ ref, firmPrice, premium, brokerFee, actualCost, overrunFault, incidents });
  });
  if (lines.length > 500) errors.push('한 명세에는 500줄까지 넣을 수 있습니다');
  return { lines, errors };
}
