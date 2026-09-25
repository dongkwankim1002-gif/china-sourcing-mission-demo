'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Bell, CheckCheck, Clock, FileText, Package, Receipt, Ship } from 'lucide-react';
import { markAllRead, setNotificationsRead, setPref } from '@/app/actions/common';
import { Button, EmptyState } from '@/components/ui/core';
import { Switch } from '@/components/ui/radix';
import { cn } from '@/lib/cn';
import { ago } from '@/lib/format';
import type { NotificationRow } from '@/lib/server/shipper';

const KINDS = ['bid_arrived', 'deadline_soon', 'exception', 'invoice_arrived', 'booking', 'status', 'system'] as const;
const KO: Record<string, string> = { bid_arrived: '응찰 도착', deadline_soon: '마감 임박', exception: '예외 발생', invoice_arrived: '청구서 도착', booking: '예약', status: '상태 갱신', system: '안내' };
const ZH: Record<string, string> = { bid_arrived: '收到报价', deadline_soon: '即将截止', exception: '异常', invoice_arrived: '账单', booking: '订舱', status: '状态更新', system: '通知' };
const ICON: Record<string, typeof Bell> = { bid_arrived: FileText, deadline_soon: Clock, exception: AlertTriangle, invoice_arrived: Receipt, booking: Package, status: Ship, system: Bell };

export function NotificationCenter({
  items,
  prefs,
  outbound,
  zh,
}: {
  items: NotificationRow[];
  prefs: { kind: string; in_app: boolean; email: boolean; sms: boolean; kakao: boolean }[];
  outbound: boolean;
  zh?: boolean;
}) {
  const router = useRouter();
  const L = zh ? ZH : KO;
  const [kind, setKind] = React.useState<string>('');
  const [unread, setUnread] = React.useState(false);
  const [read, setRead] = React.useState<Record<string, boolean>>({});
  const [pp, setPp] = React.useState(() => Object.fromEntries(KINDS.map((k) => [k, prefs.find((p) => p.kind === k) ?? { kind: k, in_app: true, email: false, sms: false, kakao: false }])));
  const isRead = (n: NotificationRow) => read[n.id] ?? !!n.read_at;
  const list = items.filter((n) => (!kind || n.kind === kind) && (!unread || !isRead(n)));
  const unreadCount = items.filter((n) => !isRead(n)).length;

  const toggle = async (n: NotificationRow, to: boolean) => {
    setRead((r) => ({ ...r, [n.id]: to }));
    await setNotificationsRead([n.id], to);
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <section aria-label={zh ? '通知' : '알림'} className="min-w-0 rounded-md border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line-2 px-4 py-3">
          <div className="no-scrollbar flex gap-1 overflow-x-auto">
            {['', ...KINDS].map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cn('h-8 shrink-0 rounded-xs border px-2.5 text-xs font-semibold', kind === k ? 'border-ink bg-ink text-on-ink' : 'border-line hover:border-muted/60')}>
                {k ? L[k] : zh ? '全部' : '전체'}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <label className="flex items-center gap-2 text-xs"><Switch checked={unread} onCheckedChange={setUnread} /> {zh ? '只看未读' : '안 읽은 것만'}</label>
          <Button
            size="sm"
            variant="secondary"
            disabled={unreadCount === 0}
            onClick={async () => {
              const before = Object.fromEntries(items.filter((n) => !isRead(n)).map((n) => [n.id, false]));
              setRead((r) => ({ ...r, ...Object.fromEntries(Object.keys(before).map((k) => [k, true])) }));
              const r = await markAllRead();
              toast(zh ? `已标记 ${r.ids.length} 条为已读` : `${r.ids.length}건을 읽음으로 바꿨습니다`, {
                action: {
                  label: zh ? '撤销' : '되돌리기',
                  onClick: async () => {
                    setRead((x) => ({ ...x, ...before }));
                    await setNotificationsRead(r.ids, false);
                    router.refresh();
                  },
                },
              });
              router.refresh();
            }}
          >
            <CheckCheck aria-hidden /> {zh ? '全部已读' : '모두 읽음'} {unreadCount ? `(${unreadCount})` : ''}
          </Button>
        </div>
        {list.length ? (
          <ul>
            {list.map((n) => {
              const I = ICON[n.kind] ?? Bell;
              const r = isRead(n);
              return (
                <li key={n.id} className={cn('flex items-start gap-3 border-b border-line-2 px-4 py-3 last:border-0', !r && 'bg-label/[0.07]')}>
                  <I className={cn('mt-0.5 size-4 shrink-0', n.kind === 'exception' ? 'text-stamp' : n.kind === 'deadline_soon' ? 'text-caution' : 'text-muted')} aria-hidden />
                  <div className="min-w-0 flex-1">
                    {n.link ? (
                      <Link href={n.link} onClick={() => !r && void toggle(n, true)} className="block text-sm font-semibold hover:underline">
                        {!r ? <span className="mr-1.5 inline-block size-2 rounded-full bg-label align-middle" aria-label={zh ? '未读' : '안 읽음'} /> : null}
                        {n.title}
                      </Link>
                    ) : (
                      <p className="text-sm font-semibold">{n.title}</p>
                    )}
                    {n.body ? <p className="text-xs text-muted">{n.body}</p> : null}
                    <p className="text-2xs text-muted">{L[n.kind]} · {ago(n.created_at)}</p>
                  </div>
                  <button type="button" onClick={() => void toggle(n, !r)} className="shrink-0 rounded-xs px-2 py-1 text-2xs font-semibold text-muted hover:bg-surface-2 hover:text-text">
                    {r ? (zh ? '标为未读' : '안 읽음으로') : zh ? '标为已读' : '읽음'}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title={zh ? '没有通知' : '알림이 없습니다'} body={zh ? '收到报价、截止、异常、账单时会在这里显示。' : '응찰 도착·마감 임박·예외 발생·청구서 도착이 여기에 쌓입니다.'} />
        )}
      </section>
      <section aria-labelledby="prefs" className="self-start rounded-md border border-line bg-surface">
        <h2 id="prefs" className="border-b border-line-2 px-4 py-3 text-sm font-bold">{zh ? '通知设置' : '받을 알림'}</h2>
        {!outbound ? (
          <p className="m-4 rounded-sm bg-surface-2 p-3 text-xs text-muted">
            {zh ? '邮件·短信·KakaoTalk 需要服务发送开关打开后才会发送（目前：关闭）。站内通知照常。' : '메일·문자·카톡은 서비스 쪽 발송 스위치가 켜진 뒤부터 나갑니다(지금: 꺼짐). 화면 안 알림은 그대로 옵니다.'}
          </p>
        ) : null}
        <table className="w-full text-xs">
          <thead className="text-muted">
            <tr>
              <th scope="col" className="px-4 py-2 text-left font-semibold">{zh ? '类型' : '종류'}</th>
              <th scope="col" className="px-1 py-2 font-semibold">{zh ? '站内' : '화면'}</th>
              <th scope="col" className="px-1 py-2 font-semibold">{zh ? '邮件' : '메일'}</th>
              <th scope="col" className="px-1 py-2 font-semibold">{zh ? '短信' : '문자'}</th>
              <th scope="col" className="px-1 py-2 font-semibold">{zh ? 'Kakao' : '카톡'}</th>
            </tr>
          </thead>
          <tbody>
            {KINDS.map((k) => (
              <tr key={k} className="border-t border-line-2">
                <th scope="row" className="px-4 py-2 text-left font-semibold">{L[k]}</th>
                {(['in_app', 'email', 'sms', 'kakao'] as const).map((ch) => (
                  <td key={ch} className="px-1 py-2 text-center">
                    <Switch
                      aria-label={`${L[k]} ${ch}`}
                      checked={pp[k][ch]}
                      onCheckedChange={async (val) => {
                        setPp((s) => ({ ...s, [k]: { ...s[k], [ch]: val } }));
                        await setPref({ kind: k, channel: ch, value: val });
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
