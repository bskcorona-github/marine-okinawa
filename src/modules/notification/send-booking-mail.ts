import { createTranslator } from 'next-intl';
import { createElement } from 'react';
import type { DbOrTx } from '@/db/client';
import { formatDateLabel, localTime } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import messages from '@/messages/ja.json';
import { addBookingAccessToken } from '@/modules/booking/access-token';
import { getBookingSummaryById, type BookingSummary } from '@/modules/booking/queries';
import { mailKindForStatus, type BookingMailKind } from '@/modules/booking/status';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { cardPaymentsActive } from '@/modules/payment/card-payments';
import { BookingEmail } from './booking-email';
import {
  dayOfContactLine,
  deliverBookingEmail,
  peopleLine,
  shopContactLine,
  type NotificationType,
  type SendResult,
} from './booking-email-common';
import type { Mailer } from './mailer';
import { recipientName } from './recipient-name';
import { isPerPerson } from '@/modules/catalog/capacity-unit';

export type { SendResult } from './booking-email-common';

export { mailKindForStatus, type BookingMailKind };

const NOTIFICATION_TYPE: Record<BookingMailKind, NotificationType> = {
  requested: 'requested',
  payment_request: 'payment_request',
  confirmed: 'confirmed',
  cancelled: 'cancelled',
};

export function bookingUrl(appUrl: string, locale: string, accessToken: string): string {
  return `${appUrl.replace(/\/$/, '')}/${locale}/bookings/${accessToken}`;
}

type Row = { label: string; value: string | null | undefined };

function content(booking: BookingSummary, kind: BookingMailKind, cardPayment: boolean) {
  // 多言語に対応するときに booking.locale のメッセージに切り替える
  const t = createTranslator({ locale: 'ja', messages, namespace: 'email' });
  const title = splitPlanTitle(booking.menuTitle).title;
  const date = formatDateLabel(booking.startsAt, booking.timezone);
  const time = localTime(booking.startsAt, booking.timezone);
  const priceLabel = booking.settings.priceLabel;
  const confirmed = kind === 'confirmed';
  const subjectParams = { menu: title, date, time, bookingNo: booking.bookingNo };

  const base: Row[] = [
    { label: t('common.bookingNo'), value: booking.bookingNo },
    { label: t('common.menu'), value: title },
    { label: t(confirmed ? 'common.dateTimeConfirmed' : 'common.dateTime'), value: `${date} ${time}` },

    { label: t(isPerPerson(booking.capacityUnit) ? 'common.people' : 'common.course'), value: peopleLine(booking) },
    {
      label: t('common.guestCount'),
      value: booking.guestCount ? t('common.guestCountValue', { count: booking.guestCount }) : null,
    },
    {
      label: t('common.extraGuests'),
      value:
        booking.extraGuestAmount > 0
          ? t('common.extraGuestsValue', {
              count: booking.extraGuestCount,
              amount: formatYen(booking.extraGuestAmount),
              label: priceLabel,
            })
          : null,
    },
  ];
  const contact: Row = { label: t('common.contact'), value: shopContactLine(booking) };

  switch (kind) {
    case 'requested':
      return {
        subject: t('requested.subject', subjectParams),
        notice: t('requested.notice'),
        intro: t('requested.intro'),
        rows: [
          ...base,
          { label: priceLabel, value: formatYen(booking.totalAmount) },
          // 年齢・ご連絡事項は載せない（確かめていないアドレスへ、入力された文を組合の名前で送らないように。
          // 予約確認ページで見られる）
          { label: t('requested.replyGuide'), value: booking.settings.replyGuide || null },
          contact,
        ],
        sections: [{ title: t('requested.stepsTitle'), body: t('requested.steps') }],
        withLink: true,
      };
    case 'payment_request':
      return {
        subject: t('paymentRequest.subject', subjectParams),
        notice: t('paymentRequest.notice'),
        intro: t('paymentRequest.intro'),
        rows: [
          ...base,
          { label: priceLabel, value: formatYen(booking.paymentAmount ?? booking.totalAmount) },
          {
            label: t('paymentRequest.dueAt'),
            value: booking.paymentDueAt
              ? `${formatDateLabel(booking.paymentDueAt, booking.timezone)} ${localTime(booking.paymentDueAt, booking.timezone)}`
              : null,
          },
          contact,
        ],
        sections: [
          {
            title: t('paymentRequest.howTitle'),
            // カード決済（Stripe）が使えるときは、予約確認ページのボタンからカードで払ってもらう
            body:
              cardPayment && booking.paymentMethod === 'online'
                ? t('paymentRequest.howCard')
                : booking.settings.paymentInstructions || t('paymentRequest.howEmpty'),
          },
        ],
        withLink: true,
      };
    case 'confirmed': {
      const onsite = booking.paymentMethod === 'onsite';
      // 事前払いは記録した入金額を出す（料金と違う額を受け取った場合もそのまま伝える）
      const amount = formatYen(onsite ? booking.totalAmount : (booking.paymentAmount ?? booking.totalAmount));
      return {
        subject: t('confirmed.subject', subjectParams),
        intro: t(onsite ? 'confirmed.introOnsite' : 'confirmed.intro'),
        rows: [
          ...base,
          {
            label: t('confirmed.paid'),
            value: t(onsite ? 'confirmed.onsiteValue' : 'confirmed.paidValue', { amount }),
          },
          { label: t('common.operator'), value: booking.operatorName },
          { label: t('common.meetingPoint'), value: booking.meetingPoint },
          { label: t('common.meetingAddress'), value: booking.meetingAddress },
          { label: t('common.whatToBring'), value: booking.whatToBring },
          { label: t('common.dayOfContact'), value: dayOfContactLine(booking) },
          contact,
        ],
        withLink: true,
      };
    }
    case 'cancelled': {
      // 確定前の申込を天候で取り消したとき（回の一括の天候中止など）も、天候による中止として伝える
      const weather = booking.status === 'weather_cancelled' || booking.cancelCategory === 'weather';
      // 返金予定額は返金済みの分を含むので、メールにはまだ返していない分を出す
      const refund =
        booking.refundDueAmount === null ? null : Math.max(0, booking.refundDueAmount - (booking.refundedAmount ?? 0));
      return {
        subject: t(weather ? 'cancelled.subjectWeather' : 'cancelled.subject', subjectParams),
        intro: t(weather ? 'cancelled.introWeather' : 'cancelled.intro'),
        rows: [
          ...base,
          // 取消の理由は組合の記録（お客様には出さない）
          {
            label: t('cancelled.refund'),
            value:
              refund !== null && refund > 0
                ? t(booking.stripePaymentIntentId ? 'cancelled.refundValueCard' : 'cancelled.refundValue', {
                    amount: formatYen(refund),
                  })
                : null,
          },
          contact,
        ],
        withLink: false,
      };
    }
  }
}

/**
 * お客様に予約のメールを送る（受付完了・支払案内・予約確定・取消）。結果は notifications に記録し、
 * 失敗しても例外は投げない。予約確認ページへのリンクは、渡されたトークンか、新しく足したトークンで作る
 */
export async function sendBookingMail(
  db: DbOrTx,
  mailer: Mailer,
  params: { bookingId: string; kind: BookingMailKind; appUrl: string; accessToken?: string },
): Promise<SendResult> {
  const booking = await getBookingSummaryById(db, params.bookingId);
  if (!booking?.contactEmail) return { status: 'skipped' };
  const t = createTranslator({ locale: 'ja', messages, namespace: 'email.common' });
  const mail = content(booking, params.kind, await cardPaymentsActive(db, booking.shopId));
  const token = mail.withLink ? (params.accessToken ?? (await addBookingAccessToken(db, booking.id))) : null;

  return deliverBookingEmail(db, mailer, booking, {
    type: NOTIFICATION_TYPE[params.kind],
    to: booking.contactEmail,
    replyTo: booking.shopEmail,
    subject: mail.subject,
    react: createElement(BookingEmail, {
      preview: mail.subject,
      greeting: recipientName(booking.contactName),
      notice: 'notice' in mail ? mail.notice : undefined,
      intro: mail.intro,
      rows: mail.rows.filter((row): row is { label: string; value: string } => Boolean(row.value)),
      sections: 'sections' in mail ? mail.sections : undefined,
      buttonLabel: token ? t('viewBooking') : undefined,
      buttonUrl: token ? bookingUrl(params.appUrl, booking.locale, token) : undefined,
      footer: t(booking.shopEmail ? 'footerReply' : 'footer', { shop: booking.shopName }),
    }),
  });
}
