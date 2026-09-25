import type { Metadata } from 'next';
import { FAQ } from '@/content/faq';
import { JsonLd } from '@/components/json-ld';

export const metadata: Metadata = {
  title: '자주 묻는 질문',
  description: '9구간 비교, 추천 점수, FC 입고 준비 인증, 관세·부가세 참고 추정, 입점과 게시 삭제에 대한 답.',
  alternates: { canonical: '/faq' },
};

export default function FaqPage() {
  const groups = ['화주', '물류사', '공통'] as const;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
        }}
      />
      <h1 className="display text-[clamp(28px,4vw,44px)]">자주 묻는 질문</h1>
      {groups.map((g) => (
        <section key={g} aria-labelledby={`g-${g}`} className="mt-8">
          <h2 id={`g-${g}`} className="text-sm font-bold text-muted">{g}</h2>
          <div className="mt-2 divide-y divide-line rounded-md border border-line bg-surface">
            {FAQ.filter((f) => f.group === g).map((f) => (
              <details key={f.q} className="group px-4 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-md font-semibold">
                  {f.q}
                  <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-xs border border-line text-muted transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="pb-4 text-sm leading-6 text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
