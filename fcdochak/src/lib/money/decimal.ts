/**
 * 원 단위 돈 계산용 정수 산술. 부동소수 오차로 1원이 틀어지지 않게
 * 모든 곱셈을 BigInt 로 하고 마지막에 한 번만 반올림한다.
 */

/** 숫자를 10^scale 배 정수(BigInt)로. 문자열을 거쳐 부동소수 꼬리를 자른다. */
export function toScaled(n: number, scale: number): bigint {
  if (!Number.isFinite(n)) throw new RangeError(`유한한 수가 아닙니다: ${n}`);
  const neg = n < 0;
  const s = Math.abs(n).toFixed(scale);
  const [i, f = ''] = s.split('.');
  const v = BigInt(i + f.padEnd(scale, '0'));
  return neg ? -v : v;
}

/** num/den 을 0.5 올림(음수는 대칭)으로 나눈다. */
export function divRoundHalfUp(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new RangeError('0 으로 나눌 수 없습니다');
  const neg = num < 0n !== den < 0n;
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  const q = (a * 2n + b) / (b * 2n);
  return neg ? -q : q;
}

/** num/den 을 버림(0 쪽으로). 세금은 원 미만 절사. */
export function divFloor(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new RangeError('0 으로 나눌 수 없습니다');
  return num / den;
}

export function toNumber(v: bigint): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new RangeError(`안전한 정수 범위를 넘었습니다: ${v}`);
  return n;
}

export const BP = 10_000n; // basis point 분모
