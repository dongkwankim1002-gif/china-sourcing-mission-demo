/**
 * v2 5차 tracker 설정 — 키 이름·값 규칙. 값은 fcd.settings 에만 있고(참조 시드가 첫 판), 여기엔 규칙만 둔다.
 * 스위치가 없거나 읽을 수 없으면 꺼짐(안전한 쪽). 규칙·달력이 없으면 오류로 멈춘다(참조 시드를 올려야 한다).
 * 브라우저에서도 읽는다 — 서버 전용 모듈이 아니다.
 */
import { z } from 'zod';
import { holidaySet, type HolidaySet } from './calendar';

export const TRACKER_RULES_KEY = 'tracker.rules';
export const HOLIDAYS_KEY = 'calendar.kr_holidays';
export const PROMISE_SWITCH_KEY = 'tracker.arrival_promise_enabled';

const days = z.object({ p50: z.number().min(0).max(60), p90: z.number().min(0).max(90) }).refine((d) => d.p90 >= d.p50, '늦으면(p90)은 보통(p50)보다 작을 수 없습니다');

export const TrackerRulesSchema = z.object({
  /** 공개·업체 화면에 싣는 최소 표본 */
  minSamples: z.number().int().min(1).max(1000),
  /** 통계 기간(일) */
  windowDays: z.number().int().min(7).max(730),
  /** 같은 번호를 다시 부르지 않는 시간(분) */
  cacheMinutes: z.number().int().min(1).max(1440),
  /** 폴링 한 번에 보는 번호 수 */
  batchLimit: z.number().int().min(1).max(500),
  /** 하루 관세청 호출 상한(호출 한도 확인 전 스스로 묶는 값) */
  dailyCallBudget: z.number().int().min(1).max(100_000),
  /** 비로그인 조회 IP 당 분당 횟수 */
  publicPerMinute: z.number().int().min(1).max(600),
  /** 한 조직이 저장할 수 있는 번호 수 */
  maxTracksPerOrg: z.number().int().min(1).max(10_000),
  /** 통계가 모자랄 때 쓰는 가정치(영업일) */
  assumed: z.object({ toClear: days, toFc: days }),
  /** 가정치가 확인한 값이 아니면 true — 화면에 「가정치」 */
  example: z.boolean(),
});
export type TrackerRules = z.infer<typeof TrackerRulesSchema>;

export const HolidaysSchema = z.object({
  /** 목록 전체를 원문과 대조했으면 true */
  confirmed: z.boolean(),
  checkedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  source: z.string().max(500),
  days: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        name: z.string().min(1).max(40),
        /** 대체공휴일이면 true */
        substitute: z.boolean().optional(),
        /** 이 날만 따로 확인하지 못했으면 false */
        confirmed: z.boolean().optional(),
      }),
    )
    .max(200),
});
export type Holidays = z.infer<typeof HolidaysSchema>;

export const TRACKER_SETTING_SCHEMAS: Record<string, z.ZodTypeAny> = {
  [TRACKER_RULES_KEY]: TrackerRulesSchema,
  [HOLIDAYS_KEY]: HolidaysSchema,
  [PROMISE_SWITCH_KEY]: z.boolean(),
};

export const TRACKER_SETTING_LABEL: Record<string, string> = {
  [TRACKER_RULES_KEY]: '통관 알리미 — 표본 기준·기간·캐시·폴링 묶음·하루 호출 상한·가정치',
  [HOLIDAYS_KEY]: '한국 공휴일·대체공휴일 달력(영업일 계산) — 원문 확인 후 새 판으로',
  [PROMISE_SWITCH_KEY]: '도착일 약속 스위치(꺼짐 = 「준비 중」 한 줄만, 보상 없음)',
};

export interface TrackerConfig {
  rules: TrackerRules;
  holidays: Holidays;
  calendar: HolidaySet;
  promiseOn: boolean;
}

export function readTrackerConfig(m: Map<string, unknown>): TrackerConfig {
  const r = TrackerRulesSchema.safeParse(m.get(TRACKER_RULES_KEY));
  if (!r.success) throw new Error('설정 tracker.rules 가 없거나 모양이 틀립니다. 참조 시드를 올려 주세요.');
  const h = HolidaysSchema.safeParse(m.get(HOLIDAYS_KEY));
  if (!h.success) throw new Error('설정 calendar.kr_holidays 가 없거나 모양이 틀립니다. 참조 시드를 올려 주세요.');
  return { rules: r.data, holidays: h.data, calendar: holidaySet(h.data.days), promiseOn: m.get(PROMISE_SWITCH_KEY) === true };
}
