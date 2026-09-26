'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardCopy, ExternalLink, Link2, NotebookPen, RotateCw, X } from 'lucide-react';
import { Button, Textarea } from '@/components/ui/core';
import { cn } from '@/lib/cn';
import type { LabVersion } from '@/lib/lab-versions';

const DEVICES = [
  { key: 'phone', label: '휴대폰', width: 390 },
  { key: 'tablet', label: '태블릿', width: 768 },
  { key: 'desktop', label: '데스크톱', width: 1440 },
] as const;
type DeviceKey = (typeof DEVICES)[number]['key'];

const QUICK = [
  { path: '/', label: '홈' },
  { path: '/check', label: '청구서 점검' },
  { path: '/lanes', label: '구간 시세' },
  { path: '/partners', label: '업체' },
  { path: '/login', label: '로그인' },
  { path: '/app', label: '화주' },
  { path: '/partner', label: '물류사' },
  { path: '/admin', label: '운영' },
];

const CRITERIA = ['믿음이 가는가', '이해가 쉬운가', '가입 전에 얻는 것', '일의 흐름', '빠르기'] as const;

interface Note {
  scores: Partial<Record<(typeof CRITERIA)[number], number>>;
  pros: string;
  cons: string;
}
const NOTES_KEY = 'fcd-lab-notes-v1';

function loadNotes(): Record<string, Note> {
  try {
    return JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}') as Record<string, Note>;
  } catch {
    return {};
  }
}

function normPath(p: string) {
  const t = p.trim();
  if (!t) return '/';
  try {
    if (/^https?:\/\//.test(t)) {
      const u = new URL(t);
      return u.pathname + u.search;
    }
  } catch {
    /* 그대로 */
  }
  return t.startsWith('/') ? t : `/${t}`;
}

export function LabClient({ versions }: { versions: LabVersion[] }) {
  const ready = versions.filter((v) => !v.planned);
  const [shown, setShown] = useState<string[]>(ready.slice(0, 2).map((v) => v.key));
  const [mobileKey, setMobileKey] = useState<string>(ready[0]?.key ?? '');
  const [device, setDevice] = useState<DeviceKey>('desktop');
  const [path, setPath] = useState('/');
  const [draft, setDraft] = useState('/');
  const [follow, setFollow] = useState(true);
  const [src, setSrc] = useState<Record<string, { path: string; n: number }>>(() => Object.fromEntries(versions.map((v) => [v.key, { path: '/', n: 0 }])));
  const [current, setCurrent] = useState<Record<string, string>>({});
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => setNotes(loadNotes()), []);
  useEffect(() => {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
    } catch {
      /* 저장 못 해도 화면은 돈다 */
    }
  }, [notes]);

  const originOf = useCallback((v: LabVersion) => (v.url ? v.url : typeof window === 'undefined' ? '' : window.location.origin), []);

  const goAll = useCallback(
    (p: string) => {
      const np = normPath(p);
      setPath(np);
      setDraft(np);
      setSrc((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { path: np, n: v.n + 1 }])));
    },
    [],
  );

  // 끼워진 화면이 알려 주는 지금 경로 — 따라가기가 켜져 있으면 다른 판도 같은 경로로
  const followRef = useRef(follow);
  followRef.current = follow;
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const d = e.data as { type?: string; path?: string } | null;
      if (!d || d.type !== 'fcd:path' || typeof d.path !== 'string') return;
      const v = versions.find((x) => originOf(x) === e.origin);
      if (!v) return;
      const p = d.path;
      setCurrent((c) => (c[v.key] === p ? c : { ...c, [v.key]: p }));
      if (!followRef.current) return;
      setSrc((s) => {
        let changed = false;
        const next = { ...s };
        for (const k of Object.keys(next)) {
          if (k === v.key) {
            next[k] = { ...next[k], path: p };
            continue;
          }
          if (next[k].path !== p) {
            next[k] = { path: p, n: next[k].n + 1 };
            changed = true;
          }
        }
        return changed ? next : s;
      });
      setPath(p);
      setDraft(p);
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [versions, originOf]);

  const toggle = (k: string) => setShown((s) => (s.includes(k) ? (s.length > 1 ? s.filter((x) => x !== k) : s) : [...s, k].slice(-3)));
  const shownVersions = versions.filter((v) => shown.includes(v.key) && !v.planned);

  const markdown = useMemo(() => {
    const lines = ['# FC도착 버전 비교 노트', ''];
    for (const v of ready) {
      const n = notes[v.key];
      if (!n) continue;
      lines.push(`## ${v.name}`, '');
      for (const c of CRITERIA) if (n.scores[c]) lines.push(`- ${c}: ${n.scores[c]}/5`);
      if (n.pros) lines.push('', '**장점**', '', n.pros);
      if (n.cons) lines.push('', '**단점**', '', n.cons);
      lines.push('');
    }
    return lines.join('\n');
  }, [notes, ready]);

  const setNote = (k: string, f: (n: Note) => Note) => setNotes((all) => ({ ...all, [k]: f(all[k] ?? { scores: {}, pros: '', cons: '' }) }));

  return (
    <div className="flex h-dvh flex-col bg-paper">
      <header className="shrink-0 border-b border-ink-2 bg-ink text-on-ink">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
          <h1 className="text-base font-bold">버전 비교실</h1>
          <div role="group" aria-label="띄울 판" className="flex flex-wrap gap-1">
            {versions.map((v) => (
              <button
                key={v.key}
                type="button"
                disabled={v.planned}
                aria-pressed={shown.includes(v.key)}
                onClick={() => toggle(v.key)}
                title={v.note}
                className={cn(
                  'h-8 rounded-sm border px-3 text-sm font-semibold',
                  v.planned
                    ? 'cursor-not-allowed border-white/15 text-on-ink-muted'
                    : shown.includes(v.key)
                      ? 'border-label bg-label text-on-label'
                      : 'border-white/25 text-on-ink hover:bg-white/10',
                )}
              >
                {v.name}
                {v.planned ? ' · 준비 중' : ''}
              </button>
            ))}
          </div>
          <div role="group" aria-label="화면 폭" className="flex gap-1">
            {DEVICES.map((d) => (
              <button
                key={d.key}
                type="button"
                aria-pressed={device === d.key}
                onClick={() => setDevice(d.key)}
                className={cn('h-8 rounded-sm px-2.5 text-sm', device === d.key ? 'bg-white/20 font-semibold' : 'text-on-ink-muted hover:bg-white/10')}
              >
                {d.label} <span className="tnum text-xs opacity-70">{d.width}</span>
              </button>
            ))}
          </div>
          <form
            className="flex min-w-0 flex-1 items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              goAll(draft);
            }}
          >
            <label htmlFor="lab-path" className="sr-only">
              경로
            </label>
            <input
              id="lab-path"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-sm border border-white/25 bg-white/10 px-2 text-sm text-on-ink placeholder:text-on-ink-muted"
              placeholder="/check"
            />
            <Button type="submit" size="sm" variant="primary">
              모두 이동
            </Button>
          </form>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="size-4 accent-[var(--label)]" />
            따라가기
          </label>
          <Button type="button" size="sm" variant="onInk" aria-expanded={notesOpen} onClick={() => setNotesOpen((o) => !o)}>
            <NotebookPen aria-hidden /> 평가 노트
          </Button>
        </div>
        <nav aria-label="바로 가기" className="flex gap-1 overflow-x-auto px-3 pb-2">
          {QUICK.map((q) => (
            <button
              key={q.path}
              type="button"
              onClick={() => goAll(q.path)}
              className={cn('h-7 shrink-0 rounded-full px-3 text-xs', path === q.path ? 'bg-white/20 font-semibold' : 'text-on-ink-muted hover:bg-white/10')}
            >
              {q.label}
            </button>
          ))}
        </nav>
      </header>

      {/* 좁은 화면: 한 판씩 */}
      <div role="tablist" aria-label="보이는 판" className="flex shrink-0 gap-1 border-b border-line bg-surface px-3 py-1.5 md:hidden">
        {shownVersions.map((v) => (
          <button
            key={v.key}
            role="tab"
            type="button"
            aria-selected={mobileKey === v.key}
            onClick={() => setMobileKey(v.key)}
            className={cn('h-8 rounded-sm px-3 text-sm', mobileKey === v.key ? 'bg-ink font-semibold text-on-ink' : 'text-muted')}
          >
            {v.name}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <main id="main" className={cn('grid min-h-0 flex-1 gap-px bg-line', shownVersions.length === 3 ? 'md:grid-cols-3' : shownVersions.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-1')}>
          {shownVersions.map((v) => (
            <Frame
              key={v.key}
              version={v}
              base={v.url}
              path={src[v.key]?.path ?? '/'}
              n={src[v.key]?.n ?? 0}
              width={DEVICES.find((d) => d.key === device)!.width}
              current={current[v.key]}
              hiddenOnMobile={mobileKey !== v.key}
              onReload={() => setSrc((s) => ({ ...s, [v.key]: { path: current[v.key] ?? s[v.key].path, n: s[v.key].n + 1 } }))}
            />
          ))}
        </main>

        {notesOpen ? (
          <aside aria-label="평가 노트" className="fixed inset-0 z-20 flex flex-col overflow-y-auto bg-surface md:static md:w-[360px] md:shrink-0 md:border-l md:border-line">
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <h2 className="text-sm font-bold">평가 노트</h2>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(markdown).then(
                      () => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      },
                      () => {},
                    );
                  }}
                >
                  <ClipboardCopy aria-hidden /> {copied ? '복사했습니다' : '글로 복사'}
                </Button>
                <Button type="button" size="iconSm" variant="ghost" aria-label="닫기" onClick={() => setNotesOpen(false)}>
                  <X aria-hidden />
                </Button>
              </div>
            </div>
            <p className="px-4 pt-3 text-xs text-muted">이 기기(브라우저)에만 저장됩니다. 「글로 복사」로 옮겨 두세요.</p>
            {ready.map((v) => {
              const n = notes[v.key] ?? { scores: {}, pros: '', cons: '' };
              return (
                <section key={v.key} className="border-b border-line-2 px-4 py-3">
                  <h3 className="text-sm font-bold">{v.name}</h3>
                  <dl className="mt-2 space-y-1.5">
                    {CRITERIA.map((c) => (
                      <div key={c} className="flex items-center justify-between gap-2">
                        <dt className="text-sm">{c}</dt>
                        <dd role="radiogroup" aria-label={`${v.name} ${c}`} className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <button
                              key={s}
                              type="button"
                              role="radio"
                              aria-checked={n.scores[c] === s}
                              aria-label={`${s}점`}
                              onClick={() => setNote(v.key, (o) => ({ ...o, scores: { ...o.scores, [c]: o.scores[c] === s ? undefined : s } }))}
                              className={cn('size-7 rounded-sm text-xs tnum', (n.scores[c] ?? 0) >= s ? 'bg-ink text-on-ink' : 'bg-surface-2 text-muted')}
                            >
                              {s}
                            </button>
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <label className="mt-3 block text-xs font-semibold text-muted" htmlFor={`pros-${v.key}`}>
                    장점
                  </label>
                  <Textarea id={`pros-${v.key}`} rows={2} value={n.pros} onChange={(e) => setNote(v.key, (o) => ({ ...o, pros: e.target.value }))} />
                  <label className="mt-2 block text-xs font-semibold text-muted" htmlFor={`cons-${v.key}`}>
                    단점
                  </label>
                  <Textarea id={`cons-${v.key}`} rows={2} value={n.cons} onChange={(e) => setNote(v.key, (o) => ({ ...o, cons: e.target.value }))} />
                </section>
              );
            })}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function Frame({
  version,
  base,
  path,
  n,
  width,
  current,
  hiddenOnMobile,
  onReload,
}: {
  version: LabVersion;
  base: string;
  path: string;
  n: number;
  width: number;
  current?: string;
  hiddenOnMobile: boolean;
  onReload: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = size.w ? Math.min(1, size.w / width) : 1;
  const url = `${base}${path}`;
  const shownPath = current ?? path;
  return (
    <section aria-label={`${version.name} 화면`} className={cn('min-h-0 flex-col bg-surface', hiddenOnMobile ? 'hidden md:flex' : 'flex')}>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="rounded-sm bg-ink px-2 py-0.5 text-xs font-bold text-on-ink">{version.name}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted" title={version.note}>
          <Link2 aria-hidden className="mr-1 inline size-3" />
          {shownPath}
        </span>
        <span className="hidden text-2xs text-muted tnum lg:inline">{Math.round(scale * 100)}%</span>
        <Button type="button" size="iconSm" variant="ghost" aria-label={`${version.name} 새로고침`} onClick={onReload}>
          <RotateCw aria-hidden />
        </Button>
        <a
          href={`${base}${shownPath}`}
          target="_blank"
          rel="noreferrer"
          aria-label={`${version.name} 새 탭에서 열기`}
          className="inline-flex size-8 items-center justify-center rounded-sm text-text hover:bg-surface-2"
        >
          <ExternalLink aria-hidden className="size-4" />
        </a>
      </div>
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden bg-paper">
        {size.w ? (
          <iframe
            key={`${version.key}-${n}`}
            src={url}
            title={`${version.name} — ${shownPath}`}
            style={{ width, height: size.h / scale, transform: `scale(${scale})`, transformOrigin: '0 0' }}
            className="absolute left-0 top-0 border-0 bg-surface"
          />
        ) : null}
      </div>
    </section>
  );
}
