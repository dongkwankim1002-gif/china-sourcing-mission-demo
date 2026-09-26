import type { Metadata } from 'next';
import Link from 'next/link';
import { listPartners } from '@/lib/server/public';
import { getReference } from '@/lib/server/reference';
import { LetterMark } from '@/components/brand-mark';
import { PartnerStatusChip, RelatedChip } from '@/components/badges';
import { EmptyState, PageTitle } from '@/components/ui/core';
import { BIZ_TYPE_LABEL } from '@/lib/terms';
import { cn } from '@/lib/cn';
// v2 6차 scorecard — 성적순 정렬 · 카드 성적 칩(이름 붙은 성적은 로그인 화주에게만)
import { getViewer } from '@/lib/server/viewer';
import { indexSnaps, snapKey, snapsFor } from '@/lib/server/scorecard';
import { SCORE_SORT_LABEL, sortByScore, type ScoreSort } from '@/lib/scorecard/engine';
import { LockedScore, ScoreChips } from '@/components/scorecard/parts';

export const metadata: Metadata = {
  title: '업체 찾기 — 중국·한국 물류사, 관세사, 국내 창고',
  description: '이우·청도·위해·광저우 등 거점과 운송 방식으로 포워더·혼적·카페리·항공·관세사·국내 창고 업체를 찾습니다.',
  alternates: { canonical: '/partners' },
};

export default async function PartnersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [all, ref, viewer] = await Promise.all([listPartners(), getReference(), getViewer()]);
  const type = sp.type ?? '';
  const hub = sp.hub ?? '';
  const q = (sp.q ?? '').trim();
  const sort = (['fast', 'stable', 'inspect'].includes(sp.sort ?? '') ? sp.sort : null) as ScoreSort | null;
  const score = await snapsFor(viewer);
  const idx = indexSnaps(score.snaps);
  const minN = score.config.rules.minSamples;
  const snapOf = (p: { id: string; business_type: string | null }) => idx.get(snapKey(p.business_type === 'customs_broker' ? 'broker' : 'partner', p.id)) ?? null;
  const canSee = (p: { id: string }) => score.named === 'all' || (score.named === 'own' && !!viewer?.orgs.some((o) => o.id === p.id));
  const filtered = all.filter(
    (p) =>
      (!type || p.business_type === type) &&
      (!hub || (p.hubs ?? []).includes(hub)) &&
      (!q || p.name.includes(q) || (p.name_zh ?? '').includes(q)),
  );
  // 성적순은 이름 붙은 성적을 볼 수 있을 때만(비로그인은 원래 순서 + 안내)
  const list = sort && score.named === 'all' ? sortByScore(filtered, snapOf, sort, minN) : filtered;
  const link = (k: string, v: string) => {
    const p = new URLSearchParams(Object.entries({ type, hub, q, sort: sort ?? '' }).filter(([, x]) => x) as [string, string][]);
    if (v) p.set(k, v);
    else p.delete(k);
    const s = p.toString();
    return `/partners${s ? `?${s}` : ''}`;
  };
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-10">
      <PageTitle
        title={<span className="display text-[clamp(28px,4vw,44px)] font-normal">업체 찾기</span>}
        sub="공식 등록 업체는 요금표와 실측 점수를, 공개정보 기준 업체는 공개된 회사 정보만 싣습니다. 성적표는 관세청 단계 기록으로 잰 통관 실측입니다."
      />
      <form className="mb-4 flex flex-wrap gap-2" action="/partners">
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="hub" value={hub} />
        <label className="sr-only" htmlFor="pq">업체 이름</label>
        <input id="pq" name="q" defaultValue={q} placeholder="업체 이름" className="h-10 w-64 rounded-sm border border-line bg-surface px-3" />
        <button className="h-10 rounded-sm bg-ink px-4 text-sm font-semibold text-on-ink">찾기</button>
      </form>
      <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="업종">
        {[['', '전체 업종'], ...Object.entries(BIZ_TYPE_LABEL)].map(([k, v]) => (
          <Link key={k} href={link('type', k)} aria-current={type === k ? 'true' : undefined} className={cn('h-8 rounded-xs border px-3 text-xs font-semibold leading-8', type === k ? 'border-ink bg-ink text-on-ink' : 'border-line bg-surface hover:border-muted/60')}>
            {v}
          </Link>
        ))}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="성적표 정렬">
        <span className="mr-1 text-xs font-semibold text-muted">물류사 성적표</span>
        {([['', '기본 순서'], ...Object.entries(SCORE_SORT_LABEL)] as [string, string][]).map(([k, v]) => (
          <Link key={k} href={link('sort', k)} aria-current={(sort ?? '') === k ? 'true' : undefined} className={cn('h-8 rounded-xs border px-3 text-xs font-semibold leading-8', (sort ?? '') === k ? 'border-ink bg-ink text-on-ink' : 'border-line bg-surface hover:border-muted/60')}>
            {v}
          </Link>
        ))}
        <Link href="/market/customs" className="ml-1 text-xs font-semibold underline underline-offset-4">항구·방식 통관 추이</Link>
      </div>
      {sort && score.named !== 'all' ? (
        <p className="mb-2 rounded-sm border border-line bg-surface-2 px-3 py-2 text-xs text-muted" role="note" data-testid="score-sort-locked">
          성적순 정렬은 로그인한 화주에게 보입니다(업체 이름이 붙은 성적은 공개하지 않습니다). 이름 없는 항구·방식별 추이는 <Link href="/market/customs" className="font-semibold text-text underline underline-offset-4">통관 시장 지표</Link>에서 볼 수 있습니다.
        </p>
      ) : sort ? (
        <p className="mb-2 text-xs text-muted" data-testid="score-sort-now">
          {SCORE_SORT_LABEL[sort]} — 관세청 단계 기록으로 셈한 최근 {score.config.rules.windowDays}일 실측 · 표본 {minN}건 미만 업체는 뒤에 둡니다 · 광고·돈으로 순서를 바꾸지 않습니다
        </p>
      ) : null}
      <div className="mb-6 flex flex-wrap gap-1.5" role="group" aria-label="거점">
        {[['', '전체 거점'], ...ref.hubs.map((h) => [h.code, h.name_ko])].map(([k, v]) => (
          <Link key={k} href={link('hub', k)} aria-current={hub === k ? 'true' : undefined} className={cn('h-8 rounded-xs border px-3 text-xs font-semibold leading-8', hub === k ? 'border-ink bg-ink text-on-ink' : 'border-line bg-surface hover:border-muted/60')}>
            {v}
          </Link>
        ))}
      </div>
      {list.length ? (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p, i) => (
            <li key={p.id} className={i >= 6 ? 'cv-card' : undefined}>
              <Link href={`/p/${p.slug}`} className="flex h-full flex-col gap-3 rounded-md border border-line bg-surface p-4 hover:border-muted/60">
                <div className="flex items-center gap-3">
                  <LetterMark name={p.name} logo={p.logo_path} size={40} />
                  <div className="min-w-0">
                    <p className="truncate font-bold">{p.name}</p>
                    <p className="truncate text-xs text-muted">{p.name_zh} · {p.hq_city}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <PartnerStatusChip status={p.status} />
                  {p.related_party_note ? <RelatedChip note={p.related_party_note} /> : null}
                </div>
                {p.status === 'official' || p.status === 'pending_verification' || snapOf(p) ? (
                  canSee(p) ? <ScoreChips s={snapOf(p)} minSamples={minN} compact /> : <LockedScore plain next="/partners" />
                ) : null}
                <p className="text-xs text-muted">
                  {BIZ_TYPE_LABEL[p.business_type ?? ''] ?? ''} · {(p.hubs ?? []).map((h) => ref.hubs.find((x) => x.code === h)?.name_ko ?? h).join('·')} ·{' '}
                  {(p.modes ?? []).map((m) => ref.modes.find((x) => x.code === m)?.name_ko ?? m).join('·')}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-md border border-line bg-surface">
          <EmptyState title={all.length ? '조건에 맞는 업체가 없습니다' : '아직 등록된 업체가 없습니다'} body={all.length ? '업종이나 거점을 「전체」로 바꿔 보세요.' : '물류사라면 첫 번째로 입점해 보세요.'} action={<Link className="text-sm font-semibold underline" href={all.length ? '/partners' : '/join/partner'}>{all.length ? '필터 지우기' : '물류사 입점 신청'}</Link>} />
        </div>
      )}
    </div>
  );
}
