import { Mail, Phone } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConfirmDialog } from '@/components/backoffice/confirm-dialog';
import { SELECT_CLASS } from '@/components/backoffice/field-styles';
import { DetailList } from '@/components/backoffice/detail-list';
import { Notice, PageHeader, Panel } from '@/components/backoffice/page-header';
import { BookingStatusBadge } from '@/components/backoffice/status-badge';
import { SubmitButton } from '@/components/backoffice/submit-button';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { db } from '@/db';
import { formatDateLabel, formatMonthLabel, localDate, localTime } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { ownValue } from '@/lib/own';
import { cn } from '@/lib/utils';
import { isDateString, isMonthString, isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import {
  BOOKING_ERROR_LABELS,
  BOOKING_SOURCE_LABELS,
  BOOKING_STATUS_LABELS,
  BOOKING_TRANSITION_LABELS,
  CANCEL_CATEGORIES,
  CANCEL_CATEGORY_LABELS,
  PAYMENT_METHOD_LABELS,
} from '@/modules/booking/labels';
import { getBookingDetail, listBookingHistory, listBookingNotifications } from '@/modules/booking/queries';
import { isPaymentReceived, isRefundable, keptAmount, refundableAmount } from '@/modules/booking/payment-status';
import {
  decidesOperator,
  isBeforePaymentRequest,
  isOpenRequest,
  isOperatorLocked,
  nextStatusesFor,
  type BookingStatus,
} from '@/modules/booking/status';
import { cancellationRateLines, feeSettingsFor, suggestedRefund } from '@/modules/booking/cancellation-fee';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { listOperators } from '@/modules/catalog/menus';
import { listPricesForDate } from '@/modules/catalog/prices';
import { formatPhoneForDisplay } from '@/modules/customer/normalize';
import { getSlotForAdmin, listMenuSlotsOnDate } from '@/modules/inventory/queries';
import { operatorEmailMap } from '@/modules/notification/send-operator-mail';
import { REPORT_RESULT_LABELS, type ReportResult } from '@/modules/partner/bookings';
import { REQUEST_STATUS_LABELS, listBookingRequests, listMenuCandidates } from '@/modules/partner/requests';
import { telHref } from '@/modules/shop/contact';
import { paymentDueAt } from '@/modules/shop/settings';
import { NOTIFICATION_TYPE_LABELS } from '@/modules/notification/labels';
import { cardPaymentsEnabled, getCardPayments } from '@/modules/payment/card-payments';
import { getPaymentLedger } from '@/modules/payment/ledger';
import { getBookingSettlement } from '@/modules/settlement/settlements';
import { assignOperatorAction, changeStatusAction, resendMailAction, saveAdminNoteAction } from './actions';
import { AmountField } from './amount-field';
import { bookingListBack } from './list-back';
import { BookingFlow } from './booking-flow';
import { CancelRefundFields } from './cancel-refund-fields';
import { ItemsPanel, MovePanel } from './change-panels';
import { HistoryPanel, MailHistoryPanel } from './history-panel';
import { PaymentPanel } from './payment-panel';
import { OperatorRequestsPanel } from './requests-panel';
import { isPerPerson } from '@/modules/catalog/capacity-unit';

export const metadata = { title: '予約詳細' };

const PAGE_ERRORS: Record<string, string> = {
  NO_MAIL_FOR_STATUS: 'この予約の今の状態では、送り直すメールがありません。',
  NO_OPERATOR_SELECTED: '受入確認を依頼する事業者を選んでください。',
  AGREEMENT_NOTE_REQUIRED: '条件付きの回答のときは、合意した内容を入れてください。',
};

/** 状態を進めたときに出す結果（メールの種類つき） */
const CHANGED: Partial<Record<BookingStatus, string>> = {
  reviewing: '内容確認中にしました。',
  operator_checking: '受入確認中にしました。事業者へ空き・受入の可否を確かめてください。',
  awaiting_payment: '支払待ちにしました。',
  confirmed: '入金を記録し、予約を確定しました。',
  completed: '催行済みにしました。',
  verified: '実績を確認済みにしました。',
  cancelled: '予約を取り消しました。枠を回に戻しました。',
  weather_cancelled: '天候中止にしました。枠を回に戻しました。',
  no_show: '無断キャンセルにしました。',
};

/** 次の状態へ進めるときに、ダイアログで説明すること */
const TRANSITION_HELP: Partial<Record<BookingStatus, string>> = {
  reviewing: '組合で入力内容（人数・年齢・第 2 希望など）を確認している状態にします。',
  operator_checking:
    '電話などで事業者に空き・受入の可否を確かめているときに使います。事業者画面で確かめてもらうときは「事業者への受入確認」から依頼してください（自動でこの状態になります）。',
  awaiting_payment: 'お客様に金額・支払期限・支払方法を案内します。',
  confirmed: '入金を確認した記録を残し、予約を確定します。確定後は、お客様に実施事業者と当日の連絡先を案内します。',
  completed: '当日、予定どおり催行したことを記録します。',
  verified: '参加人数・内容・金額を確認し、月次精算の対象にします。',
  no_show: '連絡なく来られなかった予約として記録します（枠は戻しません）。',
};

export default async function BookingDetailPage({ params, searchParams }: PageProps<'/admin/bookings/[id]'>) {
  const admin = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const [b, mails, history, operators, requests, bookingSettlement] = await Promise.all([
    getBookingDetail(db, { shopId: admin.shopId, bookingId: id }),
    listBookingNotifications(db, { shopId: admin.shopId, bookingId: id }),
    listBookingHistory(db, { shopId: admin.shopId, bookingId: id }),
    listOperators(db, admin.shopId),
    listBookingRequests(db, { shopId: admin.shopId, bookingId: id }),
    getBookingSettlement(db, { shopId: admin.shopId, bookingId: id }),
  ]);
  if (!b) notFound();
  const ledger = b.payment ? await getPaymentLedger(db, b.payment.id) : null;

  const at = (d: Date) => `${formatDateLabel(d, b.timezone)} ${localTime(d, b.timezone)}`;
  const unit = b.capacityUnit;
  const phone = formatPhoneForDisplay(b.contactPhone);
  const payment = b.payment;
  const paid = isPaymentReceived(payment?.status);
  // 手元に残る入金（受け取り − 返金）。精算はこの額で計算する
  const kept = keptAmount(payment);
  const now = new Date();
  const today = localDate(now, b.timezone);
  const started = b.startsAt <= now;
  const overdue = b.status === 'awaiting_payment' && payment?.dueAt && payment.dueAt < now;
  const errorText = ownValue(PAGE_ERRORS, sp.error) ?? ownValue<string>(BOOKING_ERROR_LABELS, sp.error) ?? null;
  // 予約一覧から開いたときは、一覧の絞り込み・ページを保ったまま戻る（管理画面の予約一覧以外の URL は使わない）
  const listBack = bookingListBack(sp.back);
  const back = { href: listBack ?? '/admin/bookings', label: '予約台帳へ' };
  const backField = listBack && <input type="hidden" name="back" value={listBack} />;
  const movable = isOpenRequest(b.status) || b.status === 'confirmed';
  const moveDate = isDateString(sp.move) ? sp.move : null;
  const itemsEditable = isOpenRequest(b.status) || b.status === 'confirmed' || b.status === 'completed';
  const canRequest = isBeforePaymentRequest(b.status);

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
  if (b.operatorAgreement) rows.push(['事業者と合意した条件', b.operatorAgreement]);
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
  // キャンセル料・天候中止の返金率は、申込のときの率（残っていない古い予約は今の設定）
  const feeRates = feeSettingsFor(b);
  const policyText = [
    cancellationRateLines(feeRates).join('\n'),
    policy.commonCancellationPolicy,
    policy.cancellationPolicy,
  ]
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .join('\n\n');

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
  // 確定の結果は、支払いの受け取り方で書き分ける（現地払いは入金を記録していない）
  const changed =
    sp.changed === 'confirmed' && b.paymentMethod === 'onsite'
      ? '予約を確定しました（お支払いは当日、現地で実施事業者が受け取ります）。'
      : sp.changed === 'confirmed' && payment?.stripePaymentIntentId
        ? 'カードの入金を確かめて、予約を確定しました。'
        : ownValue<string>(CHANGED, sp.changed);
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

  // 精算済みは、月次精算で振込を記録したときに付ける（ここからは進めない。精算の対象から外れないように）
  const next = nextStatusesFor(b.status, b.paymentMethod).filter((s) => s !== 'settled');
  const dueForRequest = next.includes('awaiting_payment')
    ? paymentDueAt({ now, startsAt: b.startsAt, days: b.settings.paymentDueDays, timezone: b.timezone })
    : null;
  const cardPayment = cardPaymentsEnabled();
  // カード決済が有効なら、支払案内にはカードの支払いのボタンを出す（振込先の案内は要らない）
  const instructionsMissing = b.paymentMethod === 'online' && !b.settings.paymentInstructions && !cardPayment;
  // お客様のカードでのお支払いを待っている予約（払われると自動で確定する）。入金済みなら組合が確定する
  const awaitingCard = cardPayment && b.status === 'awaiting_payment' && b.paymentMethod === 'online' && !paid;
  // カードで受け付けたが、確定の条件（実施事業者の受入可の回答・今の支払い額）を満たさず保留している
  const heldCard = b.status === 'awaiting_payment' && paid && Boolean(payment?.stripePaymentIntentId);
  // 取消を実施事業者に知らせるのは、確定後か、その事業者に照会していたとき（サーバーと同じ判定）
  const operatorWasAsked = b.status === 'confirmed' || Boolean(assignedRequest);
  /** 実施事業者が決まって先へ進める操作（支払案内・確定。サーバーと同じ判定） */
  const decides = (to: BookingStatus) => decidesOperator(b.status, to);
  // 支払案内のあとに日時・人数を変えて、実施事業者へ照会し直したか（確定の前に、もう一度確かめる）
  const paymentRequestedAt = history.events
    .filter((e) => e.toStatus === 'awaiting_payment' && e.fromStatus !== 'awaiting_payment')
    .reduce<Date | null>((latest, e) => (!latest || e.at > latest ? e.at : latest), null);
  const reopenedAfterPayment =
    b.status === 'awaiting_payment' &&
    Boolean(assignedRequest) &&
    (!paymentRequestedAt || assignedRequest!.requestedAt > paymentRequestedAt);
  // 支払案内のあとに、組合が実施事業者を替えた
  const reassignedAfterPayment =
    b.status === 'awaiting_payment' &&
    history.logs.some(
      (l) => l.action === 'booking.assign_operator' && (!paymentRequestedAt || l.at > paymentRequestedAt),
    );
  /** 実施事業者の回答を確かめる段階か（支払案内の前、または支払案内のあとに照会し直した・替えたとき） */
  const checkingOperator = isBeforePaymentRequest(b.status) || reopenedAfterPayment || reassignedAfterPayment;
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

  /**
   * 次の操作として勧めるもの（目立たせる）。事業者の回答待ちのあいだと、カードでのお支払いを待っているあいだは勧めない
   * （カードで払われると自動で確定するため。組合の「入金を確認して確定する」は振込などで受け取ったときだけ使う）
   */
  const recommended: BookingStatus | null = isBeforePaymentRequest(b.status)
    ? assignedRequest?.status === 'accepted'
      ? b.paymentMethod === 'onsite'
        ? 'confirmed'
        : 'awaiting_payment'
      : null
    : b.status === 'awaiting_payment'
      ? awaitingCard
        ? null
        : 'confirmed'
      : b.status === 'confirmed'
        ? started
          ? 'completed'
          : null
        : b.status === 'completed'
          ? 'verified'
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
        : to === 'confirmed' && awaitingCard
          ? 'カード以外で受け取ったとして確定する'
          : to === 'confirmed' && heldCard
            ? 'カードの入金を確かめて確定する'
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
                <dd>
                  {b.paymentMethod === 'online' && cardPayment
                    ? 'カード（事前払い）'
                    : PAYMENT_METHOD_LABELS[b.paymentMethod]}
                </dd>
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
              {b.paymentMethod === 'online' && cardPayment && (
                <p className="rounded-lg bg-sky-50 p-3 text-sky-950">
                  メールと予約確認ページに「カードで支払う」を出します。お客様のお支払いが済むと、自動で予約確定になります。
                </p>
              )}
              {b.paymentMethod === 'online' && !cardPayment && b.settings.paymentInstructions && (
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

          {to === 'confirmed' && awaitingCard && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950">
              お客様のカードでのお支払いを待っている予約です。振込など、カード以外で受け取ったことを確かめたときだけ使ってください（カードで払われると自動で確定します）。
            </p>
          )}
          {to === 'confirmed' && b.paymentMethod === 'online' && !paid && (
            <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
              <legend className="px-1 font-medium">入金の記録</legend>
              <AmountField
                name="paymentAmount"
                label="入金額（円）"
                required
                expected={payment?.amount ?? b.totalAmount}
                expectedLabel="案内した金額"
                // カードでのお支払いを待っているときは、受け取った額を確かめて入れてもらう（初期値を入れない）
                defaultValue={awaitingCard ? '' : (payment?.amount ?? b.totalAmount)}
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
              {to === 'cancelled' ? (
                // 区分を選ぶと返金予定額の初期値が入る（キャンセル料率はお客様のご都合のときだけ）
                <CancelRefundFields
                  categories={CANCEL_CATEGORIES.filter((c) => c !== 'weather').map((c) => ({
                    value: c,
                    label: CANCEL_CATEGORY_LABELS[c],
                  }))}
                  paid={
                    payment && isRefundable(payment.status)
                      ? { amount: payment.amount, refunded: payment.refundedAmount }
                      : null
                  }
                  customerRefund={refundSuggestion(to).amount}
                  customerHint={refundHint(to)}
                  confirmedOnce={b.confirmedOnce}
                />
              ) : (
                refundDueField(to)
              )}
              {to === 'cancelled' && policyText && payment && isRefundable(payment.status) && (
                <details className="text-xs">
                  <summary className="cursor-pointer font-semibold text-sky-800">
                    申込時に同意したキャンセル規定を見る
                  </summary>
                  <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-line text-slate-700">{policyText}</p>
                </details>
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

          {to === 'no_show' && (
            <>
              <p className="font-semibold text-red-700">無断キャンセルにすると元に戻せません。</p>
              {refundDueField(to)}
            </>
          )}

          {to === 'verified' && b.paymentMethod === 'online' && kept !== b.totalAmount && (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-amber-950">
                {kept > b.totalAmount
                  ? `料金 ${formatYen(b.totalAmount)} より ${formatYen(kept - b.totalAmount)} 多く受け取っています（返金が要るか確かめてください）。`
                  : `料金 ${formatYen(b.totalAmount)} より ${formatYen(b.totalAmount - kept)} 少ない入金です（追加の入金が要るか確かめてください）。`}
                精算は手元に残る入金（{formatYen(kept)}
                ）で計算します。入金・返金を記録してから確認するか、差額の扱いを書いてください。
              </p>
              <label className="block space-y-1">
                <span className="block font-medium">差額の扱い（必須・履歴に残します）</span>
                <Textarea
                  name="amountDifferenceNote"
                  rows={2}
                  maxLength={300}
                  required
                  placeholder="例：1 名減の差額はお客様と合意のうえ返金しない"
                />
              </label>
            </div>
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

  const report = b.reportResult ? (b.reportResult as ReportResult) : null;
  // 取消・天候中止の返金予定額の初期値（設定のキャンセル料率・天候中止の返金率から。予約ごとに直せる）
  const refundSuggestion = (to: BookingStatus) =>
    b.confirmedOnce
      ? suggestedRefund({
          settings: feeRates,
          paidAmount: payment?.amount ?? 0,
          refundedAmount: payment?.refundedAmount ?? 0,
          totalAmount: b.totalAmount,
          kind: to === 'weather_cancelled' ? 'weather_cancelled' : 'cancelled',
          startsAt: b.startsAt,
          now,
          timezone: b.timezone,
        })
      : { amount: payment?.amount ?? 0, feePercent: 0, daysBefore: 0 };
  const refundHint = (to: BookingStatus) => {
    const s = refundSuggestion(to);
    if (!b.confirmedOnce) return `予約確定の前の取消のため、全額（${formatYen(payment?.amount ?? 0)}）を入れています。`;
    if (to === 'weather_cancelled') {
      return `天候中止の返金率（${feeRates.weatherRefundPercent}%）から入れています。`;
    }
    if (to === 'no_show') {
      return `無断キャンセルのため、当日・無断キャンセルの料率 ${s.feePercent}% を引いた額を入れています。規定と違うときは直してください。`;
    }
    const when =
      s.daysBefore >= 1 ? `参加日の ${s.daysBefore} 日前` : s.daysBefore === 0 ? '参加日の当日' : '参加日のあと';
    const fee = (payment?.amount ?? 0) - s.amount;
    return s.feePercent === 0
      ? `${when}の取消のため、キャンセル料はかかりません。全額（${formatYen(s.amount)}）を入れています。`
      : `${when}の取消のため、キャンセル料（料金の ${s.feePercent}%・${formatYen(fee)}）を引いた ${formatYen(s.amount)} を入れています。規定と違うときは直してください。`;
  };
  /** 取消・天候中止・無断キャンセルで、入金済みなら返金予定額を決めてもらう（精算ではその残りがキャンセル料になる） */
  const refundDueField = (to: BookingStatus) =>
    payment &&
    isRefundable(payment.status) && (
      <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
        <AmountField
          name="refundDueAmount"
          label="返金予定額（円・必須）"
          required
          refund
          expected={payment.amount}
          expectedLabel="入金額"
          defaultValue={refundSuggestion(to).amount}
          hint={refundHint(to)}
          min={payment.refundedAmount}
          max={payment.amount}
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
    );
  // 貸切（艇で数えるプラン）の実績は乗船人数（名）で報告される
  const charter = !isPerPerson(unit);
  const bookedCount = charter ? b.guestCount : b.partySize;
  const reportUnit = charter ? '名' : unit;
  const operatorLocked = isOperatorLocked(b.status);

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
            予約を登録しました。{sp.mail === 'sent' && 'お客様にメールを送信しました。'}
            {opMailResult?.tone === 'success' && ` ${opMailResult.text}`}
          </Notice>
        )}
        {sp.created && ((sp.mail && sp.mail !== 'off' && sp.mail !== 'sent') || opMailResult?.tone === 'warning') && (
          <Notice tone="warning">
            {[
              sp.mail && sp.mail !== 'off' && sp.mail !== 'sent' && mailResult(null),
              opMailResult?.tone === 'warning' && opMailResult.text,
            ]
              .filter(Boolean)
              .join(' ')}
          </Notice>
        )}
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
            {ownValue(NOTIFICATION_TYPE_LABELS, sp.resent) ?? 'メール'}
            を送り直しました。以前のメールのリンクもそのまま使えます。
          </Notice>
        )}
        {sp.moved && (
          <Notice tone="success">
            日時を変更しました。{sp.mail === 'sent' && 'お客様に変更後の内容をメールで送りました。'}
            {opMailResult?.tone === 'success' && ` ${opMailResult.text}`}
          </Notice>
        )}
        {(sp.changed === 'cancelled' || sp.changed === 'weather_cancelled' || sp.changed === 'no_show') &&
          payment &&
          refundableAmount(payment) > 0 && (
            <Notice tone="warning">
              返金予定額 {formatYen(payment.refundDueAmount ?? 0)} を記録しました（まだ返金していません）。
              {payment.stripePaymentIntentId
                ? '下の「入金・返金」の「カードへ返金する」で、お客様のカードへ返金してください。'
                : '振込などで返金したら、下の「入金・返金」の「返金を記録」で記録してください。'}
            </Notice>
          )}
        {sp.refunded && (
          <Notice tone="success">
            {sp.refunded === 'card'
              ? 'お客様のカードへ返金しました（カードの明細に出るまで、カード会社により数日〜数週間かかります）。'
              : '返金を記録しました。'}
          </Notice>
        )}
        {sp.saved === 'receipt' && <Notice tone="success">追加の入金を記録しました。</Notice>}
        {isMonthString(sp.adjusted) && (
          <Notice tone="warning">
            この予約は振込済みの精算（{formatMonthLabel(sp.adjusted)}
            ）に入っていたため、次の精算で差額を調整します（「精算」で次の月の下書きを計算し直すと入ります）。
          </Notice>
        )}
        {sp.saved === 'note' && <Notice tone="success">組合メモを保存しました。</Notice>}
        {sp.saved === 'items' && (
          <Notice tone="success">
            人数・料金を変更しました。{opMailResult?.tone === 'success' && ` ${opMailResult.text}`}
            {paid && payment && kept !== b.totalAmount && (
              <>
                {' '}
                手元に残る入金 {formatYen(kept)} と新しい料金 {formatYen(b.totalAmount)} の差額（
                {formatYen(Math.abs(b.totalAmount - kept))}）は、「入金・返金」で
                {b.totalAmount > kept ? '追加の入金を記録' : '返金'}してください。
              </>
            )}
          </Notice>
        )}
        {sp.saved === 'withdrawn' && <Notice tone="success">受入確認を取り下げました。</Notice>}
        {requestedCount > 0 && (
          <Notice tone={unsentCount > 0 ? 'warning' : 'success'}>
            {requestedCount} 社へ受入確認を依頼しました。
            {unsentCount > 0 &&
              `うち ${unsentCount} 社にはメールを送れませんでした（メールアドレスが未登録など）。事業者画面には出ているので、お電話などでも伝えてください。`}
          </Notice>
        )}
        {errorText && <Notice tone={sp.error === 'REFUND_PENDING' ? 'warning' : 'error'}>{errorText}</Notice>}
        {heldCard && payment && (
          <Notice tone="warning">
            カードで {formatYen(payment.amount)} を受け付けました
            {payment.receivedAt && `（${formatDateLabel(payment.receivedAt, b.timezone)}）`}
            。確定の条件（実施事業者の受入可の回答・今の料金
            {formatYen(b.totalAmount)}）を満たさないため、確定を保留しています。
            {payment.amount !== b.totalAmount &&
              `今の料金との差額は ${formatYen(b.totalAmount - payment.amount)} です。`}
            確かめてから「カードの入金を確かめて確定する」を押すか、取り消して返金してください。
          </Notice>
        )}
        {overdue && !paid && (
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
                ? '別の事業者に受入確認を依頼するか、日時の変更・取消を検討してください。'
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

        {/* スマホでは「次の操作・代表者」→ 予約の内容 →「実施事業者・組合メモ」の順。パソコンでは右の列にまとめる */}
        <div className="grid gap-4 md:grid-cols-[1fr_19rem] md:items-start">
          <div className="order-2 space-y-4 md:order-none md:col-start-1 md:row-span-2 md:row-start-1">
            <Panel title="予約内容">
              <DetailList rows={rows} />
            </Panel>

            {requestRows.length > 0 && (
              <Panel title="お客様からの申込内容">
                <DetailList rows={requestRows} />
              </Panel>
            )}

            {(canRequest || requests.length > 0) && (
              <OperatorRequestsPanel
                booking={b}
                requests={requests}
                canRequest={canRequest}
                candidates={candidates}
                allOperatorsShown={menuCandidates.length === 0}
                recipients={recipients}
                backField={backField}
                at={at}
              />
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

            <PaymentPanel
              booking={b}
              payment={payment}
              ledger={ledger}
              settlement={bookingSettlement}
              backField={backField}
              today={today}
              cardAvailable={getCardPayments() !== null}
              overdue={Boolean(overdue)}
              at={at}
            />

            {itemsEditable && priceSet && (
              <ItemsPanel
                booking={b}
                priceSet={priceSet}
                unit={unit}
                open={Boolean(sp.error) && sp.from === 'items'}
                paymentNote={
                  paid ? (
                    <p className="text-xs text-amber-800">
                      入金済みの予約です。料金が変わったら、「入金・返金」で追加の入金か返金を記録してください。
                    </p>
                  ) : (
                    payment?.status === 'pending' &&
                    b.status === 'awaiting_payment' && (
                      <p className="text-xs text-slate-600">
                        支払案内の金額も新しい料金になり、開いている支払いのページは無効にします。必要なら「メールを送り直す」で案内し直してください。
                      </p>
                    )
                  )
                }
                extra={
                  <>
                    {reopenNote}
                    {changeNotifyBox('実施事業者に人数の変更をメールで知らせる')}
                  </>
                }
                backField={backField}
              />
            )}

            {movable && (
              <MovePanel
                booking={b}
                unit={unit}
                moveDate={moveDate}
                moveSlots={moveSlots}
                listBack={listBack}
                backField={backField}
                today={today}
                at={at}
                extra={
                  <>
                    {reopenNote}
                    {changeNotifyBox('実施事業者に日時の変更をメールで知らせる')}
                    {notifyBox('お客様に変更後の内容をメールで送る')}
                  </>
                }
              />
            )}

            <HistoryPanel
              history={history}
              at={at}
              operatorName={(id) => operators.find((o) => o.id === id)?.name ?? null}
              requestOperatorName={(id) => requests.find((r) => r.id === id)?.operatorName ?? null}
            />

            <MailHistoryPanel mails={mails} hasEmail={Boolean(b.contactEmail)} at={at} />
          </div>

          <div className="order-1 space-y-4 md:order-none md:col-start-2 md:row-start-1">
            {(next.length > 0 || b.status === 'verified') && (
              <Panel title="次の操作">
                <div className="flex flex-col gap-2">
                  {canRequest && pendingRequests.length > 0 && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                      事業者の回答待ち（{pendingRequests.map((r) => r.operatorName).join('・')}）
                    </p>
                  )}
                  {awaitingCard && (
                    <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm font-medium text-sky-900">
                      お客様のカードでのお支払いを待っています。お支払いが済むと自動で予約確定になります。
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
                  {b.status === 'verified' && (
                    <p className="text-sm text-slate-700">
                      月次精算の対象です。
                      <Link href="/admin/settlements" className="mx-1 font-semibold text-sky-800 underline">
                        精算
                      </Link>
                      で振込を記録すると「精算済み」になります。
                    </p>
                  )}
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
          </div>

          <div className="order-3 space-y-4 md:order-none md:col-start-2 md:row-start-2">
            <Panel
              title="実施事業者"
              description={
                b.operatorAssignedVia === 'staff'
                  ? '組合が選んだ事業者です（受入確認の回答で自動には変わりません）。お客様には予約確定後に案内します。'
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
