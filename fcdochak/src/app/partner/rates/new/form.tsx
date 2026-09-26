'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { RateCardForm, blankCard, issuesToMap } from '@/components/rate-card-form';
import { Button } from '@/components/ui/core';
import { addRateCard } from '@/app/actions/partner';
import { RateCardInput, type RateCardInputT } from '@/lib/schemas';

type Opt = { code: string; name: string };

export function NewCardForm({ today, hubs, ports, modes, locale, init }: { today: string; hubs: Opt[]; ports: Opt[]; modes: Opt[]; locale: 'ko' | 'zh'; init: { hub?: string; port?: string; mode?: string } }) {
  const t = useTranslations('p.rates');
  const router = useRouter();
  const [v, setV] = React.useState<RateCardInputT>(() => blankCard(today, init.hub ?? hubs[0]?.code, init.port ?? ports[0]?.code, (init.mode as 'LCL') ?? (modes[0]?.code as 'LCL')));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, start] = React.useTransition();
  return (
    <form
      className="grid gap-6 rounded-md border border-line bg-surface p-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const p = RateCardInput.safeParse(v);
        if (!p.success) {
          setErrors(issuesToMap(p.error.issues));
          toast.error(p.error.issues[0].message);
          return;
        }
        setErrors({});
        start(async () => {
          const r = await addRateCard(v);
          if (!r.ok) {
            if (r.issues) setErrors(issuesToMap(r.issues));
            return void toast.error(r.error ?? '');
          }
          toast.success(t('saved'));
          router.push(`/partner/rates/${r.data!.id}`);
        });
      }}
    >
      <RateCardForm value={v} onChange={setV} errors={errors} hubs={hubs} ports={ports} modes={modes} locale={locale} />
      <div className="flex justify-end"><Button type="submit" variant="primary" size="lg" disabled={pending}>{t('add')}</Button></div>
    </form>
  );
}
