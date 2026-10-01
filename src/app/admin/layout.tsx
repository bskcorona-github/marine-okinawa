import type { Metadata } from 'next';
import { bodyFont, displayFont } from '../fonts';
import '../globals.css';

export const metadata: Metadata = {
  title: { default: '管理画面', template: '%s | 管理画面' },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: LayoutProps<'/admin'>) {
  return (
    <html lang="ja" className={`${bodyFont.variable} ${displayFont.variable} h-full antialiased`}>
      <body className="min-h-full bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
