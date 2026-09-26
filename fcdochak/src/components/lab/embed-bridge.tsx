'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { LAB_ORIGIN } from '@/lib/embed';

/** 비교실(/lab) 안에 끼워졌을 때만 지금 경로를 비교실에 알린다. 혼자 열렸을 때는 아무것도 하지 않는다. */
export function EmbedBridge() {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    if (window.parent === window) return;
    const msg = { type: 'fcd:path', path: pathname + (search.size ? `?${search}` : ''), title: document.title };
    for (const o of new Set([LAB_ORIGIN, window.location.origin])) {
      try {
        window.parent.postMessage(msg, o);
      } catch {
        /* 주소가 다르면 조용히 버려진다 */
      }
    }
  }, [pathname, search]);
  return null;
}
