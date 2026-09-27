import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // 管理画面・API・静的ファイルはロケールの振り分け対象外
  matcher: ['/((?!api|admin|_next|_vercel|.*\\..*).*)'],
};
