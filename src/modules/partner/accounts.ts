import { randomBytes } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, DbOrTx } from '@/db/client';
import { operatorMembers, operators, shopMembers, user } from '@/db/schema';
import { writeAuditLog } from '@/modules/audit/log';

/** ログイン用のユーザーを作る処理（本番は Better Auth、テストは差し替える） */
export type CreateCredentialUser = (params: { email: string; name: string; password: string }) => Promise<string>;

export type AccountError = 'EMAIL_TAKEN' | 'OPERATOR_NOT_FOUND';

export const operatorAccountSchema = z.object({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(60),
});

/** 仮パスワード（発行時に 1 回だけ画面に出す。20 文字・英数字と記号の一部） */
export function temporaryPassword(): string {
  return randomBytes(15).toString('base64url');
}

/**
 * 事業者のログインアカウントを発行する。同じメールアドレスのユーザーがいれば発行しない
 * （組合の管理者のアカウントを事業者に流用させない）
 */
export async function createOperatorAccount(
  db: Db,
  createUser: CreateCredentialUser,
  input: { shopId: string; operatorId: string; email: string; name: string; actorId: string | null },
): Promise<{ ok: true; userId: string; password: string } | { ok: false; error: AccountError }> {
  const email = input.email.trim().toLowerCase();
  const [operator] = await db
    .select({ id: operators.id })
    .from(operators)
    .where(and(eq(operators.id, input.operatorId), eq(operators.shopId, input.shopId)));
  if (!operator) return { ok: false, error: 'OPERATOR_NOT_FOUND' };
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (existing) return { ok: false, error: 'EMAIL_TAKEN' };

  const password = temporaryPassword();
  const userId = await createUser({ email, name: input.name.trim(), password });
  await db.insert(operatorMembers).values({
    userId,
    shopId: input.shopId,
    operatorId: operator.id,
    createdBy: input.actorId,
  });
  await writeAuditLog(db, {
    shopId: input.shopId,
    actorId: input.actorId,
    action: 'operator.account_create',
    targetType: 'operator',
    targetId: operator.id,
    after: { userId, email },
  });
  return { ok: true, userId, password };
}

/** 事業者アカウントを停止・再開する（停止すると、次の画面の操作からログインできない） */
export async function setOperatorAccountDisabled(
  db: Db,
  input: { shopId: string; userId: string; disabled: boolean; actorId: string | null; now: Date },
): Promise<boolean> {
  const [row] = await db
    .update(operatorMembers)
    .set({ disabledAt: input.disabled ? input.now : null })
    .where(and(eq(operatorMembers.userId, input.userId), eq(operatorMembers.shopId, input.shopId)))
    .returning({ operatorId: operatorMembers.operatorId });
  if (!row) return false;
  await writeAuditLog(db, {
    shopId: input.shopId,
    actorId: input.actorId,
    action: input.disabled ? 'operator.account_disable' : 'operator.account_enable',
    targetType: 'operator',
    targetId: row.operatorId,
    after: { userId: input.userId },
  });
  return true;
}

/** 事業者のアカウント一覧（管理画面の事業者詳細用） */
export async function listOperatorAccounts(db: DbOrTx, params: { shopId: string; operatorId: string }) {
  return db
    .select({
      userId: operatorMembers.userId,
      email: user.email,
      name: user.name,
      twoFactorEnabled: user.twoFactorEnabled,
      disabledAt: operatorMembers.disabledAt,
      createdAt: operatorMembers.createdAt,
    })
    .from(operatorMembers)
    .innerJoin(user, eq(user.id, operatorMembers.userId))
    .where(and(eq(operatorMembers.shopId, params.shopId), eq(operatorMembers.operatorId, params.operatorId)))
    .orderBy(asc(operatorMembers.createdAt));
}

/** そのユーザーが組合の管理者か（管理者のアカウントを事業者として扱わないための確認） */
export async function isShopAdmin(db: DbOrTx, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: shopMembers.userId }).from(shopMembers).where(eq(shopMembers.userId, userId));
  return Boolean(row);
}
