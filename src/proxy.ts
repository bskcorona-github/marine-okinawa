import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // 管理画面・事業者画面・API・写真の配信（/media）・静的ファイルはロケールの振り分け対象外
  matcher: ['/((?!api|admin|partner|media|_next|_vercel|.*\\..*).*)'],
};
