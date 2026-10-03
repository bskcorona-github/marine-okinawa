import { describe, expect, it } from 'vitest';
import { AUTH_EVENT_LABELS, authEventOf, hashEmail, socialEventOf } from './auth-events';

describe('認証の出来事', () => {
  it('ログイン・2 段階認証の結果から、残す出来事を決める', () => {
    const ok = { failed: false, twoFactorRedirect: false };
    const failed = { failed: true, twoFactorRedirect: false };
    expect(authEventOf('/sign-in/email', ok)).toBe('sign_in.success');
    expect(authEventOf('/sign-in/email', { failed: false, twoFactorRedirect: true })).toBe('sign_in.password_ok');
    expect(authEventOf('/sign-in/email', failed)).toBe('sign_in.failed');
    expect(authEventOf('/two-factor/verify-totp', ok)).toBe('two_factor.verified');
    expect(authEventOf('/two-factor/verify-totp', failed)).toBe('two_factor.failed');
    expect(authEventOf('/two-factor/verify-backup-code', ok)).toBe('backup_code.used');
    expect(authEventOf('/two-factor/enable', ok)).toBe('two_factor.enabled');
    // ログアウトは、セッションが消える前（before のフック）に記録する
    expect(authEventOf('/sign-out', ok)).toBeNull();
    // セッションの確認などは残さない
    expect(authEventOf('/get-session', ok)).toBeNull();
  });

  it('メールアドレスは大文字・空白をそろえて、鍵つきのハッシュで残す', () => {
    expect(hashEmail(' Admin@Example.com ', 'secret')).toBe(hashEmail('admin@example.com', 'secret'));
    expect(hashEmail('admin@example.com', 'secret')).not.toBe(hashEmail('admin@example.com', 'other'));
    expect(hashEmail('admin@example.com', 'secret')).not.toContain('admin');
  });
});

describe('Google・LINE でのログインの出来事', () => {
  it('戻ってきてセッションができたらログイン、できなければつないだ、エラーなら失敗。外したら外した', () => {
    expect(socialEventOf('/callback/:id', 'google', { newSession: true, failed: false })).toBe('social.sign_in.google');
    expect(socialEventOf('/callback/:id', 'line', { newSession: false, failed: false })).toBe('social.linked.line');
    expect(socialEventOf('/callback/:id', 'line', { newSession: false, failed: true })).toBe('social.failed.line');
    expect(socialEventOf('/unlink-account', 'google', { newSession: false, failed: false })).toBe(
      'social.unlinked.google',
    );
    expect(socialEventOf('/unlink-account', 'google', { newSession: false, failed: true })).toBeNull();
    expect(socialEventOf('/sign-in/email', 'google', { newSession: true, failed: false })).toBeNull();
  });

  it('操作の記録の画面に出す名前がある', () => {
    expect(AUTH_EVENT_LABELS['social.sign_in.line']).toBe('LINEでログイン');
    expect(AUTH_EVENT_LABELS['social.linked.google']).toBe('Googleをつないだ');
  });
});
