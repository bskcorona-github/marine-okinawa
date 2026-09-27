import { defineRouting } from 'next-intl/routing';

// 段階4で en / zh-Hant / zh-Hans / ko を追加する
export const routing = defineRouting({
  locales: ['ja'],
  defaultLocale: 'ja',
});

export type Locale = (typeof routing.locales)[number];
