import type { Metadata } from 'next';
import { Clock, Link2Off } from 'lucide-react';
import { asPublic } from '@/lib/db';
import { BrandMark } from '@/components/brand-mark';
import { InterviewFlow } from '@/components/research/interview-flow';
import { getReference } from '@/lib/server/reference';
import { publicResearchRules } from '@/lib/server/research';
import { hashInviteToken, isInviteToken } from '@/lib/workspace/invite';
import { dateTimeKo } from '@/lib/format';
import type { AnswersT } from '@/lib/research/answers';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '셀러 인터뷰',
  robots: { index: false, follow: false },
  // 링크의 토큰이 다른 사이트로 새지 않게
  referrer: 'no-referrer',
};

const CLOSED: Record<string, { title: string; body: string }> = {
  not_found: { title: '인터뷰 링크를 찾을 수 없습니다', body: '받은 링크를 끝까지 복사했는지 확인해 주세요. 그래도 안 되면 링크를 보낸 담당자에게 새 링크를 부탁해 주세요.' },
  revoked: { title: '거둔 링크입니다', body: '담당자가 이 링크를 거뒀습니다. 새 링크를 받아 주세요.' },
  expired: { title: '기한이 지난 링크입니다', body: '담당자에게 새 링크를 부탁해 주세요.' },
  completed: { title: '이미 끝낸 인터뷰입니다', body: '답을 모두 받았습니다. 시간 내 주셔서 고맙습니다.' },
};

export default async function InterviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = isInviteToken(token)
    ? (
        await asPublic((q) =>
          q.query<{ status: string; consent_state: string | null; head_id: string | null; head_version: number | null; step: string | null; answers: AnswersT | null; expires_at: string | null }>(
            `select * from fcd.research_invite_open($1)`,
            [hashInviteToken(token)],
          ),
        )
      )[0]
    : undefined;
  const status = row?.status ?? 'not_found';
  const [rules, ref] = await Promise.all([publicResearchRules(), getReference()]);

  return (
    <div className="min-h-dvh bg-paper">
      <header className="bg-ink px-4 py-3 text-on-ink">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <BrandMark />
          <span className="text-xs text-on-ink-muted">셀러 인터뷰 · 5~10분</span>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="mb-1 text-xl font-bold">중국→쿠팡 FC 물류, 어떻게 하고 계세요?</h1>
        <p className="mb-5 text-md text-muted">정답은 없습니다. 지난 경험 그대로 알려 주시면 됩니다.</p>
        {status !== 'open' ? (
          <div className="rounded-md border border-line bg-surface p-6 text-center" data-testid="interview-closed" data-status={status}>
            <div className="mx-auto mb-3 grid size-12 place-items-center rounded-sm border border-dashed border-line text-muted [&_svg]:size-5">
              {status === 'expired' ? <Clock aria-hidden /> : <Link2Off aria-hidden />}
            </div>
            <p className="text-lg font-bold">{CLOSED[status]?.title ?? CLOSED.not_found.title}</p>
            <p className="mt-2 text-md text-muted">{CLOSED[status]?.body ?? CLOSED.not_found.body}</p>
          </div>
        ) : (
          <>
            <InterviewFlow
              mode="self"
              token={token}
              initial={{ answers: row?.answers ?? null, step: row?.step ?? null, headId: row?.head_id ?? null, version: row?.head_version ?? 0, consentState: row?.consent_state ?? 'none' }}
              rules={{ ladderBp: rules.ladderBp, consentVersion: rules.consentVersion, retentionDays: rules.retentionDays }}
              hubs={ref.hubs.map((h) => ({ code: h.code, name_ko: `${h.name_ko}(${h.province_ko})` }))}
              ports={ref.ports.map((p) => ({ code: p.code, name_ko: p.name_ko }))}
              modes={ref.modes.map((m) => ({ code: m.code, name_ko: m.name_ko }))}
            />
            {row?.expires_at ? <p className="mt-4 text-center text-2xs text-muted">이 링크는 {dateTimeKo(row.expires_at)}까지 쓸 수 있습니다.</p> : null}
          </>
        )}
      </main>
    </div>
  );
}
