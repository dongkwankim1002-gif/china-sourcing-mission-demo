/**
 * 번호 입력 검사 — 순수 함수(브라우저·서버 공용).
 *   · 공백·줄바꿈을 걷고 대문자로. 남는 글자는 영문·숫자·하이픈만.
 *   · 화물관리번호: 연도 두 자리로 시작하는 15~22자(형식은 원문 확인 필요 — 공개 예시 「00ANLU083N59007001」 18자)
 *   · M B/L · H B/L: 4~35자 + B/L 연도(2000 ~ 올해+1)
 *   · 개인통관고유부호(P + 숫자 12자리)는 막는다 — 입력에 섞여 있어도. 막은 값은 돌려주지 않는다(저장·기록 없음).
 */
import type { TrackKind, TrackQuery } from './types';

export const TRACK_KIND_LABEL: Record<TrackKind, string> = {
  cargo_no: '화물관리번호',
  mbl: 'M B/L(마스터)',
  hbl: 'H B/L(하우스)',
};

/** 개인통관고유부호 — P 뒤에 숫자 12자리(앞뒤가 숫자·영문이 아닌 자리). 하이픈·공백이 섞여도 잡는다 */
export function looksLikePersonalCustomsCode(raw: string): boolean {
  return /(^|[^A-Z0-9])P(?:[\s-]*\d){12}(?![\s-]*\d)/.test(raw.normalize('NFKC').toUpperCase());
}

export function normalizeNumber(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, '').toUpperCase();
}

export type ValidateResult =
  | { ok: true; query: TrackQuery }
  | { ok: false; field: 'number' | 'year' | 'kind'; error: string; personal?: true };

export const PERSONAL_CODE_MESSAGE = '개인통관고유부호(P로 시작하는 13자리)는 넣지 마세요 — 개인정보라 받지 않고 저장하지 않았습니다. 화물관리번호나 B/L 번호를 넣어 주세요.';

export function validateTrackInput(input: { kind: string; number: string; year?: string | number | null }, thisYear: number): ValidateResult {
  if (!['cargo_no', 'mbl', 'hbl'].includes(input.kind)) return { ok: false, field: 'kind', error: '번호 종류를 골라 주세요' };
  const kind = input.kind as TrackKind;
  const raw = String(input.number ?? '');
  if (looksLikePersonalCustomsCode(raw)) return { ok: false, field: 'number', error: PERSONAL_CODE_MESSAGE, personal: true };
  const n = normalizeNumber(raw);
  if (!n) return { ok: false, field: 'number', error: `${TRACK_KIND_LABEL[kind]}를 넣어 주세요` };
  if (n.length > 35) return { ok: false, field: 'number', error: '번호가 너무 깁니다(35자 이하)' };
  if (!/^[A-Z0-9-]+$/.test(n)) return { ok: false, field: 'number', error: '번호에는 영문·숫자·하이픈(-)만 넣을 수 있습니다' };
  if (/^-|-$|--/.test(n)) return { ok: false, field: 'number', error: '하이픈(-)은 글자 사이에 하나씩만' };
  if (kind === 'cargo_no') {
    const bare = n.replace(/-/g, '');
    if (!/^\d{2}[A-Z0-9]{13,20}$/.test(bare)) {
      return { ok: false, field: 'number', error: '화물관리번호는 연도 두 자리로 시작하는 15~22자입니다(예: 26 으로 시작). B/L 번호라면 종류를 B/L 로 바꿔 주세요.' };
    }
    return { ok: true, query: { kind, number: bare, year: null } };
  }
  if (n.replace(/-/g, '').length < 4) return { ok: false, field: 'number', error: 'B/L 번호는 4자 이상입니다' };
  const y = input.year == null || input.year === '' ? NaN : Number(input.year);
  if (!Number.isInteger(y)) return { ok: false, field: 'year', error: 'B/L 로 찾으려면 B/L 연도(예: 2026)가 필요합니다' };
  if (y < 2000 || y > thisYear + 1) return { ok: false, field: 'year', error: `B/L 연도는 2000 ~ ${thisYear + 1} 사이` };
  return { ok: true, query: { kind, number: n, year: y } };
}

/** 화면·기록에 보일 번호(가운데를 가리지 않는다 — 내 번호다). 공개 화면 기록용은 maskNumber */
export function maskNumber(n: string): string {
  if (n.length <= 6) return n.slice(0, 2) + '•'.repeat(Math.max(0, n.length - 2));
  return `${n.slice(0, 4)}${'•'.repeat(n.length - 7)}${n.slice(-3)}`;
}
