-- 台帳にする前の返金に、返した入金（receipt_id）を入れる。入金が 1 件だけの支払いは、その入金を返したものとする
-- （入金ごとの「返せる残り」が多く出て、画面の残りどおりに入れると断られることがないように）
UPDATE "payment_refunds" r
SET "receipt_id" = (SELECT pr."id" FROM "payment_receipts" pr WHERE pr."payment_id" = r."payment_id")
WHERE r."receipt_id" IS NULL
  AND (SELECT count(*) FROM "payment_receipts" pr WHERE pr."payment_id" = r."payment_id") = 1;
