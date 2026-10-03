import { and, eq, isNull } from 'drizzle-orm';
import { createTranslator } from 'next-intl';
import { createElement } from 'react';
import type { DbOrTx } from '@/db/client';
import { bookingOperatorRequests, bookingStatusEvents, operatorMembers, operators, user } from '@/db/schema';
import { formatDateLabel, localTime } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import messages from '@/messages/ja.json';
import { getBookingSummaryById, type BookingSummary } from '@/modules/booking/queries';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { REQUEST_STATUS_LABELS } from '@/modules/partner/requests';
import { adminNotifyEmailOf } from '@/modules/shop/shops';
import { BookingEmail } from './booking-email';
import { deliverBookingEmail, peopleLine, type SendResult } from './booking-email-common';
import type { Mailer } from './mailer';
import { isPerPerson } from '@/modules/catalog/capacity-unit';

/** 1 通の送信先の上限（事業者のログイン用アドレスが多くても、送りすぎないように） */
const MAX_RECIPIENTS = 5;

/**
 * 事業者への連絡先。事業者の代表メールがあればそれだけ、なければ停止されていない事業者アカウントのアドレス
 */
export async function operatorEmails(db: DbOrTx, operatorId: string): Promise<string[]> {
  const [op] = await db.select({ email: operators.email }).from(operators).where(eq(operators.id, operatorId));
  if (!op) return [];
  if (op.email) return [op.email];
  const members = await db
    .select({ email: user.email })
    .from(operatorMembers)
    .innerJoin(user, eq(user.id, operatorMembers.userId))
    .where(and(eq(operatorMembers.operatorId, operatorId), isNull(operatorMembers.disabledAt)))
    .limit(MAX_RECIPIENTS);
  return members.map((m) => m.email);
}

/** 複数の事業者の連絡先（照会の画面で「送り先」を出すため。operatorEmails と同じ判定） */
export async function operatorEmailMap(db: DbOrTx, operatorIds: string[]): Promise<Map<string, string[]>> {
  const entries = await Promise.all(operatorIds.map(async (id) => [id, await operatorEmails(db, id)] as const));
  return new Map(entries);
}

const base = (appUrl: string) => appUrl.replace(/\/$/, '');

/** 事業者向けに出す予約の項目（受入可否の判断に要るものだけ。お客様の連絡先は載せない） */
function operatorRows(t: ReturnType<typeof createTranslator<typeof messages, 'email'>>, booking: BookingSummary) {
  const title = splitPlanTitle(booking.menuTitle).title;
  const date = formatDateLabel(booking.startsAt, booking.timezone);
  const time = localTime(booking.startsAt, booking.timezone);
  return [
    { label: t('common.bookingNo'), value: booking.bookingNo },
    { label: t('common.menu'), value: title },
    { label: t('common.dateTimeConfirmed'), value: `${date} ${time}` },
    { label: t(isPerPerson(booking.capacityUnit) ? 'common.people' : 'common.course'), value: peopleLine(booking) },
    {
      label: t('common.guestCount'),
      value: booking.guestCount ? t('common.guestCountValue', { count: booking.guestCount }) : null,
    },
    { label: t('common.participantAges'), value: booking.participantAges },
    { label: t('common.customerNote'), value: booking.customerNote },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value));
}

function subjectParams(booking: BookingSummary) {
  return {
    menu: splitPlanTitle(booking.menuTitle).title,
    date: formatDateLabel(booking.startsAt, booking.timezone),
    time: localTime(booking.startsAt, booking.timezone),
    people: peopleLine(booking),
    bookingNo: booking.bookingNo,
  };
}

async function sendToOperator(
  db: DbOrTx,
  mailer: Mailer,
  booking: BookingSummary,
  operatorId: string,
  message: Omit<Parameters<typeof deliverBookingEmail>[3], 'to'>,
): Promise<SendResult> {
  const to = await operatorEmails(db, operatorId);
  if (to.length === 0) return { status: 'skipped' };
  const results: SendResult[] = [];
  for (const address of to) {
    results.push(
      await deliverBookingEmail(db, mailer, booking, { ...message, to: address, replyTo: booking.shopEmail }),
    );
  }
  // 1 通でも届いていれば送れたことにする（届かなかった分は送信履歴に残る）
  return results.find((r) => r.status === 'sent') ?? results[0];
}

/** 事業者へ受入確認の依頼を知らせる（照会ごと） */
export async function sendOperatorRequestMail(
  db: DbOrTx,
  mailer: Mailer,
  params: { requestId: string; appUrl: string },
): Promise<SendResult> {
  const [request] = await db
    .select({
      bookingId: bookingOperatorRequests.bookingId,
      operatorId: bookingOperatorRequests.operatorId,
      note: bookingOperatorRequests.requestNote,
      operatorName: operators.name,
    })
    .from(bookingOperatorRequests)
    .innerJoin(operators, eq(operators.id, bookingOperatorRequests.operatorId))
    .where(eq(bookingOperatorRequests.id, params.requestId));
  const booking = request && (await getBookingSummaryById(db, request.bookingId));
  if (!request || !booking) return { status: 'skipped' };
  const t = createTranslator({ locale: 'ja', messages, namespace: 'email' });
  const subject = t('operatorRequest.subject', subjectParams(booking));
  const rows = operatorRows(t, booking);
  if (request.note) rows.push({ label: t('operatorRequest.note'), value: request.note });
  return sendToOperator(db, mailer, booking, request.operatorId, {
    type: 'operator_request',
    subject,
    react: createElement(BookingEmail, {
      preview: subject,
      greeting: t('common.greeting', { name: request.operatorName }),
      intro: t('operatorRequest.intro'),
      rows,
      buttonLabel: t('operatorRequest.open'),
      buttonUrl: `${base(params.appUrl)}/partner/requests/${params.requestId}`,
      footer: t('operatorRequest.footer'),
    }),
  });
}

/** 組合へ事業者の回答を知らせる（通知先がなければ送らない） */
export async function sendOperatorResponseMail(
  db: DbOrTx,
  mailer: Mailer,
  params: { requestId: string; appUrl: string },
): Promise<SendResult> {
  const [request] = await db
    .select({
      bookingId: bookingOperatorRequests.bookingId,
      status: bookingOperatorRequests.status,
      note: bookingOperatorRequests.responseNote,
      operatorName: operators.name,
    })
    .from(bookingOperatorRequests)
    .innerJoin(operators, eq(operators.id, bookingOperatorRequests.operatorId))
    .where(eq(bookingOperatorRequests.id, params.requestId));
  const booking = request && (await getBookingSummaryById(db, request.bookingId));
  const to =
    booking && adminNotifyEmailOf({ settings: booking.settings, profile: { email: booking.shopEmail ?? undefined } });
  if (!request || !booking || !to) return { status: 'skipped' };
  const t = createTranslator({ locale: 'ja', messages, namespace: 'email' });
  const response = REQUEST_STATUS_LABELS[request.status];
  const subject = t('operatorResponse.subject', {
    operator: request.operatorName,
    response,
    bookingNo: booking.bookingNo,
  });
  const rows = [
    { label: t('operatorResponse.response'), value: response },
    ...(request.note ? [{ label: t('operatorResponse.note'), value: request.note }] : []),
    ...operatorRows(t, booking),
  ];
  return deliverBookingEmail(db, mailer, booking, {
    type: 'operator_response',
    to,
    subject,
    react: createElement(BookingEmail, {
      preview: subject,
      greeting: booking.shopName,
      intro: t('operatorResponse.intro', { operator: request.operatorName }),
      rows,
      buttonLabel: t('operatorResponse.open'),
      buttonUrl: `${base(params.appUrl)}/admin/bookings/${booking.id}`,
      footer: t('operatorResponse.footer'),
    }),
  });
}

/**
 * 事業者への予約の連絡。
 * - 省略時：実施事業者へ、今の状態（確定・取消・天候中止）を知らせる（実施事業者が決まっていなければ送らない）
 * - released：確定後に担当から外れた事業者へ、担当の変更を知らせる
 * - closed：受入可・条件付きで答えたが選ばれなかった事業者へ、受入確認の終了を知らせる
 */
export async function sendOperatorBookingMail(
  db: DbOrTx,
  mailer: Mailer,
  params: { bookingId: string; appUrl: string; notice?: 'released' | 'closed' | 'changed'; operatorId?: string },
): Promise<SendResult> {
  const booking = await getBookingSummaryById(db, params.bookingId);
  if (!booking) return { status: 'skipped' };
  // 担当の変更・照会の終了は指定の事業者へ、変更の連絡と状態の連絡は実施事業者へ
  const operatorId =
    params.notice === 'released' || params.notice === 'closed' ? params.operatorId : booking.operatorId;
  if (!operatorId) return { status: 'skipped' };
  const kind = params.notice
    ? params.notice === 'released'
      ? 'Released'
      : params.notice === 'changed'
        ? 'Changed'
        : 'Closed'
    : booking.status === 'confirmed'
      ? 'Confirmed'
      : booking.status === 'weather_cancelled' ||
          (booking.status === 'cancelled' && booking.cancelCategory === 'weather')
        ? 'Weather'
        : booking.status === 'cancelled'
          ? 'Cancelled'
          : null;
  if (!kind) return { status: 'skipped' };
  const [op] = await db.select({ name: operators.name }).from(operators).where(eq(operators.id, operatorId));
  // 一度も確定していない申込の取消は、事業者画面の予約には出ないので、受入確認の一覧へ案内する
  const [wasConfirmed] =
    kind === 'Cancelled' || kind === 'Weather'
      ? await db
          .select({ id: bookingStatusEvents.id })
          .from(bookingStatusEvents)
          .where(and(eq(bookingStatusEvents.bookingId, booking.id), eq(bookingStatusEvents.toStatus, 'confirmed')))
          .limit(1)
      : [{ id: 'n/a' }];
  const toRequests = kind === 'Closed' || !wasConfirmed;
  const t = createTranslator({ locale: 'ja', messages, namespace: 'email' });
  const subject = t(`operatorBooking.subject${kind}`, subjectParams(booking));
  const rows = operatorRows(t, booking);
  if (kind === 'Confirmed') {
    // 現地払いは、当日お客様から受け取る金額を伝える（組合が受け取ったと誤解させない）
    rows.push({
      label: t('operatorBooking.payment'),
      value:
        booking.paymentMethod === 'onsite'
          ? t('operatorBooking.paymentOnsite', { amount: formatYen(booking.totalAmount) })
          : t('operatorBooking.paymentOnline'),
    });
  }
  if (kind === 'Confirmed' && booking.operatorAgreement) {
    rows.push({ label: t('operatorBooking.agreement'), value: booking.operatorAgreement });
  }
  if ((kind === 'Cancelled' || kind === 'Weather') && booking.cancelOperatorNote) {
    rows.push({ label: t('operatorBooking.kumiaiNote'), value: booking.cancelOperatorNote });
  }
  const intro =
    kind === 'Confirmed' && booking.paymentMethod === 'onsite'
      ? t('operatorBooking.introConfirmedOnsite')
      : t(`operatorBooking.intro${kind}`);
  return sendToOperator(db, mailer, booking, operatorId, {
    type: 'operator_booking',
    subject,
    react: createElement(BookingEmail, {
      preview: subject,
      greeting: t('common.greeting', { name: op?.name ?? '' }),
      intro,
      rows,
      buttonLabel: t(toRequests ? 'operatorBooking.openRequests' : 'operatorBooking.open'),
      buttonUrl: toRequests
        ? `${base(params.appUrl)}/partner/requests`
        : kind === 'Released'
          ? `${base(params.appUrl)}/partner/bookings`
          : `${base(params.appUrl)}/partner/bookings/${booking.id}`,
      footer: t('operatorBooking.footer'),
    }),
  });
}
