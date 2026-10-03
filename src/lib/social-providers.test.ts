import { describe, expect, it } from 'vitest';
import { enabledSocialProviders, socialProvidersFromEnv } from './social-providers';

describe('Google・LINE でのログインの設定', () => {
  it('鍵がそろっているものだけ使う', () => {
    expect(socialProvidersFromEnv({})).toEqual({});
    expect(enabledSocialProviders({ GOOGLE_CLIENT_ID: 'id' })).toEqual([]);
    expect(enabledSocialProviders({ LINE_CLIENT_ID: 'id', LINE_CLIENT_SECRET: 's' })).toEqual(['line']);
    expect(
      enabledSocialProviders({
        GOOGLE_CLIENT_ID: 'g',
        GOOGLE_CLIENT_SECRET: 's',
        LINE_CLIENT_ID: 'l',
        LINE_CLIENT_SECRET: 's',
      }),
    ).toEqual(['google', 'line']);
  });

  it('Google・LINE からは新しいアカウントを作らない', () => {
    const p = socialProvidersFromEnv({
      GOOGLE_CLIENT_ID: 'g',
      GOOGLE_CLIENT_SECRET: 's',
      LINE_CLIENT_ID: 'l',
      LINE_CLIENT_SECRET: 's',
    });
    expect(p.google).toMatchObject({ disableSignUp: true, disableImplicitSignUp: true });
    expect(p.line).toMatchObject({ disableSignUp: true, disableImplicitSignUp: true });
  });

  it('LINE はメールアドレスを頼まず、ない人には LINE の利用者 ID から届かないアドレスを作る', async () => {
    const line = socialProvidersFromEnv({ LINE_CLIENT_ID: 'l', LINE_CLIENT_SECRET: 's' }).line!;
    expect(line).toMatchObject({ disableDefaultScope: true, scope: ['openid', 'profile'] });
    expect(await line.mapProfileToUser!({ sub: 'U123', name: 'a' } as never)).toEqual({
      email: 'line-U123@users.line.invalid',
    });
    expect(await line.mapProfileToUser!({ sub: 'U123', email: 'a@example.com' } as never)).toEqual({
      email: 'a@example.com',
    });
  });
});
