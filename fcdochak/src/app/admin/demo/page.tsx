import { asUser } from '@/lib/db';
import { env } from '@/lib/env';
import { requireViewer } from '@/lib/server/viewer';
import { demoCounts } from '@/lib/server/demo-status';
import { Chip, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { num } from '@/lib/format';

export const metadata = { title: '데모 관리' };

export default async function DemoAdmin() {
  const v = await requireViewer('admin');
  const counts = await asUser(v, (q) => demoCounts(q));
  const total = counts.reduce((t, c) => t + c.demo, 0);
  return (
    <>
      <PageTitle title="데모 관리" sub="예시 데이터는 is_demo 조직 아래에만 있고, 조직을 지우면 그 아래가 전부 함께 사라집니다(CASCADE)." actions={<Chip tone={env.demoMode ? 'label' : 'neutral'}>DEMO_MODE {env.demoMode ? '켜짐' : '꺼짐'}</Chip>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Panel>
          <PanelHead title={`표별 예시 건수 — 모두 ${num(total)}건`} sub="npm run demo:status 와 같은 숫자" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm tnum">
              <thead className="bg-surface-2 text-xs text-muted"><tr><th scope="col" className="px-4 py-2 text-left font-semibold">표</th><th scope="col" className="px-4 py-2 text-right font-semibold">예시</th><th scope="col" className="px-4 py-2 text-right font-semibold">실제</th></tr></thead>
              <tbody>
                {counts.map((c) => (
                  <tr key={c.table} className="border-t border-line-2"><th scope="row" className="px-4 py-2 text-left font-mono text-xs font-normal">{c.table}</th><td className="px-4 py-2 text-right font-semibold">{num(c.demo)}</td><td className="px-4 py-2 text-right text-muted">{num(c.real)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <div className="grid content-start gap-6">
          <Panel>
            <PanelHead title="1. 숨기기" />
            <div className="grid gap-2 p-4 text-sm">
              <p>배포 환경변수 <code className="rounded-xs bg-surface-2 px-1 font-mono text-xs">DEMO_MODE=off</code> 로 바꾸고 다시 배포합니다.</p>
              <p className="text-muted">공개·화주·물류사 화면에서 예시가 사라집니다(RLS 와 조회 조건 양쪽). 운영 화면은 계속 「예시」 표시와 함께 보입니다. 데모 계정으로는 로그인할 수 없게 됩니다.</p>
            </div>
          </Panel>
          <Panel>
            <PanelHead title="2. 걷어내기" />
            <div className="grid gap-2 p-4 text-sm">
              <p><code className="rounded-xs bg-surface-2 px-1 font-mono text-xs">npm run demo:purge</code> — 지울 건수를 보여 주고 <code className="font-mono text-xs">supabase/purge-demo.sql</code> 을 만듭니다.</p>
              <p className="text-muted">이 화면과 명령은 자료를 지우지 않습니다. 파일을 읽어 본 뒤 사람이 Supabase SQL 편집기에서 직접 실행합니다. 순서는 docs/DEMO.md.</p>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
