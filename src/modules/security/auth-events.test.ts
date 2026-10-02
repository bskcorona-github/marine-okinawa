import { describe, expect, it } from 'vitest';
import { authEventOf, hashEmail } from './auth-events';

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
