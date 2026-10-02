import type { Instrumentation } from 'next';

/**
 * 想定外のサーバーのエラー（画面・Route Handler・Server Action）を 1 行のログに残す。digest は画面のエラー番号と同じ。
 * 予約確認ページの URL のトークンはログに残さない。
 * ログは Node.js の機能（node:crypto）を使うため、Node.js のランタイムのときだけ読み込む（Edge 用には組み込まない）
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { logError, logInfo } = await import('./lib/log');
    const route = `${request.method} ${context.routePath} (${context.routeType})`;
    // 表示の途中で閲覧者が画面を離れた（通信を切った）だけのものは、エラーとして数えない
    if (error instanceof Error && error.message === 'The destination stream closed early.') {
      logInfo('request.aborted', { route });
      return;
    }
    const digest =
      typeof error === 'object' && error !== null && 'digest' in error
        ? String((error as { digest: unknown }).digest)
        : null;
    logError('request.unhandled', { route, code: digest }, error);
  }
};
