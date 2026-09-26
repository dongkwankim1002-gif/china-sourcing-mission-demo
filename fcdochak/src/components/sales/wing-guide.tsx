/**
 * 쿠팡 API 제공 단계 안내(v2 3차 sales) — 단계마다 「누를 것」 문장 + 메뉴 길 그림(스크린샷 대신). 서버에서 그린다.
 * 쿠팡 사실은 V2.md 3차 첫머리를 따른다(메뉴 이름·IP 조건은 쿠팡 원문 확인 필요).
 */
import { Check, ChevronRight, CircleDashed } from 'lucide-react';
import { Chip, Panel, PanelHead } from '@/components/ui/core';
import { cn } from '@/lib/cn';

type StepState = 'done' | 'todo' | 'info';

function Path({ parts }: { parts: string[] }) {
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1 text-2xs">
      <span className="sr-only">누를 곳:</span>
      {parts.map((p, i) => (
        <span key={p} className="inline-flex items-center gap-1">
          {i > 0 ? <ChevronRight className="size-3 text-muted" aria-hidden /> : null}
          <span className={cn('rounded-xs border px-1.5 py-0.5 font-semibold', i === parts.length - 1 ? 'border-label/60 bg-label/20 text-text' : 'border-line bg-surface-2 text-muted')}>{p}</span>
        </span>
      ))}
    </span>
  );
}

function Fields({ items }: { items: string[] }) {
  return (
    <span className="mt-1.5 grid max-w-sm gap-1 rounded-sm border border-dashed border-line p-2 text-2xs" aria-hidden>
      {items.map((x) => (
        <span key={x} className="flex items-center justify-between gap-2">
          <span className="font-semibold text-muted">{x}</span>
          <span className="h-3 w-28 rounded-xs bg-surface-2" />
        </span>
      ))}
    </span>
  );
}

export function WingSetupGuide({ egressIps, consented, hasKey, verified, validDays, warnDays }: { egressIps: string[]; consented: boolean; hasKey: boolean; verified: boolean; validDays: number; warnDays: number }) {
  const toSetup = (
    <a href="#wing-key-setup" className="mt-1 inline-block text-2xs font-semibold underline underline-offset-4">
      그 칸으로 가기
    </a>
  );
  const steps: { title: string; body: React.ReactNode; extra?: React.ReactNode; state: StepState }[] = [
    { title: 'WING 로그인', body: '사업자 인증을 마친 판매자 계정으로 wing.coupang.com 에 들어갑니다. 인증 전 계정은 키를 받을 수 없습니다.', state: 'info' },
    {
      title: 'OPEN API 키 발급',
      body: '판매자정보 아래 추가판매정보에서 OPEN API 키 발급을 누릅니다(계정에 따라 메뉴 위치가 다를 수 있음). 키 사용 목적은 「OPEN API」를 고르고 약관에 동의합니다. 연동 방식은 「자체개발(직접입력)」을 고르면 업체명·URL·IP 칸이 나옵니다(다음 단계). 업체코드 · Access Key · Secret Key 세 값이 나오고, 권한이 열리기까지 24시간 넘게 걸릴 수 있습니다. 메뉴 이름은 쿠팡 원문 확인 필요.',
      extra: <Path parts={['WING', '판매자정보', '추가판매정보', 'OPEN API 키 발급']} />,
      state: 'info',
    },
    {
      title: '(선택) 로켓그로스 상품 API 동의',
      body: '로켓그로스 상품을 읽으려면 WING 에서 로켓그로스 상품 API 동의를 따로 해야 합니다. 동의 위치·읽기에도 필요한지는 쿠팡 원문 확인 필요.',
      state: 'info',
    },
    {
      title: '연동 IP 칸에 FC도착 IP 적기',
      body: '다른 회사 프로그램에 키를 맡길 때는 그 회사 서버 IP 를 키 설정에 넣습니다. 키 발급 때 연동 방식 「자체개발(직접입력)」을 고르면 IP 칸이 나옵니다(업체명: FC도착 · URL: 서비스 주소). 아래 값을 그대로 적어 주세요. IP 가 꼭 필요한지는 쿠팡 원문 확인 필요.',
      extra: egressIps.length ? (
        <span className="mt-1.5 flex flex-wrap gap-1" data-testid="wing-egress-ips">
          {egressIps.map((ip) => (
            <code key={ip} className="rounded-xs border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-xs tnum">
              {ip}
            </code>
          ))}
        </span>
      ) : (
        <span className="mt-1.5 block" data-testid="wing-egress-ips">
          <Chip tone="caution">준비 중 — 운영이 정하면 표시</Chip>
        </span>
      ),
      state: egressIps.length ? 'info' : 'todo',
    },
    { title: '읽는 것 · 하지 않는 것 동의', body: '「읽는 것 · 하지 않는 것」 칸을 읽고 동의합니다(관리자). FC도착은 읽기만 하고 상품·가격·주문을 바꾸지 않습니다.', extra: toSetup, state: consented ? 'done' : 'todo' },
    { title: '세 값 넣기', body: '업체코드 · Access Key · Secret Key 를 복사해 「WING 키」 칸에 넣고 발급일을 적습니다. 암호화해 보관하고 끝 4자리만 보입니다.', extra: (
        <>
          <Fields items={['업체코드', 'Access Key', 'Secret Key', '발급일']} />
          {toSetup}
        </>
      ),
      state: hasKey ? 'done' : 'todo',
    },
    { title: '연결 시험', body: '「연결 시험」을 누릅니다. 연동이 꺼져 있으면 「시험 모드」로 저장·암호화·동의만 확인하고 쿠팡은 부르지 않습니다.', extra: toSetup, state: verified ? 'done' : 'todo' },
    {
      title: `${validDays}일마다 다시 · 연결 끊기`,
      body: `키는 ${validDays}일이 지나면 만료됩니다. 만료 ${warnDays}일 전부터 이 화면과 알림함에 알립니다(메일·문자는 보내지 않음). 그만 쓰려면 「키 폐기」로 연결을 끊고 WING 에서도 키를 지우세요.`,
      state: 'info',
    },
  ];
  return (
    <Panel aria-labelledby="wg-h">
      <PanelHead id="wg-h" title="쿠팡 API 제공하는 법" sub="판매자 본인 키로 읽기만 연결합니다 — 여덟 단계" />
      <ol className="grid gap-3 p-4 md:grid-cols-2" data-testid="wing-steps">
        {steps.map((s, n) => (
          <li key={s.title} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2" data-state={s.state}>
            <span
              className={cn(
                'grid size-7 place-items-center rounded-xs border text-xs font-bold tnum',
                s.state === 'done' ? 'border-ok/40 bg-ok-bg text-ok' : 'border-line bg-surface-2 text-text',
              )}
            >
              <span className="sr-only">{n + 1}단계</span>
              {s.state === 'done' ? <Check className="size-4" aria-hidden /> : <span aria-hidden>{n + 1}</span>}
            </span>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
                {s.title}
                {s.state === 'todo' ? <CircleDashed className="size-3.5 text-muted" aria-hidden /> : null}
                {s.state === 'done' ? <span className="sr-only">(완료)</span> : s.state === 'todo' ? <span className="sr-only">(아직)</span> : null}
              </p>
              <p className="text-xs text-muted">{s.body}</p>
              {s.extra}
            </div>
          </li>
        ))}
      </ol>
      <div className="grid gap-1 border-t border-line-2 px-4 py-3 text-xs">
        <p className="font-semibold">쿠팡 API 로 안 되는 것 — 파일로 올려 주세요</p>
        <p className="text-muted">
          입고 생성·바코드 라벨 API 는 찾지 못했습니다(WING 화면에서 합니다). 입고 목록은 WING 에서 엑셀로 내려받아 아래 「WING 파일 올리기」로, 바코드 라벨은 짝 맞은 입고 요청 줄의 「바코드 PDF 올리기」로 올리면 선적 서류함에 들어갑니다.
        </p>
        <p className="text-2xs text-muted">근거: 쿠팡 Open API 문서·연동 솔루션사 안내(검색 요약, 2026-09 조사) — docs/wing-plan.md · docs/sales-plan.md. 메뉴 이름·IP 조건은 쿠팡 원문 확인 필요.</p>
      </div>
    </Panel>
  );
}
