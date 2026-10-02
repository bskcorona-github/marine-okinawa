'use client';

import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Phrase } from '@/components/site/phrase';
import { Link } from '@/i18n/navigation';

/** 公開サイトの想定外のエラー（ヘッダー・フッターは残す）。エラー番号はサーバーのログと同じ */
export default function SiteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations('errorPage');
  return (
    <div className="flex flex-1 items-center bg-sand py-20">
      <div role="alert" className="mx-auto w-full max-w-xl space-y-6 px-4 text-center">
        <AlertTriangle aria-hidden className="mx-auto size-14 text-coral-deep" />
        <h1 className="font-heading text-2xl font-bold text-ocean">{t('title')}</h1>
        <p className="jp-wrap text-ink/75">
          <Phrase>{t('body')}</Phrase>
        </p>
        {error.digest && <p className="font-mono text-sm text-ink/70">{t('ref', { ref: error.digest })}</p>}
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex min-h-12 items-center rounded-xl bg-coral-strong px-6 font-bold text-white hover:bg-coral-deep"
          >
            {t('retry')}
          </button>
          <Link
            href="/contact"
            className="inline-flex min-h-12 items-center rounded-xl bg-white px-6 font-bold text-ocean ring-1 ring-ocean/20 hover:bg-foam"
          >
            {t('contact')}
          </Link>
        </div>
      </div>
    </div>
  );
}
