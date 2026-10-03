import { ChevronRight } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Phrase } from '@/components/site/phrase';
import { Link } from '@/i18n/navigation';
import { ApplyForm } from './apply-form';
import { db } from '@/db';
import { isFeatureOn } from '@/modules/shop/features';
import { getCurrentShop } from '@/modules/shop/shops';

export const metadata = { title: '事業者の登録申請', robots: { index: true, follow: true } };

export default async function PartnerApplyPage({ params }: PageProps<'/[locale]/partner/apply'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const steps = (['step1', 'step2', 'step3'] as const).map((s) => t(`partnerApply.steps.${s}`));
  const paused = !(await isFeatureOn(db, (await getCurrentShop(db)).id, 'site.partner_apply'));

  return (
    <div className="bg-sand pb-16">
      <div className="border-b border-ocean/10 bg-white">
        <div className="mx-auto max-w-3xl space-y-3 px-4 py-8">
          <nav aria-label="パンくず" className="flex items-center gap-1 text-xs text-ink/75">
            <Link href="/" className="hover:text-ocean">
              {t('menu.home')}
            </Link>
            <ChevronRight aria-hidden className="size-3" />
            <span>{t('partnerApply.title')}</span>
          </nav>
          <h1 className="font-heading text-2xl font-bold text-ocean md:text-3xl">{t('partnerApply.title')}</h1>
          <p className="jp-wrap text-sm leading-relaxed text-ink/80">
            <Phrase>{t('partnerApply.lead')}</Phrase>
          </p>
          <div>
            <p className="mb-2 text-xs font-semibold text-ink/70">{t('partnerApply.stepsTitle')}</p>
            <ol className="grid gap-2 sm:grid-cols-3">
              {steps.map((step, i) => (
                <li key={step} className="flex items-center gap-2 rounded-2xl bg-foam px-3 py-2 text-sm font-medium">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ocean text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="jp-auto">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-3xl px-4 pt-6">
        {paused ? (
          <p role="status" className="rounded-3xl bg-white p-6 text-sm leading-relaxed text-ink ring-1 ring-ocean/10">
            ただいま、事業者の登録申請の受け付けを止めています。お急ぎの方は、お問い合わせのページから組合へご連絡ください。
          </p>
        ) : (
          <ApplyForm />
        )}
      </div>
    </div>
  );
}
