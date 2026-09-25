import { asUser } from '@/lib/db';
import { env } from '@/lib/env';
import { requireViewer } from '@/lib/server/viewer';
import { Chip, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { DutyEditor, SettingEditor } from './editor';
import { dateTimeKo } from '@/lib/format';
import Link from 'next/link';
import { ASSURE_KINDS, ASSURE_SETTING_LABEL, ASSURE_SWITCH_KEY, readAssureConfig } from '@/lib/assure-settings';
import { AssureSwitch } from './assure-switches';

export const metadata = { title: '설정' };

const LABEL: Record<string, string> = {
  fx: '환율', commission_rate_bp: '성사 수수료 요율(bp)', fc_ready_rule: 'FC 입고 준비 인증 기준', score_caps: '추천 점수 상한(편차·회송률)',
  quote_params: '청구 수량 환산', vat_rate_bp: '부가세율(bp)', insurance_bp: '보험료 산입(bp)', sale_fee_bp: '판매 수수료 기본값(bp)',
  fulfillment_per_unit: '개당 풀필먼트 기본값(원)', reference_lines: '비교 참고 요금(빈 구간 채움)', expiring_days: '「곧 만료」 기준(일)',
  ...ASSURE_SETTING_LABEL,
};

export default async function Settings() {
  const v = await requireViewer('admin');
  const d = await asUser(v, async (q) => ({
    current: await q.query<{ key: string; value: unknown; note: string | null; created_at: string }>(`select key, value, note, created_at from fcd.v_current_settings order by key`),
    versions: await q.query<{ key: string; n: number }>(`select key, count(*)::int n from fcd.settings group by key`),
    duty: await q.query<{ category: string; name_ko: string; rate_bp: number; created_at: string }>(`select category, name_ko, rate_bp, created_at from fcd.v_current_duty_rates order by category`),
  }));
  const assureOn = readAssureConfig(new Map(d.current.map((x) => [x.key, x.value]))).on;
  return (
    <>
      <PageTitle title="설정" sub="요율·기준값·환율·관세율은 코드가 아니라 여기서 읽습니다. 고치지 않고 새 판으로 쌓입니다." />
      <Panel className="mb-6">
        <PanelHead title="스위치" sub="환경변수 — 배포 설정에서 바꿉니다" />
        <ul className="grid gap-px bg-line-2 sm:grid-cols-3">
          {[
            ['DEMO_MODE', env.demoMode, '예시 데이터 보이기'],
            ['OUTBOUND_ENABLED', env.outboundEnabled, '메일·문자·카톡·외부 API 쓰기'],
            ['Supabase Auth', env.usingSupabaseAuth, '로그인 방식(꺼짐 = 로컬 해시)'],
          ].map(([k, on, note]) => (
            <li key={k as string} className="flex items-center justify-between bg-surface px-4 py-3 text-sm">
              <span><b className="font-mono text-xs">{k as string}</b><span className="block text-xs text-muted">{note as string}</span></span>
              <Chip tone={on ? 'ok' : 'neutral'}>{on ? '켜짐' : '꺼짐'}</Chip>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel className="mb-6" aria-labelledby="assure-switches">
        <PanelHead
          id="assure-switches"
          title="v2 시범 스위치 — 확정가·보장"
          sub="기본 꺼짐. 켜도 실제 계약·결제는 없고 시범 기록까지만 합니다. 켜고 끄는 것도 새 판으로 쌓입니다."
          action={<Link href="/admin/assure" className="text-xs font-semibold underline underline-offset-4">관심 등록 목록</Link>}
        />
        <ul className="grid gap-px bg-line-2 md:grid-cols-2">
          {ASSURE_KINDS.map((k) => (
            <AssureSwitch key={k} kind={k} on={assureOn[k]} versions={d.versions.find((x) => x.key === ASSURE_SWITCH_KEY[k])?.n ?? 0} />
          ))}
        </ul>
      </Panel>
      <Panel className="mb-6">
        <PanelHead title="기준값" />
        <ul>
          {d.current.map((s) => (
            <li key={s.key} className="grid gap-2 border-b border-line-2 px-4 py-3 last:border-0 md:grid-cols-[240px_1fr_auto] md:items-start">
              <div>
                <p className="text-sm font-bold">{LABEL[s.key] ?? s.key}</p>
                <p className="font-mono text-2xs text-muted">{s.key} · 판 {d.versions.find((x) => x.key === s.key)?.n ?? 1}개</p>
              </div>
              <div className="min-w-0">
                <pre className="max-h-24 overflow-auto rounded-xs bg-surface-2 p-2 text-2xs leading-4">{JSON.stringify(s.value)}</pre>
                <p className="mt-1 text-2xs text-muted">{dateTimeKo(s.created_at)} · {s.note}</p>
              </div>
              <SettingEditor k={s.key} value={s.value} />
            </li>
          ))}
        </ul>
      </Panel>
      <Panel>
        <PanelHead title="관세율 표(참고 추정용)" sub="기본세율 기준. FTA 협정세율은 원산지 증명이 있을 때 수입신고에서 따로 적용됩니다." />
        <ul>
          {d.duty.map((x) => (
            <li key={x.category} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 px-4 py-2.5 last:border-0">
              <span className="text-sm"><b>{x.name_ko}</b> <span className="font-mono text-2xs text-muted">{x.category}</span> · <span className="tnum">{(x.rate_bp / 100).toFixed(2)}%</span></span>
              <DutyEditor category={x.category} name={x.name_ko} rateBp={x.rate_bp} />
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
