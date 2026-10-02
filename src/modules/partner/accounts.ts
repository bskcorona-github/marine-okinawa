import { randomBytes } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, DbOrTx } from '@/db/client';
import { isUniqueViolation } from '@/db/errors';
import { logError } from '@/lib/log';
import { operatorMembers, operators, user } from '@/db/schema';
import { writeAuditLog } from '@/modules/audit/log';

/** ログイン用のユーザーを作る処理（本番は Better Auth、テストは差し替える） */
export type CreateCredentialUser = (params: { email: string; name: string; password: string }) => Promise<string>;

/** パスワードを置き換え、ログイン中のセッションと 2 要素認証の設定を消す処理（本番は Better Auth） */
export type ResetCredential = (params: { userId: string; password: string }) => Promise<void>;

export type AccountError = 'EMAIL_TAKEN' | 'OPERATOR_NOT_FOUND';

export const operatorAccountSchema = z.object({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(60),
});

/** 仮パスワード（発行時に 1 回だけ画面に出す。20 文字・英数字と記号の一部） */
function temporaryPassword(): string {
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
  let userId: string;
  try {
    userId = await createUser({ email, name: input.name.trim(), password });
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
        // 仮パスワードは組合も知っているので、事業者に自分のパスワードへ変えてもらう
        passwordChangeRequired: true,
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
  return { ok: true, userId, password };
}

/**
 * 事業者アカウントの仮パスワードを発行し直す（パスワードを忘れた・2 要素認証の端末をなくした・漏れたおそれがあるとき）。
 * ログイン中のセッションと 2 要素認証の設定を消し、次のログインで 2 要素認証の設定とパスワードの変更をしてもらう
 */
export async function resetOperatorPassword(
  db: Db,
  resetCredential: ResetCredential,
  input: { shopId: string; userId: string; actorId: string | null },
): Promise<{ ok: true; password: string; email: string } | { ok: false }> {
  const [member] = await db
    .select({ operatorId: operatorMembers.operatorId, email: user.email })
    .from(operatorMembers)
    .innerJoin(user, eq(user.id, operatorMembers.userId))
    .where(and(eq(operatorMembers.userId, input.userId), eq(operatorMembers.shopId, input.shopId)));
  if (!member) return { ok: false };
  const password = temporaryPassword();
  await resetCredential({ userId: input.userId, password });
  await db.transaction(async (tx) => {
    await tx
      .update(operatorMembers)
      .set({ passwordChangeRequired: true })
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
  return { ok: true, password, email: member.email };
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
    })
    .from(operatorMembers)
    .innerJoin(user, eq(user.id, operatorMembers.userId))
    .where(and(eq(operatorMembers.shopId, params.shopId), eq(operatorMembers.operatorId, params.operatorId)))
    .orderBy(asc(operatorMembers.createdAt));
}
