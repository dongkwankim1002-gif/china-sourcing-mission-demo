import { Plus, Truck } from 'lucide-react';
import { Button, Chip, EmptyState, ErrorState, Field, Input, Kbd, NativeSelect, PageTitle, Panel, PanelHead, Skeleton, Textarea, type Tone } from '@/components/ui/core';
import { NineBar, NineBarLegend, type BarSegment } from '@/components/nine-bar';
import { AdChip, CertaintyChip, DemoChip, ExceptionChip, FcReadyChip, RelatedChip, RequestStatusChip, StageChip, Won } from '@/components/badges';
import { StatTile } from '@/components/stat';
import { DailyBars, DailyLine, HeatGrid } from '@/components/charts';
import { LetterMark } from '@/components/brand-mark';
import { SEGMENTS } from '@/lib/money/segments';

export const metadata = { title: '스타일가이드', robots: { index: false } };

const COLORS: { name: string; v: string; role: string }[] = [
  { name: 'ink', v: '--ink', role: '머리띠·짙은 면 — 남색' },
  { name: 'label', v: '--label', role: '주 행동 — 라벨 노랑' },
  { name: 'ok', v: '--ok', role: '정상·완료 — 청록' },
  { name: 'stamp', v: '--stamp', role: '예외·오류 — 빨간 도장' },
  { name: 'caution', v: '--caution', role: '주의·추가비용 — 호박' },
  { name: 'paper', v: '--paper', role: '바탕 — 찬 회색 종이' },
  { name: 'surface', v: '--surface', role: '면' },
  { name: 'surface-2', v: '--surface-2', role: '두 번째 면·표 머리' },
  { name: 'line', v: '--line', role: '테두리' },
  { name: 'text', v: '--text', role: '본문' },
  { name: 'muted', v: '--muted', role: '보조 글자' },
];

const TYPE: [string, string, string][] = [
  ['text-2xs', '11/16', '칩 보조'],
  ['text-xs', '12/18', '캡션·표 머리'],
  ['text-sm', '13/20', '표 본문·도움말'],
  ['text-base', '14/22', '본문'],
  ['text-md', '16/24', '카드 제목'],
  ['text-lg', '18/26', '섹션 제목'],
  ['text-xl', '22/30', '쪽 제목'],
];

const SAMPLE: BarSegment[] = [
  { segment: 'pickup', amount: 48000, certainty: 'confirmed' },
  { segment: 'cn_warehouse', amount: 36000, certainty: 'confirmed' },
  { segment: 'export_customs', amount: 52000, certainty: 'confirmed' },
  { segment: 'freight', amount: 412000, certainty: 'estimated' },
  { segment: 'port', amount: 88000, certainty: 'extra_possible' },
  { segment: 'broker', amount: 33000, certainty: 'confirmed' },
  { segment: 'kr_warehouse', amount: 61000, certainty: 'confirmed', filled: true },
  { segment: 'fc_delivery', amount: 145000, certainty: 'confirmed' },
  { segment: 'return_reserve', amount: null, certainty: null },
];
const SAMPLE_B: BarSegment[] = SAMPLE.map((s) => ({ ...s, amount: s.amount == null ? 22000 : Math.round(s.amount * 0.8) }));

const days = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
  const wd = new Date(d).getUTCDay();
  return { d, v: (wd === 0 || wd === 6 ? 3 : 9) + ((i * 7) % 5) };
});

function Section({ id, title, sub, children }: { id: string; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <Panel aria-labelledby={id}>
      <PanelHead id={id} title={title} sub={sub} />
      <div className="grid gap-4 p-4">{children}</div>
    </Panel>
  );
}

export default function Styleguide() {
  const tones: Tone[] = ['neutral', 'info', 'ok', 'stamp', 'caution', 'label', 'ink'];
  return (
    <>
      <PageTitle eyebrow="운영자 전용" title="스타일가이드" sub="docs/DESIGN.md 의 토큰과 부품을 실제 코드로 보여 줍니다. 화면을 새로 만들 때 여기서 고릅니다." />
      <div className="grid gap-6">
        <Section id="sg-color" title="색 — 역할로 부른다" sub="밝은·어두운 모드는 각자 따로 고른 값(자동 반전 아님). 오른쪽 위 계정 메뉴에서 바꿔 보세요.">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {COLORS.map((c) => (
              <li key={c.name} className="flex items-center gap-3 rounded-sm border border-line-2 p-2">
                <span className="size-10 shrink-0 rounded-xs border border-line" style={{ background: `var(${c.v})` }} aria-hidden />
                <span className="min-w-0">
                  <span className="block font-mono text-xs font-semibold">{c.name}</span>
                  <span className="block text-xs text-muted">{c.role}</span>
                </span>
              </li>
            ))}
          </ul>
          <div>
            <p className="mb-2 text-sm font-semibold">9구간 순서 단계(남색 한 색상 — 길의 순서대로 명도가 바뀜)</p>
            <div className="flex h-8 overflow-hidden rounded-xs">
              {SEGMENTS.map((s, i) => (
                <span key={s} className="flex-1" style={{ background: `var(--seg-${i + 1})` }} title={s} />
              ))}
            </div>
          </div>
        </Section>

        <Section id="sg-type" title="글꼴과 크기" sub="본문 Pretendard(숫자 폭 고정) · 큰 숫자·브랜드·공개 제목만 Black Han Sans">
          <div className="grid gap-2">
            {TYPE.map(([cls, size, role]) => (
              <div key={cls} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line-2 pb-2">
                <span className="w-24 font-mono text-xs text-muted">{cls}</span>
                <span className="w-14 font-mono text-xs text-muted">{size}</span>
                <span className={cls}>의우 → 인천 LCL 1,284,000원 · {role}</span>
              </div>
            ))}
            <div className="flex flex-wrap items-baseline gap-4">
              <span className="w-24 font-mono text-xs text-muted">display</span>
              <span className="display text-[40px] leading-none tnum">1,284,000원</span>
            </div>
          </div>
        </Section>

        <Section id="sg-actions" title="버튼 — 행동 이름은 늘 같은 말" sub="주 행동은 한 화면에 하나(라벨 노랑)">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary"><Plus aria-hidden />견적 요청</Button>
            <Button>취소</Button>
            <Button variant="ghost">더 보기</Button>
            <Button variant="ink">예약 확정</Button>
            <Button variant="danger">요청 취소</Button>
            <Button variant="link">자세히</Button>
            <Button variant="primary" disabled>저장 중…</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm">작게</Button>
            <Button size="md">보통</Button>
            <Button size="lg" variant="primary">크게</Button>
            <Button size="icon" aria-label="선적"><Truck aria-hidden /></Button>
          </div>
          <p className="text-sm text-muted">단축키 표시: <Kbd>⌘</Kbd> <Kbd>K</Kbd> 명령 · <Kbd>/</Kbd> 검색</p>
        </Section>

        <Section id="sg-inputs" title="입력" sub="단위는 칸 안에, 천 단위 쉼표, 붙여 넣기에 강함. 오류는 칸 아래에 무엇·어떻게.">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="상품 이름" htmlFor="sg-name" hint="화주에게만 보입니다" required>
              <Input id="sg-name" defaultValue="실리콘 주방 집게" />
            </Field>
            <Field label="출발 거점" htmlFor="sg-hub">
              <NativeSelect id="sg-hub" defaultValue="YIW">
                <option value="YIW">이우</option>
                <option value="QDG">칭다오</option>
              </NativeSelect>
            </Field>
            <Field label="무게" htmlFor="sg-kg" error="0보다 큰 숫자를 넣어 주세요 — 예: 320">
              <Input id="sg-kg" defaultValue="-3" aria-invalid />
            </Field>
            <Field label="메모" htmlFor="sg-note" className="md:col-span-3">
              <Textarea id="sg-note" placeholder="물류사에 전할 말" />
            </Field>
          </div>
        </Section>

        <Section id="sg-chips" title="칩 — 색만으로 뜻을 싣지 않는다" sub="모든 칩에 글자가 있다">
          <div className="flex flex-wrap gap-2">
            {tones.map((t) => (
              <Chip key={t} tone={t}>{t}</Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {['waiting', 'bidding', 'closing_soon', 'comparable', 'selected', 'expired', 'cancelled'].map((s) => (
              <RequestStatusChip key={s} status={s} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <FcReadyChip /> <AdChip /> <RelatedChip note="대표 가족 회사" /> <DemoChip />
            <CertaintyChip c="confirmed" /> <CertaintyChip c="estimated" /> <CertaintyChip c="extra_possible" />
            <ExceptionChip kind="customs_hold" /> <ExceptionChip kind="billing_deviation" resolved />
            <StageChip stage={4} />
          </div>
        </Section>

        <Section id="sg-bar" title="9구간 막대 — 하나뿐인 것" sub="폭 = 금액 비중 · 색 = 순서 · 무늬 = 확정도 · 빈칸 = 맡지 않는 구간. 여러 막대는 같은 척도.">
          <NineBar segments={SAMPLE} size="hero" ticks />
          <div className="grid gap-2">
            <NineBar segments={SAMPLE} scaleMax={875000} />
            <NineBar segments={SAMPLE_B} scaleMax={875000} />
            <NineBar segments={SAMPLE} size="thin" scaleMax={875000} />
          </div>
          <NineBarLegend />
        </Section>

        <Section id="sg-data" title="숫자와 차트" sub="한 계열 · 한 축 · 1px 격자 · 막대 폭 24px 이하 · 위에 올리면 값">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="이번 달 물류비" value={18_420_000} prev={16_900_000} format="won" good="down" trend={days.map((d) => d.v)} />
            <StatTile label="청구 편차" value={0.021} prev={0.034} format="pct" good="down" />
            <StatTile label="진행 선적" value={12} prev={12} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <DailyBars data={days} name="견적 요청" />
            <DailyLine data={days.map((d) => ({ d: d.d, v: d.v * 120000 }))} f="won" name="거래액" area />
          </div>
          <HeatGrid
            caption="구간 × 주 요청 수"
            rows={['이우→인천', '칭다오→평택', '광저우→인천']}
            cols={['12주 전', '8주 전', '4주 전', '이번 주']}
            values={[[4, 6, 9, 12], [2, 3, 3, 5], [0, 1, 4, 6]]}
          />
          <p className="text-sm">
            금액: <Won v={128_400_000} /> · 줄임 <Won v={128_400_000} short /> · 없음 <Won v={null} />
          </p>
        </Section>

        <Section id="sg-states" title="상태 — 빈 칸·불러오는 중·오류" sub="빈 칸은 다음 행동을 준다. 오류는 무엇이·왜·어떻게.">
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel><EmptyState title="아직 견적 요청이 없습니다" body="화물 크기와 거점만 넣으면 물류사들이 응찰합니다." action={<Button variant="primary">견적 요청</Button>} /></Panel>
            <Panel className="grid content-start gap-3 p-4" aria-busy>
              <Skeleton className="w-1/2" />
              <Skeleton className="h-8" />
              <Skeleton className="w-3/4" />
              <Skeleton className="h-20" />
            </Panel>
            <ErrorState what="요금표를 저장하지 못했습니다" why="포함 구간을 하나도 고르지 않았습니다." how="맡는 구간에 체크한 뒤 다시 저장해 주세요." action={<Button size="sm">다시 시도</Button>} />
          </div>
        </Section>

        <Section id="sg-marks" title="업체 표시" sub="공식 업체가 올린 로고만 쓴다. 없으면 글자 표시(자동 생성).">
          <div className="flex flex-wrap items-center gap-3">
            <LetterMark name="한바다로지스" size={44} />
            <LetterMark name="가람해운" size={36} />
            <LetterMark name="悦澜物流" size={28} />
          </div>
        </Section>
      </div>
    </>
  );
}
