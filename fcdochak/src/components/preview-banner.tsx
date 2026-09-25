/**
 * 미리보기 띠 — 서버 환경변수 PREVIEW_BANNER 가 있을 때만 모든 화면(공개·화주·물류사·운영) 맨 위에.
 * 없으면 아무것도 그리지 않는다. 운영(fcdochak) 배포에는 이 변수를 두지 않는다.
 */
import { FlaskConical } from 'lucide-react';
import { env } from '@/lib/env';

export function PreviewBanner() {
  const v = env.previewBanner;
  if (!v) return null;
  return (
    <div
      role="note"
      aria-label="미리보기 안내"
      data-testid="preview-banner"
      data-preview-banner=""
      // 높이는 --banner-h(1.75rem)와 같게 한 줄로 고정 — 셸의 붙박이 머리·옆 메뉴가 이 높이만큼 내려 앉는다
      className="sticky top-0 z-[60] flex h-7 items-center justify-center gap-2 overflow-hidden whitespace-nowrap border-b border-stamp/40 bg-stamp-bg px-3 text-center text-xs font-bold text-stamp"
    >
      <FlaskConical className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">v2 미리보기 — 운영 아님</span>
      <span className="hidden font-semibold sm:inline">· 임시 자료라 바뀌거나 사라질 수 있습니다</span>
    </div>
  );
}
