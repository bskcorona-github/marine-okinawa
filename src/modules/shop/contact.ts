export type Contact = {
  phone: string | null;
  /** 電話の受付時間 */
  hours: string | null;
  /** 連絡先の名前（組合名・実施事業者名） */
  name: string | null;
  email: string | null;
};

/**
 * お客様の問い合わせ・キャンセル・変更の窓口（組合）。予約の窓口は組合に一本化し、事業者の連絡先は出さない。
 * 電話もメールもなければ null（連絡先を案内しない）
 */
export function shopContact(p: {
  shopName?: string | null;
  shopPhone?: string | null;
  shopBusinessHours?: string | null;
  shopEmail?: string | null;
}): Contact | null {
  const phone = p.shopPhone || null;
  const email = p.shopEmail || null;
  if (!phone && !email) return null;
  return { phone, hours: phone ? p.shopBusinessHours || null : null, name: p.shopName || null, email };
}

/**
 * 当日の連絡先（実施事業者の電話）。予約確定後に、遅刻・集合場所の確認などのために案内する。
 * 事業者の電話がなければ null（組合の窓口だけを案内する）
 */
export function dayOfContact(p: {
  operatorName?: string | null;
  operatorPhone?: string | null;
  operatorContactHours?: string | null;
}): Contact | null {
  if (!p.operatorPhone) return null;
  return { phone: p.operatorPhone, hours: p.operatorContactHours || null, name: p.operatorName || null, email: null };
}

/** tel: には数字と + だけを入れる（表示はハイフン区切りのまま） */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}
