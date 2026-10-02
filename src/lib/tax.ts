/** 消費税の率（%）。領収書・精算の手数料は内税で計算する */
export const CONSUMPTION_TAX_PERCENT = 10;

/** 税込みの金額に含まれる消費税（1 円未満は切り捨て） */
export function includedConsumptionTax(amount: number): number {
  return Math.floor((amount * CONSUMPTION_TAX_PERCENT) / (100 + CONSUMPTION_TAX_PERCENT));
}
