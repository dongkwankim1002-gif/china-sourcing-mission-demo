import type { Metadata } from 'next';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { asPublic } from '@/lib/db';
import { entrustProps } from '@/lib/server/onestop';
import { EntrustForm } from '@/components/onestop/entrust-form';
import { OnestopNotice } from '@/components/onestop/parts';
import { nextCutoff, ONESTOP_STAGES, WEEKDAY_KO } from '@/lib/onestop/settings';
import { dateKo } from '@/lib/format';
import { ONESTOP_STAGE_LABEL } from '@/lib/terms';

export const metadata: Metadata = {
  title: '원스톱 · 맡기기(미리보기)',
  description: '중국 사입부터 쿠팡 FC 입고까지 가격 하나로 맡깁니다 — 공동 혼적 CBM당 요금 + 개당 작업·바코드·검품. 미리보기 · 접수 기록만.',
  alternates: { canonical: '/onestop' },
};

const FOR_WHOM = ['한 번에 0.3~3 CBM 정도로 조금씩 들여오는 셀러', '처음 수입해서 9구간·통관·FC 입고 규격이 낯선 셀러', '1688·도매시장 상품을 대신 사서 모아 줄 곳이 필요한 셀러'];

export default async function OnestopHome() {
  const p = await asPublic(entrustProps);
  const cut = nextCutoff(Date.now(), p.tariff.cutoffWeekdays, p.tariff.cutoffHourKst);
  return (
    <>
      <section aria-labelledby="os-h" className="mb-6">
        <h1 id="os-h" className="display text-[28px] leading-tight text-text sm:text-[36px]">
          중국 사입부터 쿠팡 FC 입고까지,
          <br className="hidden sm:block" /> 가격 하나로 맡기세요
        </h1>
        <p className="mt-2 max-w-2xl text-base text-muted">
          비교하지 않아도 됩니다. 상품과 수량·부피만 적으면 공동 혼적 요금이 한 번에 나옵니다. 관세·부가세만 실비입니다.
        </p>
        <p className="mt-2 text-sm text-text tnum" data-testid="onestop-cutoff">
          다음 혼적 마감 <b>{dateKo(cut.date, { dow: false })}({WEEKDAY_KO[cut.weekday]}) {p.tariff.cutoffHourKst}시</b> · 매주 {p.tariff.cutoffWeekdays.map((d) => WEEKDAY_KO[d]).join('·')}요일
        </p>
      </section>
      <OnestopNotice on={p.on} />
      <section aria-label="맡기기" className="rounded-md border border-line bg-surface p-4 sm:p-5">
        <EntrustForm mode="quick" tariff={p.tariff} reference={p.reference} hubs={p.hubs} fcs={p.fcs} on={p.on} />
      </section>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section aria-labelledby="os-flow">
          <h2 id="os-flow" className="text-md font-bold">
            맡기면 끝 — 한 타임라인에서 봅니다
          </h2>
          <ol className="mt-3 grid gap-1.5 text-sm">
            {ONESTOP_STAGES.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-sm bg-ink text-2xs font-bold text-on-ink tnum">{i + 1}</span>
                {ONESTOP_STAGE_LABEL[s]}
              </li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="os-who">
          <h2 id="os-who" className="text-md font-bold">
            이런 셀러에게 맞습니다
          </h2>
          <ul className="mt-3 grid gap-2 text-sm">
            {FOR_WHOM.map((t) => (
              <li key={t} className="flex items-start gap-2">
                <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-ok" />
                {t}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">
            물량이 많거나 업체를 직접 고르고 싶다면{' '}
            <Link href="/" className="font-semibold text-text underline underline-offset-4">
              FC도착에서 같은 조건 비교
            </Link>
            가 더 맞습니다.
          </p>
        </section>
      </div>
    </>
  );
}
