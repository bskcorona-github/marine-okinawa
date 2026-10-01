import { Compass } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Phrase } from '@/components/site/phrase';
import { Link } from '@/i18n/navigation';

export default async function NotFound() {
  const t = await getTranslations('notFound');
  return (
    // フッターまでの高さを砂色で埋める（layout の main が縦並びの flex）
    <div className="flex flex-1 items-center bg-sand py-20">
      <div className="mx-auto w-full max-w-xl space-y-6 px-4 text-center">
        <Compass aria-hidden className="mx-auto size-14 text-lagoon" />
        <h1 className="font-heading text-2xl font-bold text-ocean">{t('title')}</h1>
        <p className="jp-wrap text-ink/75">
          <Phrase>{t('body')}</Phrase>
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/#activities"
            className="inline-flex min-h-12 items-center rounded-xl bg-coral-strong px-6 font-bold text-white hover:bg-coral-deep"
          >
            {t('search')}
          </Link>
          <Link
            href="/search"
            className="inline-flex min-h-12 items-center rounded-xl bg-white px-6 font-bold text-ocean ring-1 ring-ocean/20 hover:bg-foam"
          >
            {t('plans')}
          </Link>
        </div>
      </div>
    </div>
  );
}
