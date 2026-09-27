import Image from 'next/image';
import { isRemoteImage } from '@/lib/image';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { formatYen } from '@/lib/format';
import type { PublishedMenuCard } from '@/modules/catalog/menus';

export async function MenuCard({ menu }: { menu: PublishedMenuCard }) {
  const t = await getTranslations();
  return (
    <Link
      href={`/menus/${menu.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-sky-100">
        {menu.image && (
          <Image
            unoptimized={isRemoteImage(menu.image.url)}
            src={menu.image.url}
            alt={menu.image.alt || menu.title}
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover transition duration-500 group-hover:scale-105"
          />
        )}
        <span className="absolute top-3 left-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-sky-900">
          {t(`category.${menu.category}`)}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        {menu.operatorName && (
          <p className="text-xs text-slate-500">{t('site.operatedBy', { name: menu.operatorName })}</p>
        )}
        <h3 className="line-clamp-2 font-bold leading-snug">{menu.title}</h3>
        <p className="line-clamp-2 text-sm text-slate-600">{menu.summary}</p>
        <div className="mt-auto flex items-end justify-between pt-2">
          <p className="text-xs text-slate-500">
            {t('site.duration', { minutes: menu.durationMin })}
            {menu.minAge !== null && menu.minAge > 0 && <> ・ {t('site.ageFrom', { age: menu.minAge })}</>}
          </p>
          {menu.minPrice !== null && (
            <p className="text-lg font-bold text-sky-800">{t('site.priceFrom', { price: formatYen(menu.minPrice) })}</p>
          )}
        </div>
      </div>
    </Link>
  );
}
