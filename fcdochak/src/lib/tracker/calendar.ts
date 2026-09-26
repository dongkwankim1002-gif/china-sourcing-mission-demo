/**
 * 한국 영업일 달력 — 순수 함수(브라우저·서버 공용). 토·일·공휴일(대체공휴일 포함)을 뺀다.
 * 공휴일 목록은 코드에 두지 않고 fcd.settings 'calendar.kr_holidays' 에서 읽어 넘긴다(첫 판 2026~2027, 확인 필요).
 * 날짜는 모두 한국 날짜 'YYYY-MM-DD'.
 */

export type Ymd = string;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

function ms(d: Ymd): number {
  if (!YMD.test(d)) throw new RangeError(`날짜는 YYYY-MM-DD: ${d}`);
  const t = Date.parse(`${d}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d) throw new RangeError(`없는 날짜: ${d}`);
  return t;
}

export function addDays(d: Ymd, n: number): Ymd {
  return new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
}

/** 0 = 일요일 … 6 = 토요일 */
export function weekday(d: Ymd): number {
  return new Date(ms(d)).getUTCDay();
}

/** 시각(ISO·밀리초) → 한국 날짜 */
export function kstYmd(at: string | number | Date): Ymd {
  const t = typeof at === 'number' ? at : new Date(at).getTime();
  if (!Number.isFinite(t)) throw new RangeError('시각을 읽지 못했습니다');
  return new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
}

export type HolidaySet = ReadonlySet<Ymd>;

export function holidaySet(days: readonly { date: Ymd }[]): HolidaySet {
  return new Set(days.map((d) => (ms(d.date), d.date)));
}

export function isBusinessDay(d: Ymd, holidays: HolidaySet): boolean {
  const w = weekday(d);
  return w !== 0 && w !== 6 && !holidays.has(d);
}

/** d 가 영업일이면 d, 아니면 그 뒤 첫 영업일 */
export function nextBusinessDay(d: Ymd, holidays: HolidaySet): Ymd {
  let x = d;
  for (let i = 0; i < 60; i++) {
    if (isBusinessDay(x, holidays)) return x;
    x = addDays(x, 1);
  }
  throw new RangeError('60일 안에 영업일이 없습니다 — 공휴일 목록을 확인해 주세요');
}

/**
 * d 에서 영업일 n 일 뒤. n = 0 이면 d 가 영업일일 때 d, 아니면 다음 영업일(주말·휴일에 입항하면 첫 영업일부터 센다).
 * n 은 0 이상의 정수.
 */
export function addBusinessDays(d: Ymd, n: number, holidays: HolidaySet): Ymd {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('영업일 수는 0 이상의 정수');
  let x = nextBusinessDay(d, holidays);
  for (let k = 0; k < n; k++) x = nextBusinessDay(addDays(x, 1), holidays);
  return x;
}

/**
 * a 에서 b 까지 걸린 영업일 — a 다음 날부터 b 까지의 영업일 수(같은 날이면 0).
 * a 가 주말·휴일이면 a 를 그 뒤 첫 영업일로 옮겨 센다(토요일 입항 → 월요일 수리 = 0영업일, 화요일 수리 = 1영업일).
 * b < a 면 오류.
 */
export function businessDaysBetween(a: Ymd, b: Ymd, holidays: HolidaySet): number {
  if (ms(b) < ms(a)) throw new RangeError('끝 날짜가 시작보다 앞섭니다');
  const start = nextBusinessDay(a, holidays);
  if (ms(b) <= ms(start)) return 0;
  let n = 0;
  for (let x = addDays(start, 1); ms(x) <= ms(b); x = addDays(x, 1)) {
    if (isBusinessDay(x, holidays)) n++;
  }
  return n;
}
