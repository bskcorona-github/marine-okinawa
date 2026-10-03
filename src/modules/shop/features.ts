import { and, eq } from 'drizzle-orm';
import { cache } from 'react';
import type { Db, DbOrTx } from '@/db/client';
import { featureFlags } from '@/db/schema';
import { enabledSocialProviders, type SocialProviderId } from '@/lib/social-providers';
import { writeAuditLog } from '@/modules/audit/log';

/**
 * 機能の切り替え（組合の管理画面の「機能の切り替え」）。不具合が起きたときや確かめのために、機能を一時的に止める。
 * - 切り替えがない機能は初期値（defaultOn）のとおり動く
 * - security：止めると守りが弱くなる機能。止めるときは期限（自動で元に戻る時刻）が必須
 * - 期限を過ぎた切り替えは無いものとして扱う（初期値に戻る）
 */
export type FeatureDef = {
  group: 'ログイン' | 'お客様のサイト' | 'お支払い' | 'メール' | '事業者画面' | '自動の処理';
  label: string;
  /** オンのときの動き・止めるとどうなるか */
  description: string;
  defaultOn: boolean;
  security?: boolean;
};

export const FEATURES = {
  'auth.google': {
    group: 'ログイン',
    label: 'Google でログイン',
    description:
      '止めると、ログインの画面の「Google でログイン」を出さず、Google でのログイン・つなぐ操作を受け付けません。',
    defaultOn: true,
  },
  'auth.line': {
    group: 'ログイン',
    label: 'LINE でログイン',
    description:
      '止めると、ログインの画面の「LINE でログイン」を出さず、LINE でのログイン・つなぐ操作を受け付けません。',
    defaultOn: true,
  },
  'auth.two_factor_required': {
    group: 'ログイン',
    label: 'パスワードの人に 2 要素認証（認証アプリ）を求める',
    description:
      '止めているあいだは、認証アプリを設定していない人も、パスワードだけで管理画面・事業者画面に入れます（設定済みの人は、これまでどおりコードを聞かれます）。守りが弱くなるので、期限を決めて一時的に止めます。',
    defaultOn: true,
    security: true,
  },
  'auth.login_help': {
    group: 'ログイン',
    label: '「ログインできないとき」（自分でパスワードを決め直す）',
    description:
      '止めると、ログインの画面から案内のメールを受け取れなくなります（組合の画面から招待を送り直してください）。',
    defaultOn: true,
  },
  'site.contact_form': {
    group: 'お客様のサイト',
    label: 'お問い合わせフォーム',
    description: '止めると、フォームの代わりに「ただいま受け付けを止めています」と出し、送信を受け付けません。',
    defaultOn: true,
  },
  'site.partner_apply': {
    group: 'お客様のサイト',
    label: '事業者の登録申請フォーム',
    description: '止めると、フォームの代わりに「ただいま受け付けを止めています」と出し、申請を受け付けません。',
    defaultOn: true,
  },
  'payment.card': {
    group: 'お支払い',
    label: 'カード決済（Stripe）',
    description:
      '止めると、Stripe の鍵があってもカード決済を使わず、支払方法の案内（振込先など）で受け付けます。支払い中のお客様の決済は、そのまま記録します。',
    defaultOn: true,
  },
  'mail.send': {
    group: 'メール',
    label: 'メールを送る',
    description:
      '止めているあいだは、メールを送らずに「送れなかった」として記録します（あとで予約の画面などから送り直せます）。',
    defaultOn: true,
  },
  'partner.portal': {
    group: '事業者画面',
    label: '事業者画面',
    description: '止めると、事業者は事業者画面に入れません（ログインの画面に「止めています」と出します）。',
    defaultOn: true,
  },
  'partner.plan_edit': {
    group: '事業者画面',
    label: '事業者によるプランの登録・変更の申請',
    description: '止めると、事業者はプランを見られますが、追加・保存・公開の申請はできません。',
    defaultOn: true,
  },
  'schedule.auto_sync': {
    group: '自動の処理',
    label: '毎日の回の自動作成（毎日 3:00）',
    description:
      '止めているあいだは、定期の回のルールから先の回を自動で作りません（プランの「回の設定」で保存したときは作ります）。',
    defaultOn: true,
  },
} as const satisfies Record<string, FeatureDef>;

export type FeatureKey = keyof typeof FEATURES;

export const isFeatureKey = (value: unknown): value is FeatureKey =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(FEATURES, value);

/** 一時的に止めるときの期限の選び方（時間） */
export const DISABLE_DURATIONS_HOURS = [1, 24, 24 * 7] as const;

export type FeatureState = {
  key: FeatureKey;
  on: boolean;
  /** 初期値と違う（切り替えている） */
  overridden: boolean;
  /** 切り替えの期限（過ぎると初期値に戻る） */
  until: Date | null;
  reason: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
};

/** すべての機能の今の状態 */
export async function listFeatureStates(db: DbOrTx, shopId: string, now = new Date()): Promise<FeatureState[]> {
  const rows = await db.select().from(featureFlags).where(eq(featureFlags.shopId, shopId));
  return (Object.keys(FEATURES) as FeatureKey[]).map((key) => {
    const row = rows.find((r) => r.key === key);
    const active = row && (!row.until || row.until > now);
    return {
      key,
      on: active ? row.enabled : FEATURES[key].defaultOn,
      overridden: Boolean(active && row.enabled !== FEATURES[key].defaultOn),
      until: active ? row.until : null,
      reason: active ? row.reason : null,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  });
}

/** 1 回の画面の表示・操作の中では、同じ問い合わせを 1 回にする */
const statesOf = cache(async (db: DbOrTx, shopId: string) => listFeatureStates(db, shopId));

/** 機能がオンか（画面・Server Action から。1 回の表示の中ではまとめて読む） */
export async function isFeatureOn(db: DbOrTx, shopId: string, key: FeatureKey): Promise<boolean> {
  const states = await statesOf(db, shopId);
  return states.find((s) => s.key === key)?.on ?? FEATURES[key].defaultOn;
}

export type SetFeatureInput = {
  shopId: string;
  key: FeatureKey;
  on: boolean;
  /** 守りに関わる機能を止めるときは必須 */
  hours: number | null;
  reason: string;
  actorId: string | null;
  /** 切り替える人が、2 要素認証を止めていなくても入れる人か（守りに関わる機能を止めるときに必須） */
  actorStrongAuth: boolean;
  now: Date;
};

export type SetFeatureResult =
  | { ok: true }
  | { ok: false; error: 'REASON_REQUIRED' | 'DURATION_REQUIRED' | 'STRONG_AUTH_REQUIRED' | 'ALREADY_PAUSED' };

/**
 * 機能を切り替え、操作の記録に残す（同じトランザクションで）。初期値に戻すときは切り替えを消す。
 * 守りに関わる機能を止めるときは、期限（1 時間・1 日・7 日）を必須にする。止められるのは 2 要素認証を止めていなくても
 * 入れる管理者だけで、止めているあいだに止め直す（期限を延ばす）ことはできない（一度オンに戻してから止める）
 */
export async function setFeature(db: Db, input: SetFeatureInput): Promise<SetFeatureResult> {
  const def: FeatureDef = FEATURES[input.key];
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: 'REASON_REQUIRED' };
  const disablingSecurity = Boolean(def.security) && !input.on;
  if (disablingSecurity && !(DISABLE_DURATIONS_HOURS as readonly number[]).includes(input.hours ?? -1)) {
    return { ok: false, error: 'DURATION_REQUIRED' };
  }
  if (disablingSecurity && !input.actorStrongAuth) return { ok: false, error: 'STRONG_AUTH_REQUIRED' };
  if (disablingSecurity) {
    const current = (await listFeatureStates(db, input.shopId, input.now)).find((s) => s.key === input.key)!;
    if (!current.on) return { ok: false, error: 'ALREADY_PAUSED' };
  }
  const until =
    input.on === def.defaultOn ? null : input.hours ? new Date(input.now.getTime() + input.hours * 3_600_000) : null;
  await db.transaction(async (tx) => {
    const before = (await listFeatureStates(tx, input.shopId, input.now)).find((s) => s.key === input.key)!;
    if (input.on === def.defaultOn) {
      await tx.delete(featureFlags).where(and(eq(featureFlags.shopId, input.shopId), eq(featureFlags.key, input.key)));
    } else {
      await tx
        .insert(featureFlags)
        .values({
          shopId: input.shopId,
          key: input.key,
          enabled: input.on,
          until,
          reason,
          updatedBy: input.actorId,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: [featureFlags.shopId, featureFlags.key],
          set: { enabled: input.on, until, reason, updatedBy: input.actorId, updatedAt: input.now },
        });
    }
    await writeAuditLog(tx, {
      shopId: input.shopId,
      actorId: input.actorId,
      action: 'feature.toggle',
      targetType: 'feature',
      targetId: input.key,
      before: { on: before.on, until: before.until?.toISOString() ?? null },
      after: { on: input.on, until: until?.toISOString() ?? null, reason },
    });
  });
  return { ok: true };
}

/** 画面に出す LINE・Google でのログイン（鍵があり、「機能の切り替え」で止めていないもの） */
export async function activeSocialProviders(db: DbOrTx, shopId: string): Promise<SocialProviderId[]> {
  const enabled = enabledSocialProviders();
  const on = await Promise.all(
    enabled.map((p) => isFeatureOn(db, shopId, p === 'google' ? 'auth.google' : 'auth.line')),
  );
  return enabled.filter((_, i) => on[i]);
}
