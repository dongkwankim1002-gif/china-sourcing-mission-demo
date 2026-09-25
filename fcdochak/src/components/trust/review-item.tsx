/**
 * 공개 후기 한 줄(v2 trust) — 회송·반려·분실로 끝난 선적이면 그 표시를, 업체 공개 답변이 있으면 그 아래에.
 */
import { MessageSquareReply, PackageX, RotateCcw, SearchX } from 'lucide-react';
import { Chip } from '@/components/ui/core';
import { dateKo } from '@/lib/format';
import { REVIEW_OUTCOME_LABEL } from '@/lib/terms';

export interface ReviewItemData {
  id: string;
  rating: number;
  body: string;
  author_label: string;
  created_at: string;
  outcome: string | null;
  reply_body: string | null;
  reply_version: number | null;
  reply_at: string | null;
}

export function OutcomeChip({ outcome }: { outcome: string | null }) {
  if (!outcome || outcome === 'delivered') return null;
  const icon = outcome === 'fc_returned' ? <RotateCcw aria-hidden /> : outcome === 'fc_rejected' ? <PackageX aria-hidden /> : <SearchX aria-hidden />;
  return (
    <Chip tone={outcome === 'fc_returned' ? 'caution' : 'stamp'} icon={icon}>
      {REVIEW_OUTCOME_LABEL[outcome] ?? outcome}
    </Chip>
  );
}

export function ReplyBlock({ partnerName, body, version, at }: { partnerName: string; body: string; version: number | null; at: string | null }) {
  return (
    <div data-testid="review-reply" className="mt-2 border-l-2 border-ink/40 pl-3">
      <p className="flex flex-wrap items-center gap-1.5 text-2xs font-semibold text-muted">
        <MessageSquareReply className="size-3.5" aria-hidden /> {partnerName} 답변
        {at ? <span className="font-normal">· {dateKo(at, { dow: false })}</span> : null}
        {version && version > 1 ? <span className="font-normal">· 고친 판(v{version}, 이전 판도 기록에 남습니다)</span> : null}
      </p>
      <p className="mt-0.5 text-sm">{body}</p>
    </div>
  );
}

export function ReviewItem({ r, partnerName }: { r: ReviewItemData; partnerName: string }) {
  return (
    <li className="border-b border-line-2 px-4 py-3 last:border-0" data-outcome={r.outcome ?? 'delivered'}>
      <div className="flex flex-wrap items-start gap-2">
        <p className="min-w-0 flex-1 text-sm">“{r.body}”</p>
        <OutcomeChip outcome={r.outcome} />
      </div>
      <p className="mt-1 text-2xs text-muted">
        {r.rating}/5 · {r.author_label} · {dateKo(r.created_at, { dow: false })}
      </p>
      {r.reply_body ? <ReplyBlock partnerName={partnerName} body={r.reply_body} version={r.reply_version} at={r.reply_at} /> : null}
    </li>
  );
}
