import { Mail, Phone } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { SELECT_CLASS } from '@/components/admin/field-styles';
import { Notice, PageHeader, Panel } from '@/components/admin/page-header';
import { BookingStatusBadge } from '@/components/admin/status-badge';
import { SubmitButton } from '@/components/admin/submit-button';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { db } from '@/db';
import { formatDateLabel, localDate, localTime } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { ownValue } from '@/lib/own';
import { cn } from '@/lib/utils';
import { isDateString, isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import {
  BOOKING_ERROR_LABELS,
  BOOKING_SOURCE_LABELS,
  BOOKING_STATUS_LABELS,
  BOOKING_TRANSITION_LABELS,
  CANCEL_CATEGORIES,
  CANCEL_CATEGORY_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
} from '@/modules/booking/labels';
import { getBookingDetail, listBookingHistory, listBookingNotifications } from '@/modules/booking/queries';
import { isOpenRequest, nextStatusesFor, type BookingStatus } from '@/modules/booking/status';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { listOperators } from '@/modules/catalog/menus';
import { listPricesForDate } from '@/modules/catalog/prices';
import { SEASON_LABELS } from '@/modules/catalog/season';
import { formatPhoneForDisplay } from '@/modules/customer/normalize';
import { remainingSeats } from '@/modules/inventory/availability';
import { getSlotForAdmin, listMenuSlotsOnDate } from '@/modules/inventory/queries';
import { operatorEmailMap } from '@/modules/notification/send-operator-mail';
import { REPORT_RESULT_LABELS, type ReportResult } from '@/modules/partner/bookings';
import { REQUEST_STATUS_LABELS, listBookingRequests, listMenuCandidates } from '@/modules/partner/requests';
import { telHref } from '@/modules/shop/contact';
import { paymentDueAt } from '@/modules/shop/settings';
import {
  assignOperatorAction,
  changeItemsAction,
  changeSlotAction,
  changeStatusAction,
  recordRefundAction,
  requestOperatorAction,
  resendMailAction,
  saveAdminNoteAction,
  withdrawRequestAction,
} from './actions';
import { AmountField } from './amount-field';
import { BookingFlow } from './booking-flow';

export const metadata = { title: '予約詳細' };

const MAIL_TYPE_LABELS: Record<string, string> = {
  requested: '受付完了メール',
  payment_request: '支払案内メール',
  confirmed: '予約確定メール',
  cancelled: '取消のお知らせ',
  admin_new_request: '組合への新規申込通知',
  operator_request: '事業者への受入確認の依頼',
  operator_response: '事業者の回答の通知（組合宛て）',
  operator_booking: '事業者への連絡（確定・取消・変更など）',
  reminder: 'リマインド',
  weather_cancel: '天候中止のお知らせ',
};
const MAIL_KIND_LABELS: Record<string, string> = {
  requested: '受付完了メール',
  payment_request: '支払案内メール',
  confirmed: '予約確定メール',
  cancelled: '取消のお知らせ',
};
const MAIL_STATUS_LABELS = {
  queued: '送信待ち',
  sent: '送信済み',
  failed: '送信失敗',
  bounced: '届かず',
  unknown: '送信結果不明',
} as const;

const PAGE_ERRORS: Record<string, string> = {
  NO_MAIL_FOR_STATUS: 'この予約の今の状態では、送り直すメールがありません。',
  NO_OPERATOR_SELECTED: '照会する事業者を選んでください。',
  AGREEMENT_NOTE_REQUIRED: '条件付きの回答のときは、合意した内容を入れてください。',
};

/** 状態を進めたときに出す結果（メールの種類つき） */
const CHANGED: Partial<Record<BookingStatus, string>> = {
  reviewing: '内容確認中にしました。',
  operator_checking: '事業者確認中にしました。事業者へ空き・受入可否を確認してください。',
  awaiting_payment: '支払待ちにしました。',
  confirmed: '入金を記録し、予約を確定しました。',
  completed: '催行済みにしました。',
  verified: '実績を確認済みにしました。',
  settled: '精算済みにしました。',
  cancelled: '予約を取り消しました。枠を回に戻しました。',
  weather_cancelled: '天候中止にしました。枠を回に戻しました。',
  no_show: '無断キャンセルにしました。',
};

const ACTION_LABELS: Record<string, string> = {
  'booking.refund': '返金を記録',
  'booking.assign_operator': '実施事業者を変更',
  'booking.resend_mail': 'メールを送り直し',
  'booking.admin_note': '組合メモを更新',
  'booking.withdraw_operator_request': '受入確認の照会を取り下げ',
};

/** 次の状態へ進めるときに、ダイアログで説明すること */
const TRANSITION_HELP: Partial<Record<BookingStatus, string>> = {
  reviewing: '組合で入力内容（人数・年齢・第 2 希望など）を確認している状態にします。',
  operator_checking:
    '電話などで事業者に空き・受入可否を確認しているときに使います。事業者画面で照会するときは「事業者への受入確認」から依頼してください（自動でこの状態になります）。',
  awaiting_payment: 'お客様に金額・支払期限・支払方法を案内します。',
  confirmed: '入金を確認した記録を残し、予約を確定します。確定後は、お客様に実施事業者と当日の連絡先を案内します。',
  completed: '当日、予定どおり催行したことを記録します。',
  verified: '参加人数・内容・金額を確認し、月次精算の対象にします。',
  settled: '月次精算まで完了したことを記録します。',
  no_show: '連絡なく来られなかった予約として記録します（枠は戻しません）。',
};

const REQUEST_TONE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-900',
  accepted: 'bg-emerald-100 text-emerald-900',
  conditional: 'bg-sky-100 text-sky-900',
  declined: 'bg-red-100 text-red-800',
  withdrawn: 'bg-slate-100 text-slate-600',
};

/** 支払案内の前（組合が確認している間）は、支払いの状況を「案内前」と出す */
const BEFORE_PAYMENT_REQUEST = new Set<BookingStatus>(['requested', 'reviewing', 'operator_checking']);

export default async function BookingDetailPage({ params, searchParams }: PageProps<'/admin/bookings/[id]'>) {
  const admin = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const [b, mails, history, operators, requests] = await Promise.all([
    getBookingDetail(db, { shopId: admin.shopId, bookingId: id }),
    listBookingNotifications(db, { shopId: admin.shopId, bookingId: id }),
    listBookingHistory(db, { shopId: admin.shopId, bookingId: id }),
    listOperators(db, admin.shopId),
    listBookingRequests(db, { shopId: admin.shopId, bookingId: id }),
  ]);
  if (!b) notFound();

  const at = (d: Date) => `${formatDateLabel(d, b.timezone)} ${localTime(d, b.timezone)}`;
  const unit = b.capacityUnit;
  const phone = formatPhoneForDisplay(b.contactPhone);
  const payment = b.payment;
  const paid = payment?.status === 'paid' || payment?.status === 'partially_refunded' || payment?.status === 'refunded';
  const now = new Date();
  const today = localDate(now, b.timezone);
  const started = b.startsAt <= now;
  const overdue = b.status === 'awaiting_payment' && payment?.dueAt && payment.dueAt < now;
  const errorText = ownValue(PAGE_ERRORS, sp.error) ?? ownValue<string>(BOOKING_ERROR_LABELS, sp.error) ?? null;
  // 予約一覧から開いたときは、一覧の絞り込み・ページを保ったまま戻る（管理画面の予約一覧以外の URL は使わない）
  const listBack =
    typeof sp.back === 'string' && (sp.back === '/admin/bookings' || sp.back.startsWith('/admin/bookings?'))
      ? sp.back
      : null;
  const back = listBack ? { href: listBack, label: '予約一覧へ' } : { href: '/admin/bookings', label: '予約台帳へ' };
  const backField = listBack && <input type="hidden" name="back" value={listBack} />;
  const movable = isOpenRequest(b.status) || b.status === 'confirmed';
  const moveDate = isDateString(sp.move) ? sp.move : null;
  const itemsEditable = isOpenRequest(b.status) || b.status === 'confirmed' || b.status === 'completed';
  const canRequest = BEFORE_PAYMENT_REQUEST.has(b.status);

  const [moveSlots, slotInfo, menuCandidates] = await Promise.all([
    moveDate
      ? listMenuSlotsOnDate(db, { shopId: admin.shopId, menuId: b.menuId, date: moveDate, timezone: b.timezone })
      : [],
    itemsEditable ? getSlotForAdmin(db, { shopId: admin.shopId, slotId: b.slotId }) : null,
    canRequest ? listMenuCandidates(db, { shopId: admin.shopId, menuId: b.menuId }) : [],
  ]);
  const priceSet = slotInfo
    ? await listPricesForDate(db, {
        menuId: b.menuId,
        operatorId: slotInfo.operatorId,
        date: localDate(b.startsAt, b.timezone),
      })
    : null;
  // 実施候補が未設定のプランでは、停止していない全事業者から選べるようにする
  const candidates = menuCandidates.length
    ? menuCandidates
    : operators.filter((o) => o.status !== 'suspended').map((o) => ({ id: o.id, name: o.name, email: o.email }));
  // 照会のメールの送り先（事業者の代表メール、なければ事業者アカウントのアドレス。送信と同じ判定）
  const recipients = canRequest
    ? await operatorEmailMap(
        db,
        candidates.map((c) => c.id),
      )
    : new Map<string, string[]>();
  const activeRequests = requests.filter((r) => r.status !== 'withdrawn');
  // 実施事業者への照会（照会していなければ null）
  const assignedRequest = activeRequests.find((r) => r.operatorId === b.operatorId) ?? null;
  const pendingRequests = activeRequests.filter((r) => r.status === 'pending');
  const operatorSuspended = operators.find((o) => o.id === b.operatorId)?.status === 'suspended';

  const operatorPhone = b.operatorPhone ? formatPhoneForDisplay(b.operatorPhone) || b.operatorPhone : null;
  const rows: [string, ReactNode][] = [
    ['日時', at(b.startsAt)],
    ['プラン', splitPlanTitle(b.menuTitle).title],
    ['人数', b.items.map((i) => `${i.label} ${i.quantity}${unit}（${formatYen(i.unitPrice)}）`).join(' / ')],
    ...(b.guestCount ? [['乗船人数', `${b.guestCount}名`] as [string, string]] : []),
    ...(b.extraGuestAmount > 0
      ? [['追加の乗船', `${b.extraGuestCount}名分 ${formatYen(b.extraGuestAmount)}（合計に含む）`] as [string, string]]
      : []),
    [b.settings.priceLabel, formatYen(b.totalAmount)],
    [
      '実施事業者',
      b.operatorName ? (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {b.operatorName}
          {operatorPhone && (
            <a
              href={telHref(b.operatorPhone!)}
              className="inline-flex items-center gap-1 font-semibold text-sky-800 tabular-nums hover:underline"
            >
              <Phone aria-hidden className="size-3.5" />
              {operatorPhone}
            </a>
          )}
        </span>
      ) : (
        <span className="text-amber-800">未割り当て</span>
      ),
    ],
    // 出発港を選ぶ貸切などは、予約したコースの集合場所を出す（お客様に案内した場所）
    ...(b.meetingPoint ? [['集合場所', b.meetingPoint] as [string, string]] : []),
    ['受付経路', BOOKING_SOURCE_LABELS[b.source]],
    ['申込日時', at(b.createdAt)],
  ];
  if (b.overCapacityReason) rows.push(['定員超過の理由', b.overCapacityReason]);
  if (b.cancelledAt) rows.push(['取消日時', at(b.cancelledAt)]);
  if (b.cancelCategory)
    rows.push(['取消の区分', ownValue(CANCEL_CATEGORY_LABELS, b.cancelCategory) ?? b.cancelCategory]);
  if (b.cancelReason) rows.push(['取消の理由（組合用）', b.cancelReason]);
  if (b.cancelOperatorNote) rows.push(['事業者への連絡', b.cancelOperatorNote]);

  const requestRows: [string, string][] = [
    ['第2希望', b.secondChoice ?? ''],
    ['参加者の年齢', b.participantAges ?? ''],
    ['ご連絡事項', b.customerNote ?? ''],
    ['同意', b.consentedAt ? `参加条件・キャンセル規定・個人情報の取扱いに同意（${at(b.consentedAt)}）` : ''],
  ].filter(([, v]) => v) as [string, string][];

  // 申込時に同意したキャンセル規定（取消のときにキャンセル料を確かめるため）
  const policy = (b.policySnapshot ?? {}) as Record<string, unknown>;
  const policyText = [policy.commonCancellationPolicy, policy.cancellationPolicy]
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .join('\n\n');

  const timeline = [
    ...history.events.map((e) => ({
      id: e.id,
      at: e.at,
      title:
        e.fromStatus === e.toStatus
          ? e.actorType === 'operator'
            ? '事業者の回答・報告'
            : '内容の変更・記録'
          : `${e.fromStatus ? `${BOOKING_STATUS_LABELS[e.fromStatus]} → ` : ''}${BOOKING_STATUS_LABELS[e.toStatus]}`,
      who:
        e.actorType === 'customer'
          ? 'お客様'
          : e.actorType === 'system'
            ? '自動処理'
            : (e.actorName ?? e.actorEmail ?? (e.actorType === 'operator' ? '事業者' : '組合')),
      note: e.note,
    })),
    ...history.logs.map((l) => {
      const after = (l.after ?? {}) as Record<string, unknown>;
      const note =
        l.action === 'booking.refund'
          ? `${formatYen(Number(after.amount ?? 0))}（返金の合計 ${formatYen(Number(after.refundedAmount ?? 0))}）`
          : l.action === 'booking.resend_mail'
            ? `${MAIL_KIND_LABELS[String(after.kind)] ?? ''}（${MAIL_STATUS_LABELS[after.status as keyof typeof MAIL_STATUS_LABELS] ?? after.status}）`
            : l.action === 'booking.assign_operator'
              ? (operators.find((o) => o.id === after.operatorId)?.name ?? '未割り当て')
              : l.action === 'booking.withdraw_operator_request'
                ? (requests.find((r) => r.id === after.requestId)?.operatorName ?? '')
                : '';
      return {
        id: l.id,
        at: l.at,
        title: ACTION_LABELS[l.action] ?? l.action,
        who: l.actorName ?? l.actorEmail ?? '組合',
        note,
      };
    }),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const visited = history.events.length
    ? [...new Set(history.events.flatMap((e) => [e.fromStatus, e.toStatus]).filter((s): s is BookingStatus => !!s))]
    : null;

  const mailResult = (mailSent: ReactNode) =>
    sp.mail === 'sent'
      ? mailSent
      : sp.mail === 'failed'
        ? 'お客様へのメールを送信できませんでした。お電話などでお伝えください（「メールを送り直す」からもう一度送れます）。'
        : sp.mail === 'unknown'
          ? 'お客様へのメールの送信結果を確認できませんでした。届いていない場合は、少し待ってから「メールを送り直す」を押してください。'
          : sp.mail === 'skipped'
            ? 'メールアドレスがないため、お客様へのメールは送っていません。'
            : null;
  const opMailResult =
    sp.opMail === 'sent'
      ? { tone: 'success' as const, text: '実施事業者にもメールで知らせました。' }
      : sp.opMail === 'failed' || sp.opMail === 'unknown'
        ? {
            tone: 'warning' as const,
            text: '実施事業者へのメールを送れませんでした。お電話などで事業者に伝えてください。',
          }
        : sp.opMail === 'skipped'
          ? {
              tone: 'warning' as const,
              text: '実施事業者のメールアドレスが未登録のため、事業者へのメールは送っていません。お電話などで伝えてください。',
            }
          : null;
  const changed = ownValue<string>(CHANGED, sp.changed);
  const requestedCount = Number(sp.requested) || 0;
  const unsentCount = Number(sp.unsent) || 0;

  const notifyBox = (label: string) => (
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        name="notify"
        value="on"
        defaultChecked={Boolean(b.contactEmail)}
        disabled={!b.contactEmail}
        className="mt-0.5 size-4"
      />
      <span>
        {label}
        {!b.contactEmail && <span className="block text-xs text-slate-600">メールアドレスがないため送れません</span>}
      </span>
    </label>
  );
  const notifyOperatorBox = (label: string) =>
    b.operatorName && (
      <label className="flex items-start gap-2">
        <input type="checkbox" name="notifyOperator" value="on" defaultChecked className="mt-0.5 size-4" />
        <span>{label}</span>
      </label>
    );
  // 日時・人数の変更：確定前は事業者の回答が回答待ちに戻る。確定後は実施事業者へ知らせられる
  const reopenNote = isOpenRequest(b.status) && activeRequests.length > 0 && (
    <p className="text-xs text-amber-800">
      事業者の回答は回答待ちに戻り、新しい内容で受入確認の依頼メールを送り直します。
    </p>
  );
  const changeNotifyBox = (label: string) =>
    b.status === 'confirmed' &&
    b.operatorName && (
      <label className="flex items-start gap-2">
        <input type="checkbox" name="notifyOperator" value="on" defaultChecked className="mt-0.5 size-4" />
        <span>{label}</span>
      </label>
    );
  const noteBox = (label: string, placeholder?: string) => (
    <label className="block space-y-1">
      <span className="block font-medium">{label}</span>
      <Textarea name="note" rows={2} maxLength={500} placeholder={placeholder} />
    </label>
  );

  const next = nextStatusesFor(b.status, b.paymentMethod);
  const dueForRequest = next.includes('awaiting_payment')
    ? paymentDueAt({ now, startsAt: b.startsAt, days: b.settings.paymentDueDays, timezone: b.timezone })
    : null;
  const instructionsMissing = b.paymentMethod === 'online' && !b.settings.paymentInstructions;
  // 取消を実施事業者に知らせるのは、確定後か、その事業者に照会していたとき（サーバーと同じ判定）
  const operatorWasAsked = b.status === 'confirmed' || Boolean(assignedRequest);
  /** 実施事業者が決まって先へ進める操作（支払案内・確定。サーバーと同じ判定） */
  const decides = (to: BookingStatus) => to === 'awaiting_payment' || (to === 'confirmed' && isOpenRequest(b.status));
  // 支払案内のあとに日時・人数を変えて、実施事業者へ照会し直したか（確定の前に、もう一度確かめる）
  const paymentRequestedAt = history.events
    .filter((e) => e.toStatus === 'awaiting_payment' && e.fromStatus !== 'awaiting_payment')
    .reduce<Date | null>((latest, e) => (!latest || e.at > latest ? e.at : latest), null);
  const reopenedAfterPayment =
    b.status === 'awaiting_payment' &&
    Boolean(assignedRequest) &&
    (!paymentRequestedAt || assignedRequest!.requestedAt > paymentRequestedAt);
  /** 実施事業者の回答を確かめる段階か（支払案内の前、または支払案内のあとに照会し直したとき） */
  const checkingOperator = BEFORE_PAYMENT_REQUEST.has(b.status) || reopenedAfterPayment;
  const needsOperatorConfirm = checkingOperator && assignedRequest?.status !== 'accepted';

  /**
   * 支払案内・現地払いの確定の前に、事業者の回答を見せて確かめる。実施事業者の回答が受入可でなければ、
   * 電話での確認・条件の調整が済んだことを必須のチェックで残す
   */
  const operatorCheck = (
    <div className="space-y-2">
      {activeRequests.length > 0 && (
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="mb-1 font-medium">受入確認の回答</p>
          <ul className="space-y-1 text-xs">
            {activeRequests.map((r) => (
              <li key={r.id}>
                <span className="font-semibold">{r.operatorName}</span>：{REQUEST_STATUS_LABELS[r.status]}
                {r.operatorId === b.operatorId && '（実施事業者）'}
                {r.responseNote && <span className="block text-slate-700">「{r.responseNote}」</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {b.operatorName && needsOperatorConfirm && (
        <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <input
            type="checkbox"
            name="operatorChecked"
            value={assignedRequest?.status === 'conditional' ? 'conditional' : 'phone'}
            required
            className="mt-0.5 size-4"
          />
          <span>
            <span className="block font-medium">
              {assignedRequest?.status === 'conditional'
                ? `${b.operatorName} の条件をお客様と調整し、事業者と合意しました`
                : assignedRequest?.status === 'pending'
                  ? `${b.operatorName} の回答を待たずに進めます（電話などで受入を確認しました）`
                  : `${b.operatorName} に受入を確認しました（電話など）`}
            </span>
            <span className="block text-xs text-slate-700">確認したことを履歴に残します。</span>
          </span>
        </label>
      )}
      {b.operatorName && needsOperatorConfirm && assignedRequest?.status === 'conditional' && (
        <label className="block space-y-1">
          <span className="block font-medium">合意した内容（必須・履歴に残します）</span>
          <Textarea
            name="operatorAgreement"
            rows={2}
            maxLength={300}
            required
            placeholder="例：送迎なし・集合場所はマリーナ受付で合意"
          />
          <span className="block text-xs text-slate-600">
            条件が日時・人数の変更なら、先に「日時の変更」「人数・料金の変更」で直してください（直すと、事業者の回答は回答待ちに戻ります）。
          </span>
        </label>
      )}
    </div>
  );

  /** 押せない理由（開始前の催行済み・支払方法の案内が未設定など）。押せるときは null */
  const blockedReason = (to: BookingStatus): ReactNode => {
    if ((to === 'completed' || to === 'no_show') && !started) {
      return `開始時刻（${at(b.startsAt)}）を過ぎると記録できます。`;
    }
    if (decides(to) && !b.operatorName) {
      return '実施事業者を決めてから進めてください（「実施事業者」で選ぶか、受入確認を依頼してください）。';
    }
    if (decides(to) && assignedRequest?.status === 'declined') {
      return `実施事業者「${b.operatorName}」は受入不可と回答しています。別の事業者を選ぶか、日時の変更・取消を検討してください。`;
    }
    if (to === 'awaiting_payment' && instructionsMissing) {
      return (
        <>
          支払方法の案内が未設定です。
          <Link href="/admin/settings" className="font-semibold text-sky-800 underline">
            設定
          </Link>
          で振込先などを入れてから送ってください。
        </>
      );
    }
    return null;
  };

  /** 次の操作として勧めるもの（目立たせる）。事業者の回答待ちのあいだは勧めない */
  const recommended: BookingStatus | null = BEFORE_PAYMENT_REQUEST.has(b.status)
    ? assignedRequest?.status === 'accepted'
      ? b.paymentMethod === 'onsite'
        ? 'confirmed'
        : 'awaiting_payment'
      : null
    : b.status === 'awaiting_payment'
      ? 'confirmed'
      : b.status === 'confirmed'
        ? started
          ? 'completed'
          : null
        : b.status === 'completed'
          ? 'verified'
          : b.status === 'verified'
            ? 'settled'
            : null;

  /** 次の状態へ進めるボタン（確認ダイアログつき）。勧める操作だけを目立たせる */
  const transition = (to: BookingStatus) => {
    const danger = to === 'cancelled' || to === 'weather_cancelled' || to === 'no_show';
    const ending = to === 'cancelled' || to === 'weather_cancelled';
    const blocked = blockedReason(to);
    const primary = to === recommended && !blocked;
    const label =
      b.status === 'operator_checking' && to === 'reviewing'
        ? '内容確認に戻す'
        : (BOOKING_TRANSITION_LABELS[to as keyof typeof BOOKING_TRANSITION_LABELS] ?? BOOKING_STATUS_LABELS[to]);
    const mailLabel =
      to === 'awaiting_payment'
        ? 'お客様に支払案内メールを送る'
        : to === 'confirmed'
          ? 'お客様に予約確定メールを送る'
          : to === 'weather_cancelled'
            ? 'お客様に天候中止のお知らせメールを送る'
            : to === 'cancelled'
              ? 'お客様に取消のお知らせメールを送る'
              : null;
    return (
      <form key={to} action={changeStatusAction.bind(null, b.id)}>
        {backField}
        <input type="hidden" name="to" value={to} />
        <ConfirmDialog
          tone={danger ? 'danger' : 'default'}
          triggerLabel={label}
          triggerClassName={cn(
            'w-full',
            primary && 'border-sky-700 bg-sky-700 text-white hover:bg-sky-800 hover:text-white',
          )}
          disabled={Boolean(blocked)}
          title={`「${BOOKING_STATUS_LABELS[to]}」にしますか？`}
          confirmLabel={label}
          pendingLabel="保存中…"
        >
          <p className="rounded-lg bg-slate-50 p-3">
            {b.contactName} 様 ・ {at(b.startsAt)} ・ {b.partySize}
            {unit} ・ {formatYen(b.totalAmount)}
          </p>
          {TRANSITION_HELP[to] && <p>{TRANSITION_HELP[to]}</p>}

          {to === 'awaiting_payment' && (
            <>
              <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 rounded-lg border border-slate-200 p-3">
                <dt className="text-slate-600">案内する金額</dt>
                <dd className="font-semibold tabular-nums">{formatYen(b.totalAmount)}</dd>
                <dt className="text-slate-600">支払方法</dt>
                <dd>{PAYMENT_METHOD_LABELS[b.paymentMethod]}</dd>
                {b.paymentMethod === 'online' && dueForRequest && (
                  <>
                    <dt className="text-slate-600">支払期限</dt>
                    <dd className="tabular-nums">
                      {at(dueForRequest)}
                      <span className="block text-xs text-slate-600">
                        今日から {b.settings.paymentDueDays} 日（体験の前日までに収まるように調整）
                      </span>
                    </dd>
                  </>
                )}
              </dl>
              {b.paymentMethod === 'online' && b.settings.paymentInstructions && (
                <div className="space-y-1">
                  <p className="font-medium">メールに載せる支払方法の案内</p>
                  <p className="max-h-32 overflow-y-auto rounded-lg bg-slate-50 p-3 text-xs whitespace-pre-line">
                    {b.settings.paymentInstructions}
                  </p>
                </div>
              )}
            </>
          )}
          {decides(to) && checkingOperator && operatorCheck}

          {to === 'confirmed' && b.paymentMethod === 'online' && !paid && (
            <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
              <legend className="px-1 font-medium">入金の記録</legend>
              <AmountField
                name="paymentAmount"
                label="入金額（円）"
                required
                expected={payment?.amount ?? b.totalAmount}
                expectedLabel="案内した金額"
                defaultValue={payment?.amount ?? b.totalAmount}
              />
              <label className="block space-y-1">
                <span className="block">入金日</span>
                <Input
                  name="paymentReceivedOn"
                  type="date"
                  required
                  defaultValue={today}
                  max={today}
                  className="w-44"
                />
              </label>
              <label className="block space-y-1">
                <span className="block">入金のメモ（振込名義など・任意）</span>
                <Input name="paymentNote" maxLength={200} />
              </label>
            </fieldset>
          )}
          {to === 'confirmed' && b.paymentMethod === 'onsite' && (
            <p className="text-slate-700">
              現地払いの予約のため、支払案内は送らずに確定します。当日、実施事業者がお客様から受け取ります。
            </p>
          )}

          {ending && (
            <>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  {b.partySize}
                  {unit}分の枠が回に戻ります。
                </li>
                <li className="font-semibold text-red-700">取り消すと元に戻せません。</li>
              </ul>
              {to === 'cancelled' && (
                <label className="block space-y-1">
                  <span className="block font-medium">取消の区分（必須）</span>
                  <select name="cancelCategory" required defaultValue="" className={cn(SELECT_CLASS, 'w-full')}>
                    <option value="" disabled>
                      選んでください
                    </option>
                    {CANCEL_CATEGORIES.filter((c) => c !== 'weather').map((c) => (
                      <option key={c} value={c}>
                        {CANCEL_CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {payment && (payment.status === 'paid' || payment.status === 'partially_refunded') && (
                <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <AmountField
                    name="refundDueAmount"
                    label="返金予定額（円・必須）"
                    required
                    refund
                    expected={payment.amount}
                    expectedLabel="入金額"
                    defaultValue={to === 'weather_cancelled' ? payment.amount : ''}
                    hint={`入金額 ${formatYen(payment.amount)} から、キャンセル料を差し引いた額を入れます。`}
                  />
                  {policyText && (
                    <details className="text-xs">
                      <summary className="cursor-pointer font-semibold text-sky-800">
                        申込時に同意したキャンセル規定を見る
                      </summary>
                      <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-line text-slate-700">{policyText}</p>
                    </details>
                  )}
                </div>
              )}
              {b.operatorName && operatorWasAsked && (
                <label className="block space-y-1">
                  <span className="block font-medium">実施事業者への連絡（任意・事業者に伝えます）</span>
                  <Textarea
                    name="cancelOperatorNote"
                    rows={2}
                    maxLength={500}
                    placeholder="例：お客様のご都合で取消。キャンセル料は組合で精算します"
                  />
                </label>
              )}
            </>
          )}

          {noteBox(
            ending ? '取消の理由（組合用・お客様には送りません）' : '履歴に残すメモ（任意）',
            to === 'cancelled' ? '例：お客様から電話で取消の連絡' : undefined,
          )}
          {mailLabel && notifyBox(mailLabel)}
          {to === 'confirmed' && notifyOperatorBox('実施事業者に予約確定をメールで知らせる')}
          {ending && operatorWasAsked && notifyOperatorBox('実施事業者にもメールで知らせる')}
          {(ending || decides(to)) &&
            activeRequests.some(
              (r) => r.operatorId !== b.operatorId && (r.status === 'accepted' || r.status === 'conditional'),
            ) && (
              <p className="text-xs text-slate-600">
                受入可・条件付きで回答していたほかの事業者には、受入確認の終了をメールで知らせます。
              </p>
            )}
        </ConfirmDialog>
        {blocked && <p className="mt-1 text-xs text-slate-600">{blocked}</p>}
      </form>
    );
  };

  const isException = (s: BookingStatus) => s === 'cancelled' || s === 'weather_cancelled' || s === 'no_show';
  // 勧める操作を先頭に、「電話で確認中として記録」「内容確認に戻す」は後ろに並べる
  const order = (s: BookingStatus) => (s === recommended ? 0 : s === 'operator_checking' || s === 'reviewing' ? 2 : 1);
  const forward = next.filter((s) => !isException(s)).sort((x, y) => order(x) - order(y));
  const exceptional = next.filter(isException);

  const paymentLabel = !payment
    ? '—'
    : payment.status === 'pending' && BEFORE_PAYMENT_REQUEST.has(b.status)
      ? '案内前'
      : payment.status === 'pending' && b.paymentMethod === 'onsite'
        ? '当日お支払い'
        : PAYMENT_STATUS_LABELS[payment.status];
  const report = b.reportResult ? (b.reportResult as ReportResult) : null;
  // 貸切（艇で数えるプラン）の実績は乗船人数（名）で報告される
  const charter = unit !== '名';
  const bookedCount = charter ? b.guestCount : b.partySize;
  const reportUnit = charter ? '名' : unit;
  // 照会済みの事業者があれば、照会のフォームは畳んでおく（回答の一覧を先に見せる）
  const collapseIfRequested = (form: ReactNode) =>
    requests.length > 0 ? (
      <details className="mt-3 border-t border-slate-100 pt-3">
        <summary
          className={cn(
            buttonVariants({ variant: 'outline' }),
            'h-9 cursor-pointer list-none px-3 text-sm [&::-webkit-details-marker]:hidden',
          )}
        >
          ほかの事業者にも照会する・依頼を送り直す
        </summary>
        <div className="mt-3">{form}</div>
      </details>
    ) : (
      form
    );
  const operatorLocked = ['completed', 'verified', 'settled', 'no_show'].includes(b.status);
  const pricesById = new Map((priceSet?.prices ?? []).map((p) => [p.id, p]));
  const retiredItems = b.items.filter((i) => !pricesById.has(i.priceId));

  return (
    <div className="max-w-5xl">
      <PageHeader
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="tabular-nums">予約 {b.bookingNo}</span>
            <BookingStatusBadge status={b.status} className="text-sm" />
          </span>
        }
        description={`${b.contactName} 様 ・ ${at(b.startsAt)} ・ ${splitPlanTitle(b.menuTitle).title}`}
        actions={
          <Link href={`/admin/slots/${b.slotId}`} className={buttonVariants({ variant: 'outline' })}>
            この回を見る
          </Link>
        }
      />
      <div className="space-y-4">
        {sp.created && (
          <Notice tone="success">
            予約を登録しました。{mailResult('お客様にメールを送信しました。')}
            {opMailResult?.tone === 'success' && ` ${opMailResult.text}`}
          </Notice>
        )}
        {sp.created && opMailResult?.tone === 'warning' && <Notice tone="warning">{opMailResult.text}</Notice>}
        {/* 状態の変更・事業者の変更の結果は、成功と注意を 1 つずつにまとめて出す */}
        {(changed || sp.saved === 'operator') && (
          <Notice tone="success">
            {[
              changed ?? '実施事業者を保存しました。',
              sp.mail === 'sent' && 'お客様にメールを送信しました。',
              opMailResult?.tone === 'success' && opMailResult.text,
            ]
              .filter(Boolean)
              .join(' ')}
          </Notice>
        )}
        {(sp.changed || sp.resent || sp.moved || sp.saved === 'operator' || sp.saved === 'items') &&
          ((sp.mail && sp.mail !== 'off' && sp.mail !== 'sent') || opMailResult?.tone === 'warning') && (
            <Notice tone="warning">
              {[
                sp.mail && sp.mail !== 'off' && sp.mail !== 'sent' && mailResult(null),
                opMailResult?.tone === 'warning' && opMailResult.text,
              ]
                .filter(Boolean)
                .join(' ')}
            </Notice>
          )}
        {sp.resent && sp.mail === 'sent' && (
          <Notice tone="success">
            {ownValue(MAIL_KIND_LABELS, sp.resent) ?? 'メール'}
            を送り直しました。以前のメールのリンクもそのまま使えます。
          </Notice>
        )}
        {sp.moved && (
          <Notice tone="success">
            日時を変更しました。{sp.mail === 'sent' && 'お客様に変更後の内容をメールで送りました。'}
            {opMailResult?.tone === 'success' && ` ${opMailResult.text}`}
          </Notice>
        )}
        {sp.refunded && <Notice tone="success">返金を記録しました。</Notice>}
        {sp.saved === 'note' && <Notice tone="success">組合メモを保存しました。</Notice>}
        {sp.saved === 'items' && (
          <Notice tone="success">
            人数・料金を変更しました。{opMailResult?.tone === 'success' && ` ${opMailResult.text}`}
            {paid && payment && payment.amount !== b.totalAmount && (
              <>
                {' '}
                入金額 {formatYen(payment.amount)} と新しい料金 {formatYen(b.totalAmount)} の差額（
                {formatYen(Math.abs(b.totalAmount - payment.amount))}）は、お客様と別に精算してください。
              </>
            )}
          </Notice>
        )}
        {sp.saved === 'withdrawn' && <Notice tone="success">照会を取り下げました。</Notice>}
        {requestedCount > 0 && (
          <Notice tone={unsentCount > 0 ? 'warning' : 'success'}>
            {requestedCount} 社へ受入確認を依頼しました。
            {unsentCount > 0 &&
              `うち ${unsentCount} 社にはメールを送れませんでした（メールアドレスが未登録など）。事業者画面には出ているので、お電話などでも伝えてください。`}
          </Notice>
        )}
        {errorText && <Notice tone="error">{errorText}</Notice>}
        {overdue && (
          <Notice tone="error">
            支払期限（{at(payment!.dueAt!)}）を過ぎています。お客様に確認するか、取り消してください。
          </Notice>
        )}
        {reopenedAfterPayment && assignedRequest?.status === 'pending' && (
          <Notice tone="warning">
            支払案内のあとに内容を変えたため、実施事業者「{b.operatorName}
            」の回答を待っています。回答を待たずに確定するときは、電話などで受入を確認してください。
          </Notice>
        )}
        {checkingOperator &&
          assignedRequest &&
          (assignedRequest.status === 'declined' || assignedRequest.status === 'conditional') && (
            <Notice tone="warning">
              実施事業者「{b.operatorName}」の回答は「{REQUEST_STATUS_LABELS[assignedRequest.status]}」です。
              {assignedRequest.status === 'declined'
                ? '別の事業者へ照会するか、日時の変更・取消を検討してください。'
                : '条件をお客様と調整してから進めてください。'}
              {assignedRequest.responseNote && (
                <span className="mt-1 block">事業者のメモ：{assignedRequest.responseNote}</span>
              )}
            </Notice>
          )}
        {report && report !== 'done' && b.status === 'confirmed' && (
          <Notice tone="warning">
            実施事業者から「{REPORT_RESULT_LABELS[report]}
            」の報告があります。返金の扱いを決めて、取消・天候中止・無断キャンセルのどれかにしてください。
          </Notice>
        )}
        {report === 'done' &&
          b.actualPartySize !== null &&
          bookedCount !== null &&
          b.actualPartySize !== bookedCount &&
          b.status === 'completed' && (
            <Notice tone="warning">
              {charter ? '実績の乗船人数' : '実績人数'}（{b.actualPartySize}
              {reportUnit}）が予約の{charter ? '乗船人数' : '人数'}（{bookedCount}
              {reportUnit}
              ）と違います。料金に関わるときは「人数・料金の変更」で直してから、実績を確認済みにしてください。
            </Notice>
          )}
        {operatorSuspended && !['cancelled', 'weather_cancelled', 'settled'].includes(b.status) && (
          <Notice tone="warning">
            実施事業者「{b.operatorName}
            」は利用停止中です。事業者画面に入れないため、お電話などで連絡するか、「実施事業者」で別の事業者に変えてください。
          </Notice>
        )}
        {!b.operatorName && b.status !== 'cancelled' && b.status !== 'weather_cancelled' && (
          <Notice tone="warning">実施事業者が割り当てられていません。「実施事業者」で選んでください。</Notice>
        )}

        <BookingFlow status={b.status} visited={visited} />

        <div className="grid gap-4 md:grid-cols-[1fr_19rem] md:items-start">
          <div className="order-2 space-y-4 md:order-none">
            <Panel title="予約内容">
              <dl className="divide-y divide-slate-100 text-sm">
                {rows.map(([label, value]) => (
                  <div key={label} className="grid gap-1 py-2.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
                    <dt className="text-slate-600">{label}</dt>
                    <dd className="font-medium whitespace-pre-line text-slate-900">{value}</dd>
                  </div>
                ))}
              </dl>
            </Panel>

            {requestRows.length > 0 && (
              <Panel title="お客様からの申込内容">
                <dl className="divide-y divide-slate-100 text-sm">
                  {requestRows.map(([label, value]) => (
                    <div key={label} className="grid gap-1 py-2.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
                      <dt className="text-slate-600">{label}</dt>
                      <dd className="font-medium whitespace-pre-line text-slate-900">{value}</dd>
                    </div>
                  ))}
                </dl>
              </Panel>
            )}

            {(canRequest || requests.length > 0) && (
              <section id="operator-requests" className="scroll-mt-6">
                <Panel
                  title="事業者への受入確認"
                  description="候補の事業者に、事業者画面とメールで空き・受入可否を照会します。「受入可」の回答があると、組合が実施事業者を選んでいなければ、その事業者を実施事業者にします。"
                >
                  {requests.length > 0 && (
                    <ul className="divide-y divide-slate-100 text-sm">
                      {requests.map((r) => (
                        <li key={r.id} className="space-y-1 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900">{r.operatorName}</span>
                            <span
                              className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', REQUEST_TONE[r.status])}
                            >
                              {REQUEST_STATUS_LABELS[r.status]}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 tabular-nums">
                            依頼 {at(r.requestedAt)}
                            {r.respondedAt &&
                              ` ・ 回答 ${at(r.respondedAt)}${r.respondedByName ? `（${r.respondedByName}）` : ''}`}
                          </p>
                          {r.requestNote && (
                            <p className="whitespace-pre-line text-slate-700">依頼のメモ：{r.requestNote}</p>
                          )}
                          {r.responseNote && (
                            <p className="rounded-lg bg-slate-50 p-2 whitespace-pre-line text-slate-900">
                              事業者のメモ：{r.responseNote}
                            </p>
                          )}
                          {r.status !== 'withdrawn' &&
                            isOpenRequest(b.status) &&
                            !(b.status === 'awaiting_payment' && r.operatorId === b.operatorId) && (
                              <form action={withdrawRequestAction.bind(null, b.id)}>
                                {backField}
                                <input type="hidden" name="requestId" value={r.id} />
                                <ConfirmDialog
                                  tone="default"
                                  triggerLabel="取り下げる"
                                  triggerClassName="h-8 px-3 text-xs"
                                  title={`「${r.operatorName}」への照会を取り下げますか？`}
                                  confirmLabel="取り下げる"
                                  pendingLabel="保存中…"
                                >
                                  <p>
                                    事業者画面の照会は「受付終了」になり、回答できなくなります。事業者へのメールは送りません。
                                    {r.operatorId === b.operatorId
                                      ? '実施事業者の割り当ては変わらないため、必要なら「実施事業者」で変えてください。'
                                      : ''}
                                  </p>
                                </ConfirmDialog>
                              </form>
                            )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {canRequest &&
                    collapseIfRequested(
                      <form action={requestOperatorAction.bind(null, b.id)} className="space-y-3 text-sm">
                        {backField}
                        {candidates.length === 0 ? (
                          <p className="text-slate-600">
                            照会できる事業者がいません。
                            <Link href="/admin/operators" className="font-semibold text-sky-800 underline">
                              事業者
                            </Link>
                            を登録してください。
                          </p>
                        ) : (
                          <>
                            <fieldset className="space-y-2">
                              <legend className="mb-1 font-medium">照会する事業者</legend>
                              {menuCandidates.length === 0 && (
                                <p className="text-xs text-slate-600">
                                  このプランの実施候補が未設定のため、すべての事業者を出しています（プランの編集で実施候補を設定できます）。
                                </p>
                              )}
                              {candidates.map((o) => {
                                const existing = requests.find(
                                  (r) => r.operatorId === o.id && r.status !== 'withdrawn',
                                );
                                const to = recipients.get(o.id) ?? [];
                                return (
                                  <label
                                    key={o.id}
                                    className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 has-checked:border-sky-600 has-checked:bg-sky-50"
                                  >
                                    <input type="checkbox" name="operatorId" value={o.id} className="size-4" />
                                    <span className="min-w-0 flex-1">
                                      {o.name}
                                      {to.length === 0 ? (
                                        <span className="block text-xs text-amber-800">
                                          メールの送り先なし（事業者画面には出ます。電話でも伝えてください）
                                        </span>
                                      ) : (
                                        <span className="block truncate text-xs text-slate-600">
                                          送り先：{to.join('、')}
                                        </span>
                                      )}
                                      {existing && existing.status !== 'pending' && (
                                        <span className="block text-xs text-amber-800">
                                          選ぶと、前の回答（{REQUEST_STATUS_LABELS[existing.status]}
                                          ）は回答待ちに戻ります
                                        </span>
                                      )}
                                      {existing?.status === 'pending' && (
                                        <span className="block text-xs text-slate-600">
                                          選ぶと、依頼のメールをもう一度送ります
                                        </span>
                                      )}
                                    </span>
                                    {existing && (
                                      <span className="shrink-0 text-xs text-slate-600">
                                        照会済み（{REQUEST_STATUS_LABELS[existing.status]}）
                                      </span>
                                    )}
                                  </label>
                                );
                              })}
                            </fieldset>
                            <label className="block space-y-1">
                              <span className="block font-medium">事業者へのメモ（任意）</span>
                              <Textarea
                                name="note"
                                rows={2}
                                maxLength={500}
                                placeholder="例：第2希望の日時でも可能か教えてください"
                              />
                            </label>
                            <p className="text-xs text-slate-600">
                              事業者には、日時・プラン・人数・年齢・ご連絡事項だけを伝えます（お客様の連絡先は予約確定まで伝えません）。
                            </p>
                            <SubmitButton pendingLabel="依頼中…">受入確認を依頼する</SubmitButton>
                          </>
                        )}
                      </form>,
                    )}
                </Panel>
              </section>
            )}

            {report && (
              <Panel title="事業者の催行報告">
                <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-600">報告</dt>
                    <dd className="font-semibold">{REPORT_RESULT_LABELS[report] ?? report}</dd>
                  </div>
                  {b.actualPartySize !== null && (
                    <div>
                      <dt className="text-slate-600">{charter ? '実績の乗船人数' : '実績人数'}</dt>
                      <dd className="font-medium tabular-nums">
                        {b.actualPartySize}
                        {reportUnit}
                        {bookedCount !== null && `（予約 ${bookedCount}${reportUnit}）`}
                      </dd>
                    </div>
                  )}
                  {b.reportedAt && (
                    <div>
                      <dt className="text-slate-600">報告日時</dt>
                      <dd className="tabular-nums">{at(b.reportedAt)}</dd>
                    </div>
                  )}
                  {b.reportNote && (
                    <div className="sm:col-span-2">
                      <dt className="text-slate-600">メモ</dt>
                      <dd className="whitespace-pre-line">{b.reportNote}</dd>
                    </div>
                  )}
                </dl>
              </Panel>
            )}

            <Panel title="入金・返金">
              <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-600">支払方法</dt>
                  <dd className="font-medium">{PAYMENT_METHOD_LABELS[b.paymentMethod]}</dd>
                </div>
                <div>
                  <dt className="text-slate-600">状況</dt>
                  <dd className="font-medium">{paymentLabel}</dd>
                </div>
                {payment?.dueAt && (
                  <div>
                    <dt className="text-slate-600">支払期限</dt>
                    <dd className={cn('font-medium tabular-nums', overdue && 'text-red-700')}>{at(payment.dueAt)}</dd>
                  </div>
                )}
                {payment?.receivedAt && (
                  <div>
                    <dt className="text-slate-600">入金</dt>
                    <dd className="font-medium tabular-nums">
                      {formatYen(payment.amount)}（{formatDateLabel(payment.receivedAt, b.timezone)}）
                      {payment.amount !== b.totalAmount && (
                        <span className="block text-xs text-amber-800">
                          料金 {formatYen(b.totalAmount)} と入金額が違います
                        </span>
                      )}
                    </dd>
                  </div>
                )}
                {payment?.refundDueAmount !== null && payment?.refundDueAmount !== undefined && (
                  <div>
                    <dt className="text-slate-600">返金予定額</dt>
                    <dd className="font-medium tabular-nums">
                      {formatYen(payment.refundDueAmount)}
                      {payment.refundDueAmount > payment.refundedAmount && (
                        <span className="block text-xs text-amber-800">
                          未返金 {formatYen(payment.refundDueAmount - payment.refundedAmount)}
                        </span>
                      )}
                    </dd>
                  </div>
                )}
                {payment && payment.refundedAmount > 0 && (
                  <div>
                    <dt className="text-slate-600">返金済み</dt>
                    <dd className="font-medium tabular-nums">
                      {formatYen(payment.refundedAmount)}
                      {payment.refundedAt && `（${formatDateLabel(payment.refundedAt, b.timezone)}）`}
                    </dd>
                  </div>
                )}
                {payment?.note && (
                  <div className="sm:col-span-2">
                    <dt className="text-slate-600">メモ</dt>
                    <dd className="whitespace-pre-line">{payment.note}</dd>
                  </div>
                )}
              </dl>
              {payment &&
                (payment.status === 'paid' || payment.status === 'partially_refunded') &&
                (payment.refundDueAmount ?? payment.amount) > payment.refundedAmount && (
                  <form
                    action={recordRefundAction.bind(null, b.id)}
                    className="mt-4 border-t border-slate-100 pt-4 text-sm"
                  >
                    {backField}
                    <ConfirmDialog
                      tone="default"
                      triggerLabel="返金を記録…"
                      title="返金を記録しますか？"
                      confirmLabel="返金を記録"
                      pendingLabel="保存中…"
                    >
                      <p>
                        振込などで返金したあとに、金額と日付を残します。記録した返金は取り消せません（入金額{' '}
                        {formatYen(payment.amount)}
                        、返金済み {formatYen(payment.refundedAmount)}）。
                      </p>
                      <AmountField
                        name="amount"
                        label="今回の返金額（円）"
                        required
                        expected={Math.max(0, (payment.refundDueAmount ?? payment.amount) - payment.refundedAmount)}
                        expectedLabel={payment.refundDueAmount !== null ? '未返金の予定額' : '返金できる残り'}
                        defaultValue={
                          payment.refundDueAmount !== null
                            ? Math.max(0, payment.refundDueAmount - payment.refundedAmount) || ''
                            : ''
                        }
                      />
                      <label className="block space-y-1">
                        <span className="block">返金日</span>
                        <Input
                          name="refundedOn"
                          type="date"
                          required
                          defaultValue={today}
                          max={today}
                          className="w-44"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="block">メモ（任意）</span>
                        <Input name="note" maxLength={200} placeholder="例：振込で返金" />
                      </label>
                    </ConfirmDialog>
                  </form>
                )}
            </Panel>

            {itemsEditable && priceSet && (
              <Panel
                title="人数・料金の変更"
                description="電話での人数変更や、当日の実績人数に合わせて直します。料金は、この回の日付の料金で計算し直します。"
              >
                <details className="text-sm" open={sp.error === 'SLOT_FULL' || sp.error === 'INVALID_ITEMS'}>
                  <summary className="cursor-pointer font-semibold text-sky-800">人数を変える</summary>
                  <form action={changeItemsAction.bind(null, b.id)} className="mt-3 space-y-3">
                    {backField}
                    {priceSet.prices.some((p) => p.season) && (
                      <p className="text-xs text-slate-600">料金は{SEASON_LABELS[priceSet.season]}です。</p>
                    )}
                    <div className="grid gap-2 sm:grid-cols-2">
                      {priceSet.prices.map((p) => (
                        <label
                          key={p.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
                        >
                          <span>
                            <span className="block font-medium">{p.label}</span>
                            <span className="text-xs text-slate-600 tabular-nums">{formatYen(p.price)}</span>
                          </span>
                          <Input
                            name={`qty.${p.id}`}
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={500}
                            defaultValue={b.items.find((i) => i.priceId === p.id)?.quantity ?? 0}
                            className="w-20 text-right tabular-nums"
                            aria-label={`${p.label}の${unit === '名' ? '人数' : '数'}`}
                          />
                        </label>
                      ))}
                    </div>
                    {retiredItems.length > 0 && (
                      <p className="text-xs text-amber-800">
                        {retiredItems.map((i) => i.label).join('・')}
                        は今の料金表にないため、上の区分から選び直してください。
                      </p>
                    )}
                    {unit !== '名' && (
                      <label className="block space-y-1">
                        <span className="block">乗船人数（必須）</span>
                        <Input
                          name="guestCount"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={200}
                          required
                          defaultValue={b.guestCount ?? ''}
                          className="w-24 tabular-nums"
                        />
                      </label>
                    )}
                    <label className="block space-y-1">
                      <span className="block">変更の理由（履歴に残します）</span>
                      <Input name="reason" maxLength={200} placeholder="例：お客様から電話で 1 名追加" />
                    </label>
                    {b.status !== 'completed' && (
                      <label className="block space-y-1">
                        <span className="block">定員を超えて受けるときの理由（そのときだけ）</span>
                        <Input name="overCapacityReason" maxLength={200} />
                      </label>
                    )}
                    {paid && (
                      <p className="text-xs text-amber-800">
                        入金済みの予約です。料金が変わったら、差額の精算（追加のお支払い・返金）を別に行ってください。
                      </p>
                    )}
                    {!paid && payment?.status === 'pending' && b.status === 'awaiting_payment' && (
                      <p className="text-xs text-slate-600">
                        支払案内の金額も新しい料金になります。必要なら「メールを送り直す」で案内し直してください。
                      </p>
                    )}
                    {reopenNote}
                    {changeNotifyBox('実施事業者に人数の変更をメールで知らせる')}
                    <SubmitButton variant="outline" pendingLabel="保存中…">
                      人数・料金を変更
                    </SubmitButton>
                  </form>
                </details>
              </Panel>
            )}

            {movable && (
              <Panel
                title="日時の変更"
                description="第 2 希望への振替などで、同じプランの別の回へ移します。料金は変わりません。"
              >
                <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
                  {listBack && <input type="hidden" name="back" value={listBack} />}
                  <label className="space-y-1">
                    <span className="block text-slate-600">移す日</span>
                    <Input name="move" type="date" defaultValue={moveDate ?? ''} min={today} className="w-44" />
                  </label>
                  <button type="submit" className={buttonVariants({ variant: 'outline' })}>
                    この日の回を見る
                  </button>
                </form>
                {moveDate && (
                  <form action={changeSlotAction.bind(null, b.id)} className="mt-4 space-y-3 text-sm">
                    {backField}
                    {moveSlots.length === 0 ? (
                      <p className="text-slate-600">この日にこのプランの回はありません。</p>
                    ) : (
                      <fieldset className="grid gap-2 sm:grid-cols-3">
                        <legend className="sr-only">移す先の回</legend>
                        {moveSlots.map((s) => {
                          const left = remainingSeats(s.capacity, s.reservedCount);
                          const current = s.id === b.slotId;
                          return (
                            <label
                              key={s.id}
                              className={cn(
                                'flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2',
                                current
                                  ? 'border-slate-200 bg-slate-50 text-slate-500'
                                  : 'border-slate-300 has-checked:border-sky-600 has-checked:bg-sky-50',
                              )}
                            >
                              <input
                                type="radio"
                                name="slotId"
                                value={s.id}
                                required
                                disabled={current || s.status !== 'open'}
                                className="size-4"
                              />
                              <span className="tabular-nums">
                                <span className="font-semibold">{localTime(s.startsAt, b.timezone)}</span>
                                <span className="ml-2 text-xs">
                                  {current ? '今の回' : s.status !== 'open' ? '休止' : `残り ${left}${unit}`}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </fieldset>
                    )}
                    {moveSlots.length > 0 && (
                      <>
                        <label className="block space-y-1">
                          <span className="block text-slate-600">
                            空きが足りない回へ移すときの理由（定員を超えて受けるときだけ）
                          </span>
                          <Input name="overCapacityReason" maxLength={200} />
                        </label>
                        <ConfirmDialog
                          tone="default"
                          triggerLabel="この回へ移す…"
                          title="選んだ回へ日時を変更しますか？"
                          confirmLabel="日時を変更"
                          pendingLabel="変更中…"
                        >
                          <p>
                            今の回（{at(b.startsAt)}）の枠を戻し、選んだ回で {b.partySize}
                            {unit}分の枠を押さえます。
                          </p>
                          {b.status === 'awaiting_payment' && (
                            <p>支払期限は、新しい日時に合わせて早まることがあります。</p>
                          )}
                          {reopenNote}
                          {changeNotifyBox('実施事業者に日時の変更をメールで知らせる')}
                          {notifyBox('お客様に変更後の内容をメールで送る')}
                        </ConfirmDialog>
                      </>
                    )}
                  </form>
                )}
              </Panel>
            )}

            <Panel title="状態の履歴">
              <ol className="space-y-3 text-sm">
                {timeline.map((e) => (
                  <li key={e.id} className="border-l-2 border-slate-200 pl-3">
                    <p className="font-semibold text-slate-900">{e.title}</p>
                    <p className="text-xs text-slate-600 tabular-nums">
                      {at(e.at)} ・ {e.who}
                    </p>
                    {e.note && <p className="mt-0.5 whitespace-pre-line text-slate-700">{e.note}</p>}
                  </li>
                ))}
              </ol>
            </Panel>

            <Panel title="メールの送信履歴">
              {mails.length === 0 ? (
                <p className="text-sm text-slate-600">
                  {b.contactEmail ? 'まだメールを送っていません。' : 'メールアドレスがないため、メールは送りません。'}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {mails.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        <span className="font-medium text-slate-900">{MAIL_TYPE_LABELS[m.type] ?? m.type}</span>
                        <span className="ml-2 text-xs text-slate-600 tabular-nums">{at(m.sentAt ?? m.createdAt)}</span>
                        <span className="block text-xs break-all text-slate-600">{m.toEmail}</span>
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                          m.status === 'sent'
                            ? 'bg-emerald-100 text-emerald-900'
                            : m.status === 'queued'
                              ? 'bg-slate-100 text-slate-700'
                              : m.status === 'unknown'
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-red-100 text-red-800',
                        )}
                        title={m.error ?? undefined}
                      >
                        {MAIL_STATUS_LABELS[m.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {/* スマホでは次の操作と代表者（電話・メール）を先に出す */}
          <div className="order-1 space-y-4 md:order-none">
            {next.length > 0 && (
              <Panel title="次の操作">
                <div className="flex flex-col gap-2">
                  {canRequest && pendingRequests.length > 0 && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                      事業者の回答待ち（{pendingRequests.map((r) => r.operatorName).join('・')}）
                    </p>
                  )}
                  {canRequest && activeRequests.length === 0 && (
                    <a
                      href="#operator-requests"
                      className={buttonVariants({
                        className: 'w-full border-sky-700 bg-sky-700 text-white hover:bg-sky-800',
                      })}
                    >
                      事業者へ受入確認を依頼する
                    </a>
                  )}
                  {forward.map((to) => transition(to))}
                  {exceptional.length > 0 && (
                    <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-3">
                      {exceptional.map((to) => transition(to))}
                    </div>
                  )}
                </div>
              </Panel>
            )}

            <Panel title="代表者">
              <p className="text-base font-semibold text-slate-900">{b.contactName} 様</p>
              <div className="mt-3 space-y-2">
                {phone ? (
                  <a
                    href={telHref(b.contactPhone!)}
                    className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 font-semibold text-sky-800 tabular-nums hover:bg-sky-50"
                  >
                    <Phone aria-hidden className="size-4" />
                    {phone}
                  </a>
                ) : (
                  <p className="text-sm text-slate-600">電話番号なし</p>
                )}
                {b.contactEmail ? (
                  <a
                    href={`mailto:${b.contactEmail}`}
                    className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm break-all text-sky-800 hover:bg-sky-50"
                  >
                    <Mail aria-hidden className="size-4 shrink-0" />
                    {b.contactEmail}
                  </a>
                ) : (
                  <p className="text-sm text-slate-600">メールアドレスなし</p>
                )}
              </div>
              {b.contactEmail && b.status !== 'no_show' && (
                <form action={resendMailAction.bind(null, b.id)} className="mt-3">
                  {backField}
                  <ConfirmDialog
                    tone="default"
                    triggerLabel="メールを送り直す"
                    triggerClassName="w-full"
                    title="メールを送り直しますか？"
                    confirmLabel="送り直す"
                    pendingLabel="送信中…"
                  >
                    <p>
                      {b.contactEmail} に、今の状態（{BOOKING_STATUS_LABELS[b.status]}）のメールを送ります。
                      以前に送ったメールのリンクも、そのまま使えます。
                    </p>
                  </ConfirmDialog>
                </form>
              )}
            </Panel>

            <Panel
              title="実施事業者"
              description={
                b.operatorAssignedVia === 'staff'
                  ? '組合が選んだ事業者です（照会の回答で自動には変わりません）。お客様には予約確定後に案内します。'
                  : 'お客様には予約確定後に案内します。'
              }
            >
              {operatorLocked ? (
                <p className="text-sm text-slate-700">
                  {b.operatorName ?? '未割り当て'}
                  <span className="block text-xs text-slate-600">
                    催行済み以降は変えられません（実績・精算の記録のため）。
                  </span>
                </p>
              ) : (
                <form action={assignOperatorAction.bind(null, b.id)} className="space-y-2 text-sm">
                  {backField}
                  <select
                    name="operatorId"
                    defaultValue={b.operatorId ?? ''}
                    className={cn(SELECT_CLASS, 'w-full')}
                    aria-label="実施事業者"
                  >
                    <option value="">未割り当て</option>
                    {operators.map((o) => (
                      <option key={o.id} value={o.id} disabled={o.status === 'suspended' && o.id !== b.operatorId}>
                        {o.name}
                        {o.status === 'suspended' ? '（停止中）' : ''}
                      </option>
                    ))}
                  </select>
                  {b.status === 'confirmed' ? (
                    // 確定後は、お客様に事業者名・当日の連絡先を案内済みなので、変える前に確かめて連絡する
                    <ConfirmDialog
                      tone="default"
                      triggerLabel="変更する…"
                      triggerClassName="w-full"
                      title="予約確定後に実施事業者を変えますか？"
                      confirmLabel="変更する"
                      pendingLabel="保存中…"
                    >
                      <p>
                        今の実施事業者：{b.operatorName ?? '未割り当て'}
                        。お客様には、確定メールでこの事業者の名前と当日の連絡先を案内しています。
                      </p>
                      <label className="flex items-start gap-2">
                        <input type="checkbox" name="notifyNew" value="on" defaultChecked className="mt-0.5 size-4" />
                        <span>新しい実施事業者に予約確定をメールで知らせる</span>
                      </label>
                      {b.operatorName && (
                        <label className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            name="notifyPrevious"
                            value="on"
                            defaultChecked
                            className="mt-0.5 size-4"
                          />
                          <span>{b.operatorName} に担当の変更をメールで知らせる</span>
                        </label>
                      )}
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          name="notifyCustomer"
                          value="on"
                          defaultChecked={Boolean(b.contactEmail)}
                          disabled={!b.contactEmail}
                          className="mt-0.5 size-4"
                        />
                        <span>お客様に、新しい事業者と当日の連絡先を載せた予約確定メールを送り直す</span>
                      </label>
                    </ConfirmDialog>
                  ) : (
                    <SubmitButton variant="outline" className="w-full" pendingLabel="保存中…">
                      保存
                    </SubmitButton>
                  )}
                </form>
              )}
            </Panel>

            <Panel title="組合メモ" description="お客様・事業者には見えません。書き換えた人と日時は履歴に残ります。">
              <form action={saveAdminNoteAction.bind(null, b.id)} className="space-y-2">
                {backField}
                <Textarea name="adminNote" rows={4} maxLength={2000} defaultValue={b.adminNote} aria-label="組合メモ" />
                <SubmitButton variant="outline" className="w-full" pendingLabel="保存中…">
                  メモを保存
                </SubmitButton>
              </form>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
