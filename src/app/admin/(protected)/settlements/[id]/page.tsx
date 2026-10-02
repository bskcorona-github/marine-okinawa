import { notFound } from 'next/navigation';
import { ConfirmDialog } from '@/components/backoffice/confirm-dialog';
import { Notice, PageHeader, Panel } from '@/components/backoffice/page-header';
import { SettlementItemsTable } from '@/components/backoffice/settlement-items-table';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { db } from '@/db';
import { formatDateLabel, formatIsoDateLabel, formatMonthLabel, localDate } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { ownValue } from '@/lib/own';
import { cn } from '@/lib/utils';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import {
  getSettlement,
  payoutDateOf,
  SETTLEMENT_ERROR_LABELS,
  settlementStatusLabel,
  type SettlementDetail,
} from '@/modules/settlement/settlements';
import { getShopById } from '@/modules/shop/shops';
import { confirmSettlementAction, markSettlementPaidAction, unconfirmSettlementAction } from '../actions';
import { SETTLEMENT_STATUS_TONE } from '@/components/backoffice/settlement-status-tone';

export const metadata = { title: '精算の明細' };

const DONE: Record<string, string> = {
  confirmed: '精算を確定しました。事業者画面に明細を出しています。',
  unconfirmed: '確定を取り消しました。下書きに戻り、計算し直せます。',
  paid: '振込（または事業者からの入金）を記録しました。実績確認済みの予約を「精算済み」にしました。',
};
/** 確定しようとしたら、下書きを作ったあとの返金・実績の確認で数字が変わっていた */
const CHANGED =
  '確定の前に計算し直したところ、明細が変わりました（下書きを作ったあとの返金・実績の確認など）。内容を確かめてから、もう一度確定してください。';

/** 画面で見た支払額・件数（確定・振込の直前に今の値と比べ、ほかの画面で変わっていたら止める） */
function SeenFields({ settlement }: { settlement: SettlementDetail }) {
  return (
    <>
      <input type="hidden" name="seenPayoutAmount" value={settlement.payoutAmount} />
      <input type="hidden" name="seenItemCount" value={settlement.items.length} />
      <input type="hidden" name="seenAdjustmentCount" value={settlement.adjustments.length} />
    </>
  );
}

export default async function SettlementPage({ params, searchParams }: PageProps<'/admin/settlements/[id]'>) {
  const admin = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const [shop, settlement] = await Promise.all([
    getShopById(db, admin.shopId),
    getSettlement(db, { shopId: admin.shopId, id }),
  ]);
  if (!settlement) notFound();
  const period = formatMonthLabel(settlement.period);
  // 確定した精算は、確定したときの支払日（下書きは今の設定から）
  const payout = settlement.payoutOn ?? payoutDateOf(settlement.period, shop.settings.payoutDay);
  const receiving = settlement.payoutAmount < 0;
  const done = ownValue(DONE, sp.done);
  const error = typeof sp.error === 'string' ? ownValue(SETTLEMENT_ERROR_LABELS, sp.error) : null;
  const today = localDate(new Date(), shop.timezone);

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        back={{ href: `/admin/settlements?period=${settlement.period}`, label: '精算の一覧へ' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {settlement.operatorName}（{period}）
            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 text-sm font-semibold',
                SETTLEMENT_STATUS_TONE[settlement.status],
              )}
            >
              {settlementStatusLabel(settlement.status, settlement.payoutAmount)}
            </span>
          </span>
        }
        description={`支払日 ${formatIsoDateLabel(payout)}${settlement.paidAt ? ` ・ ${receiving ? '入金' : '振込'} ${formatDateLabel(settlement.paidAt, shop.timezone)}` : ''}`}
        actions={
          <a href={`/admin/settlements/${settlement.id}/export`} className={buttonVariants({ variant: 'outline' })}>
            CSV 出力
          </a>
        }
      />
      {done && <Notice tone="success">{done}</Notice>}
      {sp.done === 'changed' && <Notice tone="warning">{CHANGED}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <Panel title="明細">
        <SettlementItemsTable
          settlement={settlement}
          timezone={shop.timezone}
          bookingHref={(bookingId) => `/admin/bookings/${bookingId}`}
        />
      </Panel>

      <Panel title="操作">
        {settlement.status === 'draft' && (
          <div className="space-y-2 text-sm">
            <p>内容を確かめたら確定してください。確定すると事業者画面に明細を出し、計算し直しません。</p>
            <form action={confirmSettlementAction.bind(null, settlement.id)}>
              <SeenFields settlement={settlement} />
              <ConfirmDialog
                tone="default"
                triggerLabel="確定する"
                title="この精算を確定しますか？"
                confirmLabel="確定する"
              >
                <p>
                  {receiving
                    ? `事業者から組合へ ${formatYen(-settlement.payoutAmount)} を受け取る精算として確定します。`
                    : `事業者へ ${formatYen(settlement.payoutAmount)} を振り込む精算として確定します。`}
                  事業者画面に明細を出します。振込の前なら、確定を取り消せます。
                </p>
                <p className="text-xs text-slate-600">
                  確定の前に計算し直し、数字が変わっていたら確定せずにお知らせします。
                </p>
              </ConfirmDialog>
            </form>
          </div>
        )}
        {settlement.status === 'confirmed' && (
          <div className="flex flex-wrap items-start gap-6 text-sm">
            <form action={markSettlementPaidAction.bind(null, settlement.id)} className="space-y-2">
              <SeenFields settlement={settlement} />
              <p className="font-medium">{receiving ? '事業者からの入金' : '事業者への振込'}を記録する</p>
              <label className="block space-y-1">
                <span className="block text-xs text-slate-600">日付</span>
                <Input type="date" name="paidOn" defaultValue={today} max={today} required className="w-44" />
              </label>
              <label className="block space-y-1">
                <span className="block text-xs text-slate-600">メモ（任意）</span>
                <Input name="note" maxLength={200} placeholder="例：〇〇銀行から振込" className="w-72" />
              </label>
              <ConfirmDialog
                tone="default"
                triggerLabel={receiving ? '入金を記録する…' : '振込を記録する…'}
                title={receiving ? '事業者からの入金を記録しますか？' : '事業者への振込を記録しますか？'}
                confirmLabel={receiving ? '入金を記録する' : '振込を記録する'}
                pendingLabel="保存中…"
              >
                <p>
                  {settlement.operatorName}
                  {receiving
                    ? `から組合への入金 ${formatYen(-settlement.payoutAmount)} を記録します。`
                    : `への振込 ${formatYen(settlement.payoutAmount)} を記録します。`}
                </p>
                <p className="font-semibold text-red-700">
                  明細の実績確認済みの予約（{settlement.items.filter((i) => i.bookingStatus === 'verified').length}{' '}
                  件）が「精算済み」になり、元に戻せません。
                </p>
              </ConfirmDialog>
            </form>
            <form action={unconfirmSettlementAction.bind(null, settlement.id)}>
              <ConfirmDialog
                tone="default"
                triggerLabel="確定を取り消す…"
                title="確定を取り消しますか？"
                confirmLabel="確定を取り消す"
                pendingLabel="保存中…"
              >
                <p>事業者画面から明細が見えなくなり、下書きに戻ります。計算し直してから、もう一度確定してください。</p>
                <label className="block space-y-1">
                  <span className="block text-xs font-medium text-slate-700">取り消す理由（必須・記録に残ります）</span>
                  <Textarea
                    name="reason"
                    required
                    maxLength={300}
                    rows={2}
                    placeholder="例：返金の記録漏れがあったため"
                  />
                </label>
              </ConfirmDialog>
            </form>
          </div>
        )}
        {settlement.status === 'paid' && (
          <p className="text-sm">
            {receiving ? '事業者からの入金' : '事業者への振込'}を記録済みです
            {settlement.paidNote && `（${settlement.paidNote}）`}。
          </p>
        )}
      </Panel>
    </div>
  );
}
