import { Clock, Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { formatDuration } from '@/components/site/duration';
import { Phrase } from '@/components/site/phrase';
import { PlanCover } from '@/components/site/plan-cover';
import { Link } from '@/i18n/navigation';
import { formatYen } from '@/lib/format';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import type { PublishedMenuCard } from '@/modules/catalog/menus';

/** 「新着」の印を付ける期間（公開からの日数） */
const NEW_DAYS = 30;

type Props = {
  menu: PublishedMenuCard;
  /** 見出しの階層（一覧の見出しの下なら h3） */
  headingLevel?: 'h2' | 'h3';
  /** 「新着」を判定する基準の時刻（ページで 1 回だけ取る） */
  now: Date;
};

/** プランのカード。実施事業者の名前は出さない（予約確定まで伏せる） */
export async function PlanCard({ menu, headingLevel = 'h3', now }: Props) {
  const t = await getTranslations();
  const { title, tagline, labels } = splitPlanTitle(menu.title);
  const Heading = headingLevel;
  const isNew = Boolean(menu.publishedAt && now.getTime() - menu.publishedAt.getTime() < NEW_DAYS * 86_400_000);

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-ocean/10 transition hover:-translate-y-0.5 hover:shadow-lg hover:ring-ocean/20">
      <PlanCover
        category={menu.category}
        seed={menu.slug}
        image={menu.image}
        alt={title}
        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        // 写真がないときは装飾なので低めにして、情報を上に寄せる
        className={menu.image ? 'aspect-[16/10]' : 'aspect-[16/6] sm:aspect-[16/8]'}
        iconClassName="size-12 sm:size-14"
      />

      <div className="flex flex-1 flex-col gap-2.5 p-5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink/75">
          <span className="rounded-full bg-ocean px-2.5 py-0.5 font-bold text-white">
            {menu.activityName ?? t(`category.${menu.category}`)}
          </span>
          {menu.status === 'paused' && (
            <span className="rounded-full bg-ink/10 px-2.5 py-0.5 font-bold text-ink/75">{t('home.card.paused')}</span>
          )}
          {menu.featured && (
            <span className="rounded-full bg-coral-strong/10 px-2.5 py-0.5 font-bold text-coral-deep">
              {t('home.card.featured')}
            </span>
          )}
          {isNew && (
            <span className="rounded-full bg-lagoon/15 px-2.5 py-0.5 font-bold text-lagoon-ink">
              {t('home.card.new')}
            </span>
          )}
          {labels.map((label) => (
            <span key={label} className="rounded-md bg-sand-deep/70 px-1.5 py-0.5 font-medium text-ink/80">
              {label}
            </span>
          ))}
        </div>
        <Heading className="jp-wrap text-[17px] leading-snug font-bold text-ink">
          <Link
            href={`/menus/${menu.slug}`}
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          >
            <Phrase>{title}</Phrase>
          </Link>
        </Heading>
        {tagline && <p className="text-xs font-semibold text-lagoon-ink">★ {tagline}</p>}
        {menu.summary && (
          <p className="jp-wrap line-clamp-2 text-sm leading-relaxed text-ink/75">
            <Phrase>{menu.summary}</Phrase>
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-ink/75">
          <span className="inline-flex items-center gap-1">
            <Clock aria-hidden className="size-3.5" />
            {formatDuration((k, v) => t(`duration.${k}`, v), menu.durationMin)}
          </span>
          {menu.minAge !== null && menu.minAge > 0 && (
            <span className="inline-flex items-center gap-1">
              <Users aria-hidden className="size-3.5" />
              {t('home.card.ageFrom', { age: menu.minAge })}
            </span>
          )}
        </div>

        <div className="flex items-end justify-between border-t border-ocean/10 pt-3">
          <span className="text-sm font-semibold text-lagoon-ink">{t('home.card.detail')} →</span>
          {menu.minPrice !== null && (
            <span className="text-right leading-tight">
              <span className="font-heading text-xl font-bold text-ocean">
                {t('home.card.priceFrom', { price: formatYen(menu.minPrice) })}
              </span>
              <span className="block text-[11px] text-ink/70">
                {t('home.card.perUnit', { unit: menu.capacityUnit })}
                {menu.hasLowerPrices && ` ・ ${t('home.card.lowerPrices')}`}
              </span>
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
