import { and, eq } from 'drizzle-orm';
import { createElement } from 'react';
import type { DbOrTx } from '@/db/client';
import { menus, menuTranslations, operators, shops } from '@/db/schema';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { resolveSettings } from '@/modules/shop/settings';
import { adminNotifyEmailOf } from '@/modules/shop/shops';
import { BookingEmail } from './booking-email';
import { deliverEmail, type SendResult } from './booking-email-common';
import type { Mailer } from './mailer';
import { operatorEmails } from './send-operator-mail';

type ReviewKind = 'publish' | 'revision';

async function loadPlan(db: DbOrTx, menuId: string) {
  const [row] = await db
    .select({
      menuId: menus.id,
      shopId: menus.shopId,
      operatorId: menus.operatorId,
      title: menuTranslations.title,
      operatorName: operators.name,
      shopName: shops.name,
      profile: shops.profile,
      settings: shops.settings,
    })
    .from(menus)
    .innerJoin(shops, eq(shops.id, menus.shopId))
    .innerJoin(menuTranslations, and(eq(menuTranslations.menuId, menus.id), eq(menuTranslations.locale, 'ja')))
    .leftJoin(operators, eq(operators.id, menus.operatorId))
    .where(eq(menus.id, menuId));
  return row ?? null;
}

const base = (appUrl: string) => appUrl.replace(/\/$/, '');

/** 事業者からの申請（公開・変更）を組合へ知らせる */
export async function sendPlanReviewRequestMail(
  db: DbOrTx,
  mailer: Mailer,
  params: { menuId: string; kind: ReviewKind; appUrl: string },
): Promise<SendResult> {
  const plan = await loadPlan(db, params.menuId);
  if (!plan) return { status: 'skipped' };
  const settings = resolveSettings(plan.settings);
  const to = adminNotifyEmailOf({ settings, profile: plan.profile });
  if (!to) return { status: 'skipped' };
  const title = splitPlanTitle(plan.title).title;
  const what = params.kind === 'publish' ? '公開の申請' : '内容の変更の申請';
  const subject = `【プランの${what}】${plan.operatorName ?? ''} ${title}`;
  return deliverEmail(
    db,
    mailer,
    { shopId: plan.shopId, bookingId: null, customerId: null, locale: 'ja' },
    {
      type: 'plan_review',
      to,
      subject,
      react: createElement(BookingEmail, {
        preview: subject,
        greeting: plan.shopName,
        intro: `事業者からプランの${what}が届きました。管理画面で内容を確かめ、承認または差し戻しをしてください。`,
        rows: [
          { label: '事業者', value: plan.operatorName ?? '' },
          { label: 'プラン', value: title },
        ],
        buttonLabel: '管理画面で開く',
        buttonUrl: `${base(params.appUrl)}/admin/menus/${plan.menuId}#review`,
        footer: 'このメールは自動送信です。',
      }),
    },
  );
}

/** 審査の結果（承認・差し戻し）を事業者へ知らせる */
export async function sendPlanReviewResultMail(
  db: DbOrTx,
  mailer: Mailer,
  params: { menuId: string; kind: ReviewKind; approved: boolean; note?: string; appUrl: string },
): Promise<SendResult> {
  const plan = await loadPlan(db, params.menuId);
  if (!plan?.operatorId) return { status: 'skipped' };
  const [to] = await operatorEmails(db, plan.operatorId);
  if (!to) return { status: 'skipped' };
  const title = splitPlanTitle(plan.title).title;
  const what = params.kind === 'publish' ? '公開の申請' : '内容の変更の申請';
  const result = params.approved ? '承認しました' : '差し戻しました';
  const subject = `【プランの${what}を${result}】${title}`;
  const intro = params.approved
    ? params.kind === 'publish'
      ? 'プランを公開しました。お客様のサイトに表示され、申込を受け付けます。'
      : '変更の内容をプランに反映しました。'
    : '組合から差し戻しがありました。理由を確かめて内容を直し、もう一度申請してください。';
  return deliverEmail(
    db,
    mailer,
    { shopId: plan.shopId, bookingId: null, customerId: null, locale: 'ja' },
    {
      type: 'plan_review_result',
      to,
      replyTo: plan.profile.email,
      subject,
      react: createElement(BookingEmail, {
        preview: subject,
        greeting: `${plan.operatorName ?? ''} 御中`,
        intro,
        rows: [
          { label: 'プラン', value: title },
          ...(params.note ? [{ label: '組合からの連絡', value: params.note }] : []),
        ],
        buttonLabel: '事業者画面で開く',
        buttonUrl: `${base(params.appUrl)}/partner/plans/${plan.menuId}`,
        footer: `${plan.shopName}（このメールは自動送信です）`,
      }),
    },
  );
}
