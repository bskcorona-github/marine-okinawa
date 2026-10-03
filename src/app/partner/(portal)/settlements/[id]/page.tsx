import { notFound } from 'next/navigation';
import { PageHeader, Panel } from '@/components/backoffice/page-header';
import { SettlementItemsTable } from '@/components/backoffice/settlement-items-table';
import { db } from '@/db';
import { formatDateLabel, formatIsoDateLabel, formatMonthLabel } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { includedConsumptionTax } from '@/lib/tax';
import { isUuid } from '@/lib/validation';
import { requireOperator } from '@/modules/auth/guard';
import { getOperatorProfile } from '@/modules/partner/change-requests';
import { getOperatorSettlement, payoutDateOf } from '@/modules/settlement/settlements';
import { getShopById } from '@/modules/shop/shops';

export const metadata = { title: '精算の明細' };

export default async function PartnerSettlementPage({ params }: PageProps<'/partner/settlements/[id]'>) {
  const operator = await requireOperator();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [shop, settlement, profile] = await Promise.all([
    getShopById(db, operator.shopId),
    getOperatorSettlement(db, { operatorId: operator.operatorId, id }),
    getOperatorProfile(db, operator.operatorId),
  ]);
  const operatorInvoiceNumber = profile?.invoiceNumber ?? '';
  if (!settlement) notFound();
  // 確定したときの支払日と登録番号（あとで組合が設定を変えても、確定した明細の表示は変えない）
  const payoutLabel = formatIsoDateLabel(
    settlement.payoutOn ?? payoutDateOf(settlement.period, shop.settings.payoutDay),
  );
  const invoiceNumber = settlement.shopInvoiceNumber ?? shop.settings.invoiceNumber;
  const paidOn = settlement.paidAt ? `（${formatDateLabel(settlement.paidAt, shop.timezone)}）` : '';
  // 支払額がマイナス：現地払いの手数料を、事業者から組合へ払ってもらう月
  const receiving = settlement.payoutAmount < 0;
  const description =
    settlement.status === 'paid'
      ? receiving
        ? `組合への入金を確認しました${paidOn}。`
        : `組合からお振り込みしました${paidOn}。`
      : receiving
        ? `確定しました。組合へのお支払い ${formatYen(-settlement.payoutAmount)} を ${payoutLabel} までにお願いします（お支払い先は組合からご案内します）。`
        : `確定しました。${payoutLabel}までにお振り込みします。`;
  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader
        back={{ href: '/partner/settlements', label: '精算の一覧へ' }}
        title={`${formatMonthLabel(settlement.period)}分の精算`}
        description={description}
      />
      <Panel title="明細">
        <SettlementItemsTable settlement={settlement} timezone={shop.timezone} viewer="operator" />
      </Panel>
      {shop.settings.receiptModel === 'agent' ? (
        // 組合がお客様の代金を事業者の代理で受け取る形：組合の手数料の請求書（インボイス）を兼ねる
        <Panel title="組合の手数料について">
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-slate-600">発行者</dt>
            <dd>{shop.name}</dd>
            <dt className="text-slate-600">登録番号</dt>
            <dd className="tabular-nums">{invoiceNumber || '（組合が登録番号を設定していません）'}</dd>
            <dt className="text-slate-600">手数料（税込・10% 対象）</dt>
            <dd className="tabular-nums">{formatYen(settlement.commissionAmount)}</dd>
            <dt className="text-slate-600">うち消費税</dt>
            <dd className="tabular-nums">{formatYen(includedConsumptionTax(settlement.commissionAmount))}</dd>
          </dl>
          <p className="mt-2 text-xs text-slate-600">
            この明細は、組合の手数料の請求書（インボイス）を兼ねます。内容に心当たりのない点があれば、組合へご連絡ください。
          </p>
        </Panel>
      ) : (
        // 組合がお客様への販売者になる形：組合から事業者へのお支払い（業務の委託料）の支払通知書
        <Panel title="お支払いの内容について">
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-slate-600">作成者</dt>
            <dd>{shop.name}</dd>
            <dt className="text-slate-600">事業者の登録番号</dt>
            <dd className="tabular-nums">{operatorInvoiceNumber || '（登録番号が登録されていません）'}</dd>
            <dt className="text-slate-600">
              {receiving ? '組合へお支払いいただく額（税込・10% 対象）' : '組合からのお支払い額（税込・10% 対象）'}
            </dt>
            <dd className="tabular-nums">{formatYen(Math.abs(settlement.payoutAmount))}</dd>
            <dt className="text-slate-600">うち消費税</dt>
            <dd className="tabular-nums">{formatYen(includedConsumptionTax(Math.abs(settlement.payoutAmount)))}</dd>
          </dl>
          <p className="mt-2 text-xs text-slate-600">
            この明細は、組合が作る支払通知書（仕入明細書）です。内容に誤りがあれば、支払日までに組合へご連絡ください（ご連絡がなければ、内容を確認いただいたものとして扱います）。
          </p>
        </Panel>
      )}
    </div>
  );
}
