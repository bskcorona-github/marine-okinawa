export type AdminAccess = 'ok' | 'login' | 'setup_2fa';

/**
 * 管理画面に入れるかの判定。
 * 段階1はお客様ログインがないため「ショップのメンバー」かつ「2 要素認証を有効化済み」で判定する。
 * 段階4でお客様ログインを追加するときは、セッションがパスワード + 2 要素認証で作られたことも確認する（設計書 §2.1）。
 */
export function evaluateAdminAccess(p: {
  hasSession: boolean;
  isMember: boolean;
  twoFactorEnabled: boolean;
}): AdminAccess {
  if (!p.hasSession || !p.isMember) return 'login';
  if (!p.twoFactorEnabled) return 'setup_2fa';
  return 'ok';
}
