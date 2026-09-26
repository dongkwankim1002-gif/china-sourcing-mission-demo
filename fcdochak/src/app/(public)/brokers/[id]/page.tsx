import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Info, Lock } from 'lucide-react';
import { getViewer } from '@/lib/server/viewer';
import { asPublic } from '@/lib/db';
import { getReference, nameOf } from '@/lib/server/reference';
import { listBrokers, snapsForSafe } from '@/lib/server/scorecard';
import { ScorecardDetail } from '@/components/scorecard/parts';
import { LetterMark } from '@/components/brand-mark';
import { DemoChip, PartnerStatusChip, RelatedChip } from '@/components/badges';
import { DefList, EmptyState, Panel, PanelHead } from '@/components/ui/core';

export const dynamic = 'force-dynamic';

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await asPublic(listBrokers)).find((b) => b.id === id) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const b = await load((await params).id);
  if (!b) return { title: '관세사를 찾을 수 없습니다', robots: { index: false } };
  return { title: `${b.name} — 관세사 · 통관 실측`, description: `${b.name} 기본 정보(주 세관·항구)와 관세청 단계 기록으로 잰 통관 실측(로그인 화주).`, alternates: { canonical: `/brokers/${b.id}` } };
}

export default async function BrokerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await load(id);
  if (!b) notFound();
  const viewer = await getViewer();
  const [ref, score] = await Promise.all([getReference(), snapsForSafe(viewer)]);
  const allowed = score.named === 'all' || (score.named === 'own' && !!viewer?.orgs.some((o) => o.id === b.id));
  const listed = b.status === 'official' || b.status === 'pending_verification';
  const mine = allowed && listed ? score.snaps.filter((s) => s.entity_kind === 'broker' && s.entity_org_id === b.id) : [];
  const all = mine.find((s) => s.port == null && s.mode == null) ?? null;
  const rows = mine.filter((s) => s.port != null && s.mode != null);
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10">
      <nav aria-label="경로" className="text-xs text-muted">
        <Link href="/brokers" className="hover:text-text">관세사 찾기</Link> / {b.name}
      </nav>
      <header className="mt-3 flex flex-wrap items-start gap-4">
        <LetterMark name={b.name} size={56} />
        <div className="min-w-0 flex-1">
          <h1 className="display text-[clamp(24px,3.4vw,36px)] leading-tight">{b.name}</h1>
          <p className="text-sm text-muted">{b.name_zh} · 관세사 · {b.hq_city}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <PartnerStatusChip status={b.status} />
            {b.related_party_note ? <RelatedChip note={b.related_party_note} /> : null}
            {b.is_demo ? <DemoChip /> : null}
          </div>
          {b.slug ? (
            <p className="mt-2 text-xs">
              <Link href={`/p/${b.slug}`} className="font-semibold underline underline-offset-4">업체 화면(요금·후기·거래 기록)</Link>
            </p>
          ) : null}
        </div>
      </header>
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 content-start gap-6">
          {allowed ? (
            <ScorecardDetail
              all={all}
              rows={rows}
              minSamples={score.config.rules.minSamples}
              portName={(c) => nameOf(ref, 'port', c)}
              modeName={(c) => nameOf(ref, 'mode', c)}
              title="통관 성적표"
              sub={all ? `셀러가 화물번호에 이 관세사를 적은 화물의 관세청 단계 기록 · 최근 ${all.window_days}일 · 한국 영업일` : undefined}
            />
          ) : (
            <Panel data-testid="scorecard-locked">
              <EmptyState
                icon={<Lock aria-hidden />}
                title="관세사 이름이 붙은 성적표는 로그인한 화주에게 보입니다"
                body="입항 → 수리 · 검사 비율 · 반입 → 반출을 관세청 단계 기록으로 잽니다."
                action={<Link href={`/login?next=${encodeURIComponent(`/brokers/${b.id}`)}`} className="text-sm font-semibold underline underline-offset-4">로그인</Link>}
              />
            </Panel>
          )}
          <p className="flex items-start gap-2 text-2xs text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            검사 지정은 세관이 정합니다 — 관세사 탓이 아닐 수 있어 참고로만 보세요. 통관 위임은 화주와 관세사가 직접 맺고, 관세사 보수는 FC도착 수수료 기준에서 뺍니다.
          </p>
        </div>
        <Panel as="aside" className="content-start">
          <PanelHead title="기본 정보" sub={b.profile_source === 'mock' ? '예시(흉내) 정보' : b.profile_source === 'admin' ? '운영자가 확인해 넣은 정보' : '아직 입력 전'} />
          <div className="p-4">
            <DefList
              items={[
                ['등록번호', b.registration_no ?? '—'],
                ['주 세관', (b.customs_offices ?? []).join(' · ') || '—'],
                ['항구', (b.ports ?? []).map((p) => nameOf(ref, 'port', p)).join(' · ') || '—'],
                ['전문', b.specialties ?? '—'],
              ]}
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}
