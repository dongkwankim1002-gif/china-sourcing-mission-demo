/**
 * v2 4차 onestop 설정 — 키 이름·값 규칙·단계. 값은 fcd.settings 에만 있고(참조 시드가 첫 판), 여기엔 규칙만 둔다.
 * 스위치가 없거나 읽을 수 없으면 꺼짐(안전한 쪽). 요금표가 없으면 오류로 멈춘다(참조 시드를 올려야 한다).
 * 브라우저에서도 읽는다(요금표 화면·맡기기 미리보기) — 서버 전용 모듈이 아니다.
 */
import { z } from 'zod';

export const ONESTOP_SWITCH_KEY = 'onestop.enabled';
export const ONESTOP_TARIFF_KEY = 'onestop.tariff';

const won = (max: number) => z.number().int().min(0).max(max);

export const OnestopLaneSchema = z.object({
  hub: z.string().regex(/^[A-Z]{3}$/),
  mode: z.enum(['LCL', 'FERRY']),
  port: z.enum(['ICN', 'PTK']),
  perCbmKrw: won(10_000_000),
  daysMin: z.number().int().min(1).max(90),
  daysMax: z.number().int().min(1).max(90),
});
export type OnestopLane = z.infer<typeof OnestopLaneSchema>;

export const OnestopTariffSchema = z
  .object({
    /** 가정치(확인 안 한 값)면 true — 화면에 「가정치」 */
    example: z.boolean(),
    checkedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    lanes: z.array(OnestopLaneSchema).min(1).max(40),
    /** 청구 CBM 올림 단위(0.01 CBM 단위 정수 — 10 = 0.1 CBM) */
    cbmStepCenti: z.number().int().min(1).max(100),
    remoteFc: z.object({ codes: z.array(z.string().regex(/^FC-[A-Z0-9]{3}$/)).max(40), perCbmKrw: won(10_000_000) }),
    handlingPerUnitKrw: won(100_000),
    barcodePerUnitKrw: won(100_000),
    inspectionPerUnitKrw: z.object({ basic: won(100_000), full: won(100_000) }),
    /** 사입 대행 수수료(물품가 대비 bp) */
    purchaseFeeBp: z.number().int().min(0).max(5000),
    minChargeKrw: won(100_000_000),
    /** 혼적 마감 요일(0 = 일요일 … 6 = 토요일, 한국 시각)과 시각 */
    cutoffWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    cutoffHourKst: z.number().int().min(0).max(23),
  })
  .refine((t) => t.lanes.every((l) => l.daysMax >= l.daysMin), '소요일 최대는 최소보다 작을 수 없습니다')
  .refine((t) => new Set(t.lanes.map((l) => `${l.hub}-${l.mode}`)).size === t.lanes.length, '같은 허브·방식 줄이 두 번 있습니다');
export type OnestopTariff = z.infer<typeof OnestopTariffSchema>;

export const ONESTOP_SETTING_SCHEMAS: Record<string, z.ZodTypeAny> = {
  [ONESTOP_SWITCH_KEY]: z.boolean(),
  [ONESTOP_TARIFF_KEY]: OnestopTariffSchema,
};

export const ONESTOP_SETTING_LABEL: Record<string, string> = {
  [ONESTOP_SWITCH_KEY]: '원스톱 대행 스위치(꺼짐 = 접수 기록만 · 대행 계약 전)',
  [ONESTOP_TARIFF_KEY]: '원스톱 고정 요금표(허브·방식별 CBM당·개당 작업·바코드·검품·최소 요금·혼적 마감)',
};

export interface OnestopConfig {
  on: boolean;
  tariff: OnestopTariff;
}

export function readOnestopConfig(m: Map<string, unknown>): OnestopConfig {
  const t = OnestopTariffSchema.safeParse(m.get(ONESTOP_TARIFF_KEY));
  if (!t.success) throw new Error('설정 onestop.tariff 가 없거나 모양이 틀립니다. 참조 시드를 올려 주세요.');
  return { on: m.get(ONESTOP_SWITCH_KEY) === true, tariff: t.data };
}

// ─── 단계 ─────────────────────────────────────────────────────────────

export const ONESTOP_STAGES = ['received', 'payment_confirmed', 'factory_received', 'inspected', 'barcoded', 'departed', 'customs_cleared', 'fc_received'] as const;
export type OnestopStage = (typeof ONESTOP_STAGES)[number];
export type OnestopEventStage = OnestopStage | 'cancelled' | 'issue';

export function stageRank(s: OnestopStage | 'cancelled'): number {
  return s === 'cancelled' ? 99 : ONESTOP_STAGES.indexOf(s);
}

/**
 * 이은 선적의 표준 9단계 → 원스톱 단계. 선적 5(선적·출항) → 혼적 출항, 7(수입통관 완료) → 통관, 9(FC 입고 완료) → FC 입고.
 * 그 앞 단계(예약·집하·중국 창고)는 원스톱 쪽 기록이 더 자세하므로 따라가지 않는다(null).
 */
export function stageFromShipment(shipmentStage: number | null | undefined): OnestopStage | null {
  if (shipmentStage == null) return null;
  if (shipmentStage >= 9) return 'fc_received';
  if (shipmentStage >= 7) return 'customs_cleared';
  if (shipmentStage >= 5) return 'departed';
  return null;
}

/** 보이는 단계 = 원스톱 기록과 이은 선적 중 더 앞선 쪽(취소면 취소) */
export function effectiveStage(recorded: OnestopStage | 'cancelled', shipmentStage: number | null | undefined): { stage: OnestopStage | 'cancelled'; fromShipment: boolean } {
  if (recorded === 'cancelled') return { stage: 'cancelled', fromShipment: false };
  const s = stageFromShipment(shipmentStage);
  if (s && stageRank(s) > stageRank(recorded)) return { stage: s, fromShipment: true };
  return { stage: recorded, fromShipment: false };
}

/** 운영이 다음에 남길 수 있는 단계(앞으로만, 건너뛰기 가능) */
export function nextStages(current: OnestopStage | 'cancelled'): OnestopStage[] {
  if (current === 'cancelled') return [];
  return ONESTOP_STAGES.filter((s) => stageRank(s) > stageRank(current));
}

// ─── 혼적 마감 ─────────────────────────────────────────────────────────

/**
 * 다음 혼적 마감(한국 시각) — now(ms) 기준으로 마감 요일·시각이 아직 안 지난 가장 가까운 날.
 * 돌려주는 값: 날짜(YYYY-MM-DD, KST)와 요일(0~6).
 */
export function nextCutoff(nowMs: number, weekdays: readonly number[], hourKst: number): { date: string; weekday: number } {
  if (!weekdays.length) throw new RangeError('마감 요일이 비었습니다');
  const kst = new Date(nowMs + 9 * 3600_000); // UTC 필드로 읽으면 한국 시각
  for (let add = 0; add < 8; add++) {
    const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + add));
    const wd = d.getUTCDay();
    if (!weekdays.includes(wd)) continue;
    if (add === 0 && kst.getUTCHours() >= hourKst) continue;
    return { date: d.toISOString().slice(0, 10), weekday: wd };
  }
  throw new RangeError('마감을 찾지 못했습니다');
}

export const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;
