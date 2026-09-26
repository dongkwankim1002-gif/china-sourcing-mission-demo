/**
 * 판매 분석 기준치 읽기 — 순수 함수. 값은 fcd.settings(sales.rules · wing.egress_ips)에서 온다.
 */
import { SALES_SETTING_SCHEMAS } from '../v2-setting-schemas';
import type { SalesRules } from './types';

export function parseSalesRules(v: unknown): SalesRules {
  const r = SALES_SETTING_SCHEMAS['sales.rules'].safeParse(v);
  if (!r.success) throw new Error('설정 sales.rules 가 없거나 올바르지 않습니다. 참조 시드를 올려 주세요.');
  return r.data as SalesRules;
}

/** 연동 IP — 없거나 모양이 틀리면 빈 목록(화면은 「준비 중」) */
export function parseEgressIps(v: unknown): string[] {
  const r = SALES_SETTING_SCHEMAS['wing.egress_ips'].safeParse(v);
  return r.success ? r.data : [];
}
