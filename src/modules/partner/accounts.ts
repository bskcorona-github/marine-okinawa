import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, DbOrTx } from '@/db/client';
import { isUniqueViolation } from '@/db/errors';
import { logError } from '@/lib/log';
import { account, operatorMembers, operators, user } from '@/db/schema';
import { writeAuditLog } from '@/modules/audit/log';

/**
 * ログイン用のユーザーを作る処理（本番は Better Auth、テストは差し替える）。パスワードは付けない
 * （本人が招待のリンクから、LINE・Google をつなぐか、自分でパスワードを決める）
 */
export type CreateLoginUser = (params: { email: string; name: string }) => Promise<string>;

/** パスワード・つないだ LINE / Google・2 要素認証の設定・ログイン中のセッションを消す処理（本番は Better Auth） */
export type ResetLoginAccess = (params: { userId: string }) => Promise<void>;

export type AccountError = 'EMAIL_TAKEN' | 'OPERATOR_NOT_FOUND';

export const operatorAccountSchema = z.object({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(60),
});

/**
 * 事業者のログインアカウントを作る（このあと招待のメールを送る）。同じメールアドレスのユーザーがいれば作らない
 * （組合の管理者のアカウントを事業者に流用させない）
 */
export async function createOperatorAccount(
  db: Db,
  createUser: CreateLoginUser,
  input: { shopId: string; operatorId: string; email: string; name: string; actorId: string | null },
): Promise<{ ok: true; userId: string; email: string; operatorName: string } | { ok: false; error: AccountError }> {
  const email = input.email.trim().toLowerCase();
  const [operator] = await db
    .select({ id: operators.id, name: operators.name })
    .from(operators)
    .where(and(eq(operators.id, input.operatorId), eq(operators.shopId, input.shopId)));
  if (!operator) return { ok: false, error: 'OPERATOR_NOT_FOUND' };
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (existing) return { ok: false, error: 'EMAIL_TAKEN' };

  let userId: string;
  try {
    userId = await createUser({ email, name: input.name.trim() });
  } catch (error) {
    // 同じメールアドレスで同時に発行した（ユーザーのメールアドレスは重ならない）
    if (isUniqueViolation(error)) return { ok: false, error: 'EMAIL_TAKEN' };
    throw error;
  }
  try {
    await db.transaction(async (tx) => {
      await tx.insert(operatorMembers).values({
        userId,
        shopId: input.shopId,
        operatorId: operator.id,
        createdBy: input.actorId,
        // 仮パスワードはない（本人が招待のリンクから決める）ので、変更を求めない
        passwordChangeRequired: false,
      });
      await writeAuditLog(tx, {
        shopId: input.shopId,
        actorId: input.actorId,
        action: 'operator.account_create',
        targetType: 'operator',
        targetId: operator.id,
        after: { userId, email },
      });
    });
  } catch (error) {
    // 事業者への結びつけに失敗した：作ったユーザーを消す（どこにも属さないログインを残さない）
    await db
      .delete(user)
      .where(eq(user.id, userId))
      .catch((removeError) => logError('operator.account.orphan_remove_failed', { userId }, removeError));
    throw error;
  }
  return { ok: true, userId, email, operatorName: operator.name };
}

/**
 * 事業者アカウントのログインの方法をすべて外し、招待からやり直してもらう（LINE・端末をなくした・漏れたおそれがあるとき）。
 * パスワード・つないだ LINE / Google・2 要素認証の設定・ログイン中のセッションを消す（このあと招待のメールを送る）
 */
export async function resetOperatorAccess(
  db: Db,
  resetLoginAccess: ResetLoginAccess,
  input: { shopId: string; userId: string; actorId: string | null },
): Promise<{ ok: true; email: string; name: string; operatorName: string } | { ok: false }> {
  const [member] = await db
    .select({
      operatorId: operatorMembers.operatorId,
      email: user.email,
      name: user.name,
      operatorName: operators.name,
    })
    .from(operatorMembers)
    .innerJoin(user, eq(user.id, operatorMembers.userId))
    .innerJoin(operators, eq(operators.id, operatorMembers.operatorId))
    .where(and(eq(operatorMembers.userId, input.userId), eq(operatorMembers.shopId, input.shopId)));
  if (!member) return { ok: false };
  await resetLoginAccess({ userId: input.userId });
  await db.transaction(async (tx) => {
    await tx
      .update(operatorMembers)
      .set({ passwordChangeRequired: false })
      .where(eq(operatorMembers.userId, input.userId));
    await writeAuditLog(tx, {
      shopId: input.shopId,
      actorId: input.actorId,
      action: 'operator.account_reset',
      targetType: 'operator',
      targetId: member.operatorId,
      after: { userId: input.userId },
    });
  });
  return { ok: true, email: member.email, name: member.name, operatorName: member.operatorName };
}

/** パスワードを変えたら、仮パスワードのままの印を外す（Better Auth のパスワード変更のあとに呼ぶ） */
export async function markPasswordChanged(db: Db, userId: string): Promise<void> {
  await db.update(operatorMembers).set({ passwordChangeRequired: false }).where(eq(operatorMembers.userId, userId));
}

/** 事業者アカウントを停止・再開する（停止すると、次の画面の操作からログインできない） */
export async function setOperatorAccountDisabled(
  db: Db,
  input: { shopId: string; userId: string; disabled: boolean; actorId: string | null; now: Date },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(operatorMembers)
      .set({ disabledAt: input.disabled ? input.now : null })
      .where(and(eq(operatorMembers.userId, input.userId), eq(operatorMembers.shopId, input.shopId)))
      .returning({ operatorId: operatorMembers.operatorId });
    if (!row) return false;
    await writeAuditLog(tx, {
      shopId: input.shopId,
      actorId: input.actorId,
      action: input.disabled ? 'operator.account_disable' : 'operator.account_enable',
      targetType: 'operator',
      targetId: row.operatorId,
      after: { userId: input.userId },
    });
    return true;
  });
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
      passwordChangeRequired: operatorMembers.passwordChangeRequired,
      createdAt: operatorMembers.createdAt,
      /** ログインに使える方法（credential：パスワード、line・google：つないだアカウント） */
      methods: sql<
        string[]
      >`coalesce((select array_agg(a.provider_id order by a.provider_id) from ${account} a where a.user_id = ${user.id}), '{}')`,
    })
    .from(operatorMembers)
    .innerJoin(user, eq(user.id, operatorMembers.userId))
    .where(and(eq(operatorMembers.shopId, params.shopId), eq(operatorMembers.operatorId, params.operatorId)))
    .orderBy(asc(operatorMembers.createdAt));
}
