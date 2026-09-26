import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { asUser } from '@/lib/db';
import { requireViewer } from '@/lib/server/viewer';
import { loadResearchRules } from '@/lib/server/research';
import { getReference } from '@/lib/server/reference';
import { InterviewFlow } from '@/components/research/interview-flow';
import { DemoChip } from '@/components/badges';
import { WithdrawButton } from '@/components/research/admin-forms';
import { PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { dateTimeKo } from '@/lib/format';
import { STEP_LABEL, type AnswersT, type Step } from '@/lib/research/answers';

export const metadata = { title: '인터뷰어 모드' };

export default async function ConductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const v = await requireViewer('admin', `/admin/research/${id}/conduct`);
  const d = await asUser(v, async (q) => {
    const p = (
      await q.query<{ id: string; code: string; label: string; consent_state: string; is_demo: boolean }>(
        `select id, code, label, consent_state, is_demo from fcd.v_research_participants where id = $1`,
        [id],
      )
    )[0];
    if (!p) return null;
    const versions = await q.query<{ id: string; version: number; step: string; completed: boolean; source: string; created_at: string; answers: AnswersT }>(
      `select id, version, step, completed, source, created_at, answers from fcd.research_responses where participant_id = $1 order by version desc`,
      [id],
    );
    return { p, versions, rules: await loadResearchRules(q) };
  });
  if (!d) notFound();
  const ref = await getReference();
  const head = d.versions[0] ?? null;
  const everDone = d.versions.some((x) => x.completed);
  return (
    <>
      <PageTitle
        eyebrow={<Link href="/admin/research" className="inline-flex items-center gap-1 underline underline-offset-4"><ArrowLeft className="size-3.5" aria-hidden /> 결정 보드</Link>}
        title={<span className="flex flex-wrap items-center gap-2">인터뷰어 모드 — {d.p.code} {d.p.label}{d.p.is_demo ? <DemoChip /> : null}</span>}
        sub={
          everDone
            ? '이미 끝낸 인터뷰입니다. 고치면 답만 새 판으로 쌓이고 「끝」 상태와 판정 표본은 그대로입니다.'
            : '통화하며 셀러 화면과 같은 순서로 대신 적습니다. 「읽을 말」을 그대로 읽고, 숫자를 먼저 권하지 않습니다. 저장은 새 판으로 쌓입니다.'
        }
        actions={d.p.consent_state === 'agreed' ? <WithdrawButton id={d.p.id} /> : null}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,640px)_minmax(0,1fr)]">
        <InterviewFlow
          mode="interviewer"
          participantId={d.p.id}
          participantLabel={d.p.label}
          initial={{ answers: head?.answers ?? null, step: everDone ? 'lane' : (head?.step ?? null), headId: head?.id ?? null, version: head?.version ?? 0, consentState: d.p.consent_state }}
          rules={{ ladderBp: d.rules.ladderBp, consentVersion: d.rules.consentVersion, retentionDays: d.rules.retentionDays }}
          hubs={ref.hubs.map((h) => ({ code: h.code, name_ko: `${h.name_ko}(${h.province_ko})` }))}
          ports={ref.ports.map((p) => ({ code: p.code, name_ko: p.name_ko }))}
          modes={ref.modes.map((m) => ({ code: m.code, name_ko: m.name_ko }))}
        />
        <Panel className="self-start">
          <PanelHead title={`저장한 판 ${d.versions.length}개`} sub="고치지 않고 쌓입니다 — 맨 위가 지금 판" />
          {d.versions.length ? (
            <ol className="text-sm" data-testid="versions">
              {d.versions.slice(0, 30).map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line-2 px-4 py-2 last:border-0">
                  <b className="font-mono text-xs">v{x.version}</b>
                  <span>{x.completed ? '끝' : `${STEP_LABEL[x.step as Step] ?? x.step}까지`}</span>
                  <span className="text-xs text-muted">{x.source === 'self' ? '셀러 혼자' : '대신 적음'}</span>
                  <span className="flex-1" />
                  <span className="text-2xs text-muted tnum">{dateTimeKo(x.created_at)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-4 py-6 text-sm text-muted">아직 저장한 답이 없습니다.</p>
          )}
        </Panel>
      </div>
    </>
  );
}
