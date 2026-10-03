import { describe, expect, it } from 'vitest';
import { authErrorMessage, socialErrorMessage } from './auth-errors';

describe('ログインのエラーの文', () => {
  it('回数制限・期限切れ・通信の失敗を、パスワードの間違いと分ける', () => {
    expect(authErrorMessage({ status: 401 }, 'sign_in')).toBe('メールアドレスまたはパスワードが違います');
    expect(authErrorMessage({ status: 429 }, 'two_factor')).toContain('試行回数');
    expect(authErrorMessage({ status: 401, code: 'INVALID_TWO_FACTOR_COOKIE' }, 'two_factor')).toContain('やり直して');
    expect(authErrorMessage({ status: 0 }, 'sign_in')).toContain('通信に失敗');
    expect(authErrorMessage({ status: 503 }, 'backup_code')).toContain('通信に失敗');
    expect(authErrorMessage({ status: 401 }, 'backup_code')).toContain('バックアップコード');
  });
});

describe('Google・LINE でのログインのエラーの文', () => {
  it('つないでいないアカウントは、つなぎ方を案内する。ほかの失敗は分けて出す', () => {
    expect(socialErrorMessage(undefined)).toBeNull();
    expect(socialErrorMessage('signup_disabled')).toContain('まだつながっていません');
    expect(socialErrorMessage('account_already_linked_to_different_user')).toContain('ほかのアカウント');
    expect(socialErrorMessage('access_denied')).toContain('取り消しました');
    expect(socialErrorMessage('something_else')).toContain('失敗しました');
  });
});
