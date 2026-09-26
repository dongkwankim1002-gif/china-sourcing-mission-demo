'use client';
/** 탭 — 고른 탭이 URL(?tab=)에 실려 링크로 공유된다. 내용은 서버에서 그려 넘긴다. */
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/radix';

export function UrlTabs({ tabs, defaultTab }: { tabs: { value: string; label: React.ReactNode; content: React.ReactNode }[]; defaultTab?: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const cur = sp.get('tab') ?? defaultTab ?? tabs[0]?.value;
  return (
    <Tabs
      value={tabs.some((t) => t.value === cur) ? cur : tabs[0]?.value}
      onValueChange={(v) => {
        const p = new URLSearchParams(sp.toString());
        p.set('tab', v);
        router.replace(`${pathname}?${p}`, { scroll: false });
      }}
    >
      <TabsList>
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value}>
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
