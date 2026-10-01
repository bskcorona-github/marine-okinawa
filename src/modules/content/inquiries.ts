import { and, count, desc, eq } from 'drizzle-orm';
import { createElement } from 'react';
import { z } from 'zod';
import type { DbOrTx } from '@/db/client';
import { inquiries, inquiryKind, inquiryStatus, shops } from '@/db/schema';
import { formatDateLabel, localTime } from '@/lib/dates';
import { writeAuditLog } from '@/modules/audit/log';
import { normalizeEmail } from '@/modules/customer/normalize';
import { BookingEmail } from '@/modules/notification/booking-email';
import { deliverEmail, type SendResult } from '@/modules/notification/booking-email-common';
import type { Mailer } from '@/modules/notification/mailer';
import { resolveSettings } from '@/modules/shop/settings';
import { adminNotifyEmailOf } from '@/modules/shop/shops';

export type InquiryKind = (typeof inquiryKind.enumValues)[number];
export type InquiryStatus = (typeof inquiryStatus.enumValues)[number];

export const INQUIRY_KIND_LABELS: Record<InquiryKind, string> = {
  booking: 'ご予約・プランについて',
  group: '団体・学校・企業のご相談',
  partner: '事業者の登録・掲載について',
  other: 'その他',
};

export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  new: '未対応',
  in_progress: '対応中',
  done: '対応済み',
};

export const inquiryInputSchema = z.object({
  kind: z.enum(inquiryKind.enumValues),
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254),
  phone: z.string().trim().max(30),
  message: z.string().trim().min(1).max(3000),
});

export type InquiryInput = z.infer<typeof inquiryInputSchema>;

/** お問い合わせを保存する（プライバシーポリシーへの同意日時つき） */
export async function createInquiry(
  db: DbOrTx,
  params: { shopId: string; input: InquiryInput; now: Date },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(inquiries)
    .values({
      shopId: params.shopId,
      kind: params.input.kind,
      name: params.input.name,
      email: normalizeEmail(params.input.email) ?? params.input.email,
      phone: params.input.phone || null,
      message: params.input.message,
      consentedAt: params.now,
    })
    .returning({ id: inquiries.id });
  return row;
}

/**
 * お問い合わせの受付メール（お客様へ）と、組合への通知を送る。
 * 組合への通知は返信先をお客様のアドレスにして、そのまま返信できるようにする
 */
export async function sendInquiryMails(
  db: DbOrTx,
  mailer: Mailer,
  params: { inquiryId: string; appUrl: string },
): Promise<{ ack: SendResult; admin: SendResult }> {
  const [row] = await db
    .select({
      inquiry: inquiries,
      shopName: shops.name,
      profile: shops.profile,
      settings: shops.settings,
      timezone: shops.timezone,
    })
    .from(inquiries)
    .innerJoin(shops, eq(shops.id, inquiries.shopId))
    .where(eq(inquiries.id, params.inquiryId));
  if (!row) return { ack: { status: 'skipped' }, admin: { status: 'skipped' } };
  const { inquiry } = row;
  const settings = resolveSettings(row.settings);
  const target = { shopId: inquiry.shopId, bookingId: null, customerId: null, locale: 'ja' };
  const kind = INQUIRY_KIND_LABELS[inquiry.kind];
  const received = `${formatDateLabel(inquiry.createdAt, row.timezone)} ${localTime(inquiry.createdAt, row.timezone)}`;
  // お客様への受付メールには、書かれた本文を載せない（他人のアドレスを書いて、組合の名前で任意の文面を送らせないため）
  const ackRows = [
    { label: '種類', value: kind },
    { label: '受付日時', value: received },
  ];

  const ackSubject = `【お問い合わせを受け付けました】${settings.siteName}`;
  const ack = await deliverEmail(db, mailer, target, {
    type: 'inquiry_ack',
    to: inquiry.email,
    replyTo: row.profile.email,
    subject: ackSubject,
    react: createElement(BookingEmail, {
      preview: ackSubject,
      greeting: `${inquiry.name} 様`,
      intro:
        'お問い合わせありがとうございます。受け付けました。組合の担当者から、メールまたはお電話でご連絡します。お心当たりのない場合は、このメールを破棄してください。',
      rows: ackRows,
      footer: `${row.shopName}（このメールは自動送信です）`,
    }),
  });

  const to = adminNotifyEmailOf({ settings, profile: row.profile });
  const adminSubject = `【お問い合わせ】${kind}（${inquiry.name} 様）`;
  const admin = to
    ? await deliverEmail(db, mailer, target, {
        type: 'inquiry_received',
        to,
        replyTo: inquiry.email,
        subject: adminSubject,
        react: createElement(BookingEmail, {
          preview: adminSubject,
          greeting: row.shopName,
          intro: 'サイトからお問い合わせがありました。このメールに返信すると、お客様に届きます。',
          rows: [
            ...ackRows,
            { label: 'お名前', value: inquiry.name },
            { label: 'メール', value: inquiry.email },
            { label: '電話', value: inquiry.phone ?? '' },
            { label: '内容', value: inquiry.message },
          ].filter((r) => r.value),
          buttonLabel: '管理画面で開く',
          buttonUrl: `${params.appUrl.replace(/\/$/, '')}/admin/inquiries/${inquiry.id}`,
          footer: 'このメールは自動送信です。',
        }),
      })
    : ({ status: 'skipped' } as const);
  return { ack, admin };
}

export async function listInquiries(db: DbOrTx, params: { shopId: string; status?: InquiryStatus | null }) {
  return db
    .select()
    .from(inquiries)
    .where(and(eq(inquiries.shopId, params.shopId), params.status ? eq(inquiries.status, params.status) : undefined))
    .orderBy(desc(inquiries.createdAt))
    .limit(200);
}

export async function getInquiry(db: DbOrTx, params: { shopId: string; inquiryId: string }) {
  const [row] = await db
    .select()
    .from(inquiries)
    .where(and(eq(inquiries.shopId, params.shopId), eq(inquiries.id, params.inquiryId)));
  return row ?? null;
}

export async function countNewInquiries(db: DbOrTx, shopId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(inquiries)
    .where(and(eq(inquiries.shopId, shopId), eq(inquiries.status, 'new')));
  return row?.count ?? 0;
}

export const inquiryUpdateSchema = z.object({
  status: z.enum(inquiryStatus.enumValues),
  note: z.string().trim().max(3000),
});

/** 対応状況と対応メモを保存する */
export async function updateInquiry(
  db: DbOrTx,
  params: { shopId: string; inquiryId: string; input: z.infer<typeof inquiryUpdateSchema>; actorId: string | null },
): Promise<boolean> {
  const [row] = await db
    .update(inquiries)
    .set({ ...params.input, handledBy: params.actorId })
    .where(and(eq(inquiries.shopId, params.shopId), eq(inquiries.id, params.inquiryId)))
    .returning({ id: inquiries.id });
  if (!row) return false;
  await writeAuditLog(db, {
    shopId: params.shopId,
    actorId: params.actorId,
    action: 'inquiry.update',
    targetType: 'inquiry',
    targetId: params.inquiryId,
    after: params.input,
  });
  return true;
}
