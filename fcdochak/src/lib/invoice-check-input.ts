/** 청구서 점검 입력 — 화면(브라우저)과 서버 행동이 같은 모양을 쓴다. */
import { z } from 'zod';
import { SEGMENTS } from './money/segments';
import type { Cargo, InvoiceCheckResult } from './money';

export const CheckLine = z.object({
  label: z.string().trim().min(1, '항목 이름을 적어 주세요').max(80, '항목 이름은 80자까지'),
  amount: z.number({ invalid_type_error: '금액을 숫자로 넣어 주세요' }).finite().min(-1_000_000_000).max(10_000_000_000),
  currency: z.enum(['KRW', 'RMB', 'USD']),
  segment: z.enum([...SEGMENTS, 'tax']).nullable(),
});

export const CheckInput = z.object({
  title: z.string().trim().max(80).optional(),
  hub: z.string().regex(/^[A-Z]{3}$/, '출발 거점을 고르세요'),
  port: z.enum(['ICN', 'PTK']),
  mode: z.enum(['ANY', 'LCL', 'FERRY', 'FCL', 'AIR']),
  units: z.number({ invalid_type_error: '수량을 넣으세요' }).int().min(1, '수량은 1 이상').max(10_000_000),
  cartons: z.number({ invalid_type_error: '박스 수를 넣으세요' }).int().min(1, '박스는 1 이상').max(100_000),
  kg: z.number({ invalid_type_error: '무게를 넣으세요' }).min(0.1, '무게를 넣으세요').max(1_000_000),
  cbm: z.number({ invalid_type_error: '부피를 넣으세요' }).min(0.01, '부피를 넣으세요').max(10_000),
  goods: z.number({ invalid_type_error: '물품가를 넣으세요' }).min(0).max(1_000_000_000),
  cur: z.enum(['RMB', 'USD', 'KRW']),
  lines: z.array(CheckLine).min(1, '청구서 항목을 한 줄 이상 넣어 주세요').max(80, '항목은 80줄까지 점검합니다'),
});

export type CheckLineT = z.infer<typeof CheckLine>;
export type CheckInputT = z.infer<typeof CheckInput>;

export function cargoOf(i: Pick<CheckInputT, 'units' | 'cartons' | 'kg' | 'cbm' | 'goods' | 'cur'>): Cargo {
  return { units: i.units, cartons: i.cartons, kg: i.kg, cbm: i.cbm, goodsValue: i.goods, goodsCurrency: i.cur };
}

/** 점검 결과 + 화면에 적을 조건 */
export interface CheckOutcome {
  result: InvoiceCheckResult;
  lane: { hub: string; port: string; mode: string | null; hubName: string; portName: string; modeName: string };
  cargo: Cargo;
  /** 1 외화 = N 원 — 이번 점검에 쓴 환율 */
  fx: { RMB: number; USD: number };
}
