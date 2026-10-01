import { Noto_Sans_JP, Zen_Kaku_Gothic_New } from 'next/font/google';

// 日本語フォントはファイルが大きいため preload せず、表示は swap で先に代替フォントを出す
export const bodyFont = Noto_Sans_JP({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
  preload: false,
});

export const displayFont = Zen_Kaku_Gothic_New({
  weight: ['700', '900'],
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  preload: false,
});
