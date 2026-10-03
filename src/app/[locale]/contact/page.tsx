import { ChevronRight } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { connection } from 'next/server';
import { ContactLinks } from '@/components/site/contact-links';
import { Phrase } from '@/components/site/phrase';
import { db } from '@/db';
import { Link } from '@/i18n/navigation';
import { shopContact } from '@/modules/shop/contact';
import { getCurrentShop } from '@/modules/shop/shops';
import { ContactForm } from './contact-form';
import { isFeatureOn } from '@/modules/shop/features';

export const metadata = { title: 'お問い合わせ' };

const KINDS = ['booking', 'group', 'partner', 'other'] as const;

export default async function ContactPage({ params, searchParams }: PageProps<'/[locale]/contact'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await connection();
  const sp = await searchParams;
  const shop = await getCurrentShop(db);
  const paused = !(await isFeatureOn(db, shop.id, 'site.contact_form'));
  const t = await getTranslations();
  const contact = shopContact({
    shopName: shop.name,
    shopPhone: shop.profile.phone,
    shopBusinessHours: shop.profile.businessHours,
    shopEmail: shop.profile.email,
  });
  const initialKind = KINDS.find((k) => k === sp.kind) ?? 'booking';

  return (
    <div className="bg-sand pb-16">
      <div className="border-b border-ocean/10 bg-white">
        <div className="mx-auto max-w-3xl space-y-3 px-4 py-8">
          <nav aria-label="パンくず" className="flex items-center gap-1 text-xs text-ink/75">
            <Link href="/" className="hover:text-ocean">
              {t('menu.home')}
            </Link>
            <ChevronRight aria-hidden className="size-3" />
            <span>{t('contact.title')}</span>
          </nav>
          <h1 className="font-heading text-2xl font-bold text-ocean md:text-3xl">{t('contact.title')}</h1>
          <p className="jp-wrap text-sm leading-relaxed text-ink/80">
            <Phrase>{t('contact.lead')}</Phrase>
          </p>
        </div>
      </div>
      <div className="mx-auto max-w-3xl space-y-6 px-4 pt-6">
        {contact?.phone && (
          <div className="rounded-3xl bg-white p-5 ring-1 ring-ocean/10">
            <ContactLinks contact={{ ...contact, email: null }} />
          </div>
        )}
        {paused ? (
          <p role="status" className="rounded-3xl bg-white p-6 text-sm leading-relaxed text-ink ring-1 ring-ocean/10">
            ただいま、フォームでのお問い合わせの受け付けを止めています。お急ぎの方は、上のお電話でお問い合わせください。
          </p>
        ) : (
          <ContactForm initialKind={initialKind} />
        )}
      </div>
    </div>
  );
}
