import { and, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { account } from '@/db/schema';
import { SOCIAL_PROVIDERS, type SocialProviderId } from '@/lib/social-providers';

/** その人につながっている Google・LINE（id は外すときに使うアカウントの行の id。つないだ日時つき） */
export async function listLinkedProviders(
  db: DbOrTx,
  userId: string,
): Promise<{ id: string; providerId: SocialProviderId; linkedAt: Date }[]> {
  const rows = await db
    .select({ id: account.id, providerId: account.providerId, linkedAt: account.createdAt })
    .from(account)
    .where(and(eq(account.userId, userId), inArray(account.providerId, [...SOCIAL_PROVIDERS])));
  return rows as { id: string; providerId: SocialProviderId; linkedAt: Date }[];
}
