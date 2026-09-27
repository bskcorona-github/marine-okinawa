import { twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        // React の外（認証クライアントのコールバック）なので router は使えない
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/admin/2fa';
      },
    }),
  ],
});
