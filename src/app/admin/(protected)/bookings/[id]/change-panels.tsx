import type { ReactNode } from 'react';
import { Panel } from '@/components/backoffice/page-header';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatIsoDateLabel, localTime } from '@/lib/dates';
import type { BookingStatus } from '@/modules/booking/status';
import type { listPricesForDate } from '@/modules/catalog/prices';
import { SEASON_LABELS } from '@/modules/catalog/season';
import { remainingSeats } from '@/modules/inventory/availability';
import type { listMenuSlotsOnDate } from '@/modules/inventory/queries';
import { changeItemsAction, changeSlotAction } from './actions';
import { ItemsChangeForm } from './items-change-form';
import { MoveSlotPicker } from './move-slot-picker';
import { isPerPerson } from '@/modules/catalog/capacity-unit';

type PriceSet = Awaited<ReturnType<typeof listPricesForDate>>;
type MoveSlot = Awaited<ReturnType<typeof listMenuSlotsOnDate>>[number];

/** 予約の詳細の「人数・料金の変更」 */
export function ItemsPanel({
  booking: b,
  priceSet,
  unit,
  extraGuest,
  open,
  paymentNote,
  extra,
  backField,
}: {
  booking: {
    id: string;
    status: BookingStatus;
    guestCount: number | null;
    totalAmount: number;
    items: { priceId: string; label: string; quantity: number; unitPrice: number }[];
  };
  priceSet: PriceSet;
  unit: string;
  /** 貸切の基本料金に含まれる人数と、超えた 1 名あたりの追加料金（なければ null） */
  extraGuest: { included: number; price: number } | null;
  /** 入力のエラーで戻ってきたときは開いておく */
  open: boolean;
  /** 支払いへの影響の説明（入金済み・支払案内の金額） */
  paymentNote: ReactNode;
  /** 事業者の回答が戻ること・事業者へのメール */
  extra: ReactNode;
  backField: ReactNode;
}) {
  const pricesById = new Map(priceSet.prices.map((p) => [p.id, p]));
  const retiredItems = b.items.filter((i) => !pricesById.has(i.priceId));
  /** 予約にある区分の、予約のときの単価 */
  const bookedPrice = (priceId: string) => b.items.find((i) => i.priceId === priceId)?.unitPrice;
  return (
    <Panel title="人数・料金の変更" description="電話での人数変更や、当日の実績人数に合わせて直します。">
      <details className="text-sm" open={open}>
        {/* スマホでも押しやすい高さにする（py-3 で 44px） */}
        <summary className="cursor-pointer py-3 font-semibold text-sky-800">人数を変える</summary>
        <ItemsChangeForm
          action={changeItemsAction.bind(null, b.id)}
          backField={backField}
          prices={priceSet.prices.map((p) => ({
            id: p.id,
            label: p.label,
            unitPrice: bookedPrice(p.id) ?? p.price,
            bookedPriceDiffers: bookedPrice(p.id) !== undefined && bookedPrice(p.id) !== p.price,
            quantity: b.items.find((i) => i.priceId === p.id)?.quantity ?? 0,
          }))}
          currentParty={b.items.map((i) => `${i.label} ${i.quantity}${unit}`).join('・')}
          currentTotal={b.totalAmount}
          unit={unit}
          perPerson={isPerPerson(unit)}
          guestCount={b.guestCount}
          extraGuest={extraGuest}
          showOverCapacity={b.status !== 'completed'}
          notes={
            <>
              <p className="text-xs text-slate-600">
                予約にある区分は予約のときの単価のまま、新しく足した区分はこの回の日付の料金で計算します。
                {priceSet.prices.some((p) => p.season) && `料金は${SEASON_LABELS[priceSet.season]}です。`}
              </p>
              {retiredItems.length > 0 && (
                <p className="text-xs text-amber-800">
                  {retiredItems.map((i) => i.label).join('・')}
                  は今の料金表にないため、下の区分から選び直してください。
                </p>
              )}
            </>
          }
          confirmNotes={
            <>
              {paymentNote}
              {extra}
            </>
          }
        />
      </details>
    </Panel>
  );
}

/** 予約の詳細の「日時の変更」：日を選んで回を出し、選んだ回へ移す */
export function MovePanel({
  booking: b,
  unit,
  moveDate,
  moveSlots,
  listBack,
  backField,
  today,
  at,
  extra,
}: {
  booking: { id: string; slotId: string; startsAt: Date; partySize: number; status: BookingStatus; timezone: string };
  unit: string;
  moveDate: string | null;
  moveSlots: MoveSlot[];
  listBack: string | null;
  backField: ReactNode;
  today: string;
  at: (d: Date) => string;
  /** 事業者の回答が戻ること・事業者とお客様へのメール */
  extra: ReactNode;
}) {
  return (
    // 「この日の回を見る」で画面を出し直したときに、この欄へ戻る（スマホでは画面のずっと下にあるため）
    <div id="booking-move" className="scroll-mt-6">
      <Panel
        title="日時の変更"
        description="同じプランの別の回へ移します。料金は変わりません。"
      >
        <form method="get" action="#booking-move" className="flex flex-wrap items-end gap-2 text-sm">
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
            {/* 失敗して戻ってきたときも、同じ日の回を出す */}
            <input type="hidden" name="move" value={moveDate} />
            {moveSlots.length === 0 ? (
              <p className="text-slate-600">この日にこのプランの回はありません。</p>
            ) : (
              <MoveSlotPicker
                dateLabel={formatIsoDateLabel(moveDate, { year: false })}
                currentLabel={at(b.startsAt)}
                partyLabel={`${b.partySize}${unit}`}
                slots={moveSlots.map((s) => {
                  const current = s.id === b.slotId;
                  return {
                    id: s.id,
                    time: localTime(s.startsAt, b.timezone),
                    note: current
                      ? '今の回'
                      : s.status !== 'open'
                        ? '休止'
                        : `残り ${remainingSeats(s.capacity, s.reservedCount)}${unit}`,
                    disabled: current || s.status !== 'open',
                    current,
                  };
                })}
              >
                {b.status === 'awaiting_payment' && (
                  <p>支払期限は、新しい日時に合わせて早まることがあります。開いている支払いのページは無効にします。</p>
                )}
                {extra}
              </MoveSlotPicker>
            )}
          </form>
        )}
      </Panel>
    </div>
  );
}
