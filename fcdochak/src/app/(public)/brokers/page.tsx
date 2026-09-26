import type { Metadata } from 'next';
import Link from 'next/link';
import { getViewer } from '@/lib/server/viewer';
import { asPublic } from '@/lib/db';
import { getReference, nameOf } from '@/lib/server/reference';
import { indexSnaps, listBrokers, snapKey, snapsForSafe } from '@/lib/server/scorecard';
import { SCORE_SORT_LABEL, sortByScore, type ScoreSort } from '@/lib/scorecard/engine';
import { LockedScore, ScoreChips } from '@/components/scorecard/parts';
import { LetterMark } from '@/components/brand-mark';
import { DemoChip, PartnerStatusChip, RelatedChip } from '@/components/badges';
import { EmptyState, PageTitle } from '@/components/ui/core';
import { cn } from '@/lib/cn';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '관세사 찾기 — 통관 실측 성적표',
  description: '중국발 수입 통관을 맡는 관세사를 항구·주 세관으로 찾고, 관세청 단계 기록으로 잰 입항 → 수리 실측(로그인 화주)을 봅니다.',
  alternates: { canonical: '/brokers' },
};

export default async function BrokersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const viewer = await getViewer();
  const [brokers, ref, score] = await Promise.all([asPublic(listBrokers), getReference(), snapsForSafe(viewer)]);
  const port = ref.ports.some((p) => p.code === sp.port) ? sp.port! : '';
  const sort = (['fast', 'stable', 'inspect'].includes(sp.sort ?? '') ? sp.sort : null) as ScoreSort | null;
  const idx = indexSnaps(score.snaps);
  const minN = score.config.rules.minSamples;
  // 이름 붙은 성적은 입점 관세사(공식·인증 대기)만 — 공개정보 기준은 알림·답변권·이의가 없다(기획 7-4)
  const listed = (b: { status: string }) => b.status === 'official' || b.status === 'pending_verification';
  const snapOf = (b: { id: string; status: string }) => (listed(b) ? idx.get(snapKey('broker', b.id, null, null)) ?? null : null);
  const canSee = (id: string) => score.named === 'all' || (score.named === 'own' && !!viewer?.orgs.some((o) => o.id === id));
  const filtered = brokers.filter((b) => !port || (b.ports ?? []).includes(port));
  const list = sort && score.named === 'all' ? sortByScore(filtered, snapOf, sort, minN) : filtered;
  const link = (k: string, v: string) => {
    const p = new URLSearchParams(Object.entries({ port, sort: sort ?? '' }).filter(([, x]) => x) as [string, string][]);
    if (v) p.set(k, v);
    else p.delete(k);
    const s = p.toString();
    return `/brokers${s ? `?${s}` : ''}`;
  };
  const chip = (on: boolean) => cn('h-8 rounded-xs border px-3 text-xs font-semibold leading-8', on ? 'border-ink bg-ink text-on-ink' : 'border-line bg-surface hover:border-muted/60');
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-10">
      <PageTitle
        title={<span className="display text-[clamp(28px,4vw,44px)] font-normal">관세사 찾기</span>}
        sub="관세사 기본 정보(등록번호·주 세관)는 누구나, 관세청 단계 기록으로 잰 통관 실측은 로그인한 화주에게 보입니다. 관세사 보수는 FC도착 수수료 기준에서 뺍니다."
      />
      <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="항구">
        {[['', '전체 항구'], ...ref.ports.map((p) => [p.code, p.name_ko])].map(([k, v]) => (
          <Link key={k} href={link('port', k)} aria-current={port === k ? 'true' : undefined} className={chip(port === k)}>{v}</Link>
        ))}
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-1.5" role="group" aria-label="성적표 정렬">
        {([['', '기본 순서'], ...Object.entries(SCORE_SORT_LABEL)] as [string, string][]).map(([k, v]) => (
          <Link key={k} href={link('sort', k)} aria-current={(sort ?? '') === k ? 'true' : undefined} className={chip((sort ?? '') === k)}>{v}</Link>
        ))}
        {sort && score.named !== 'all' ? <span className="text-xs text-muted" role="note">성적순 정렬은 로그인한 화주에게 보입니다.</span> : null}
      </div>
      {list.length ? (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="broker-list">
          {list.map((b) => (
            <li key={b.id}>
              <Link href={`/brokers/${b.id}`} className="flex h-full flex-col gap-3 rounded-md border border-line bg-surface p-4 hover:border-muted/60">
                <div className="flex items-center gap-3">
                  <LetterMark name={b.name} size={40} />
                  <div className="min-w-0">
                    <p className="truncate font-bold">{b.name}</p>
                    <p className="truncate text-xs text-muted">{b.name_zh} · {b.hq_city}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <PartnerStatusChip status={b.status} />
                  {b.related_party_note ? <RelatedChip note={b.related_party_note} /> : null}
                  {b.is_demo ? <DemoChip /> : null}
                </div>
                <p className="text-xs text-muted">
                  {(b.customs_offices ?? []).join(' · ') || '주 세관 미입력'} · {(b.ports ?? []).map((p) => nameOf(ref, 'port', p)).join('·') || '항구 미입력'}
                  {b.registration_no ? ` · ${b.registration_no}` : ''}
                </p>
                {!listed(b) ? (
                  <p className="text-2xs text-muted">공개정보 기준 — 입점하면 성적표가 붙습니다</p>
                ) : canSee(b.id) ? (
                  <ScoreChips s={snapOf(b)} minSamples={minN} compact />
                ) : (
                  <LockedScore plain next="/brokers" />
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-md border border-line bg-surface">
          <EmptyState title={brokers.length ? '이 항구를 맡는 관세사가 없습니다' : '아직 등록된 관세사가 없습니다'} action={<Link className="text-sm font-semibold underline" href="/brokers">필터 지우기</Link>} />
        </div>
      )}
      <p className="mt-6 text-2xs text-muted">
        관세사 기본 정보는 운영자가 넣은 값(예시 계정은 흉내)입니다 — 관세청 공개 관세사 목록 API 는 확인하지 못했습니다(확인 필요). 성적은 셀러가 화물번호에 적은 관세사 기준입니다.
      </p>
    </div>
  );
}
