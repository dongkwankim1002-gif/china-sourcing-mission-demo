/**
 * 판매 자료 실제 호출(v2 3차 sales) — 2차 wing 의 HTTP 어댑터(서명·속도·재시도·스위치)를 그대로 쓴다. 새 호출기를 만들지 않는다.
 *
 *  · 연결 시험: 로켓창고 재고 요약 GET 한 번(2차 어댑터의 inventorySummaries). 200 이면 연결 확인 — 응답 칸은 읽지 않는다.
 *  · 주문·반품·상품·정산: 쿠팡 원문에서 응답 칸 이름을 확인하지 못했다(docs/sales-plan.md 2절) → WingUnsupportedError.
 *    지어낸 칸 이름으로 읽지 않는다. 확인되면 여기에 파서를 붙인다.
 *  · 쓰기(POST·PUT·DELETE)는 없다.
 */
import type { WingHttpAdapter } from '../wing/http';
import { WingDisabledError, WingUnsupportedError } from '../wing/types';
import type { SalesDataset } from './types';

export class SalesHttpSource {
  constructor(
    /** 키를 꺼내 만든 어댑터 — 연결 시험에만 쓴다(판매 기록 가져오기는 응답 칸 확인 전이라 키를 꺼내지 않는다: null) */
    private readonly a: WingHttpAdapter | null,
    private readonly enabled: boolean,
  ) {}

  /** 연결 시험 — 스위치가 꺼져 있으면 어댑터가 부르기 전에 WingDisabledError */
  async testConnection(): Promise<true> {
    if (!this.a) throw new WingDisabledError();
    await this.a.inventorySummaries();
    return true;
  }

  async fetchDataset(range: { from: string; to: string }): Promise<SalesDataset> {
    void range;
    // 쿠팡을 부르지 않는다 — 꺼져 있으면 꺼짐, 켜져 있어도 응답 칸 확인 전이라 「확인 필요」
    if (!this.enabled) throw new WingDisabledError();
    throw new WingUnsupportedError('로켓그로스 주문·반품·상품 응답 칸');
  }
}
