import type { Metadata } from 'next';
import Link from 'next/link';
import { laneStats, STANDARD_CARGO } from '@/lib/server/public';
import { EmptyState, PageTitle } from '@/components/ui/core';
import { num, wonShort, ago } from '@/lib/format';

export const revalidate = 3600;
export const metadata: Metadata = {
  title: '구간 시세 — 중국 → 쿠팡 FC 물류비 중간값',
  description: '이우·청도·위해·연태·일조·광저우·선전에서 인천·평택을 거쳐 쿠팡 FC까지, 운송 방식별 FC 도착 총액 중간값과 최저가.',
  alternates: { canonical: '/lanes' },
};

export default async function LanesPage() {
  const lanes = await laneStats();
  const hubs = [...new Set(lanes.map((l) => l.hub))];
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-10">
      <PageTitle
        eyebrow={`기준 화물 ${STANDARD_CARGO.cbm} CBM · ${num(STANDARD_CARGO.kg)} kg · ${STANDARD_CARGO.cartons}박스 · ${num(STANDARD_CARGO.units)}개 · 빈 구간은 참고치로 채움`}
        title={<span className="display text-[clamp(28px,4vw,44px)] font-normal">구간 시세</span>}
        sub="공식·인증 대기 업체의 지금 유효한 요금표로 기준 화물의 FC 도착 총액을 계산해 중간값·최저를 냅니다. 개별 업체 가격은 싣지 않습니다."
      />
      {lanes.length === 0 ? (
        <div className="rounded-md border border-line bg-surface">
          <EmptyState title="아직 올라온 요금표가 없습니다" body="첫 요금표가 올라오면 구간별 시세가 여기에 채워집니다." />
        </div>
      ) : (
        <div className="grid gap-6">
          {hubs.map((h) => {
            const rows = lanes.filter((l) => l.hub === h);
            return (
              <section key={h} aria-labelledby={`h-${h}`} className="rounded-md border border-line bg-surface">
                <h2 id={`h-${h}`} className="border-b border-line-2 px-4 py-3 text-md font-bold">
                  {rows[0].hubName} 출발 <span className="text-sm font-normal text-muted">{rows[0].hubNameZh}</span>
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm tnum">
                    <thead className="text-xs text-muted">
                      <tr>
                        <th scope="col" className="px-4 py-2 text-left font-semibold">도착항 · 방식</th>
                        <th scope="col" className="px-4 py-2 text-right font-semibold">중간값</th>
                        <th scope="col" className="px-4 py-2 text-right font-semibold">최저</th>
                        <th scope="col" className="px-4 py-2 text-right font-semibold">CBM당 중간값</th>
                        <th scope="col" className="px-4 py-2 text-right font-semibold">기간</th>
                        <th scope="col" className="px-4 py-2 text-right font-semibold">요금표 · 업체</th>
                        <th scope="col" className="px-4 py-2 text-right font-semibold">최근 갱신</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((l) => (
                        <tr key={l.slug} className="border-t border-line-2 hover:bg-surface-2">
                          <th scope="row" className="px-4 py-2.5 text-left font-semibold">
                            <Link href={`/lanes/${l.slug}`} className="hover:underline">
                              {l.portName} · {l.modeName}
                            </Link>
                          </th>
                          <td className="px-4 py-2.5 text-right font-bold">{wonShort(l.median)}</td>
                          <td className="px-4 py-2.5 text-right text-muted">{wonShort(l.min)}</td>
                          <td className="px-4 py-2.5 text-right text-muted">{wonShort(l.medianPerCbm)}</td>
                          <td className="px-4 py-2.5 text-right text-muted">{l.transitMin}~{l.transitMax}일</td>
                          <td className="px-4 py-2.5 text-right text-muted">{l.cards}장 · {l.partners}곳</td>
                          <td className="px-4 py-2.5 text-right text-muted">{ago(l.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
