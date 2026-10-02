/** Better Auth のクライアントが返すエラー（status は HTTP の状態。通信の失敗では 0 や undefined） */
type AuthClientError = { status?: number; code?: string; message?: string } | null | undefined;

export type AuthErrorContext = 'sign_in' | 'two_factor' | 'backup_code' | 'enable';

const WRONG: Record<AuthErrorContext, string> = {
  sign_in: 'メールアドレスまたはパスワードが違います',
  two_factor: 'コードが正しくありません。認証アプリの最新のコードを入力してください',
  backup_code: 'バックアップコードが正しくありません（使ったコードは 1 回しか使えません）',
  enable: 'パスワードが正しくありません',
};

/**
 * ログイン・2 段階認証のエラーを、利用者向けの文にする。回数制限・通信の失敗・ログインのやり直しが要るときは、
 * 「パスワードが違う」と区別して出す（直す場所を間違えないように）
 */
export function authErrorMessage(error: AuthClientError, context: AuthErrorContext): string {
  if (error?.status === 429) return '試行回数が多すぎます。1 分ほど待ってからお試しください';
  // 2 段階認証の途中の情報（クッキー）の期限が切れた：ログインからやり直す
  if (error?.code === 'INVALID_TWO_FACTOR_COOKIE') {
    return 'ログインの確認の期限が切れました。お手数ですが、ログインからやり直してください';
  }
  if (!error?.status || error.status >= 500) {
    return '通信に失敗しました。インターネットの接続を確かめて、少し待ってからもう一度お試しください';
  }
  return WRONG[context];
}
