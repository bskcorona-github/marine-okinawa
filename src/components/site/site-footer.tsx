import { Waves } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { ShopProfile } from '@/db/schema';
import { telHref } from '@/modules/shop/contact';
import { SITE_NAV } from './site-header';

const FOOTER_EXTRA = [
  { href: '/privacy', key: 'privacy' },
  { href: '/about', key: 'about' },
  { href: '/partner/apply', key: 'partnerApply' },
] as const;

export async function SiteFooter({
  siteName,
  shopName,
  profile,
}: {
  siteName: string;
  shopName: string;
  profile: ShopProfile;
}) {
  const t = await getTranslations('site');
  const hasContact = Boolean(profile.phone || profile.email);
  return (
    <footer className="bg-ocean-deep text-white/80">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-3">
          <p className="flex items-start gap-2 font-heading text-lg font-bold text-white">
            <Waves aria-hidden className="mt-1 size-5 shrink-0" />
            <span className="jp-auto">{siteName}</span>
          </p>
          <p className="text-sm text-white/80">{t('operatedBy', { name: shopName })}</p>
          <p className="jp-auto max-w-sm text-sm leading-relaxed text-white/70">{t('footerNote')}</p>
        </div>
        <nav aria-label="フッター" className="grid grid-cols-2 gap-x-4 text-sm md:grid-cols-1">
          {[...SITE_NAV, ...FOOTER_EXTRA].map((item) => (
            <Link key={item.key} href={item.href} className="flex min-h-11 items-center hover:text-white md:min-h-9">
              {t(`nav.${item.key}`)}
            </Link>
          ))}
        </nav>
        {(profile.address || hasContact) && (
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-white">{t('contact')}</p>
            <p>{shopName}</p>
            {profile.address && <p>{profile.address}</p>}
            {profile.phone && (
              <a href={telHref(profile.phone)} className="flex min-h-11 items-center hover:text-white md:min-h-0">
                {profile.phone}
              </a>
            )}
            {profile.email && (
              <a
                href={`mailto:${profile.email}`}
                className="flex min-h-11 items-center break-all hover:text-white md:min-h-0"
              >
                {profile.email}
              </a>
            )}
            {profile.businessHours && <p>{profile.businessHours}</p>}
          </div>
        )}
      </div>
      <p className="border-t border-white/10 py-4 text-center text-xs text-white/50">
        {t('copyright', { year: new Date().getFullYear(), name: shopName })}
      </p>
    </footer>
  );
}
