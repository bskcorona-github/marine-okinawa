import { invalidState, toFormIssues, type AdminFormState } from '@/lib/zod-ja';
import { menuInputSchema, type MenuInput } from './menu-admin';

/**
 * プランの編集フォームの値を MenuInput にする（管理画面と事業者画面で共通）。fixed は、フォームでは変えさせない値
 * （事業者画面の URL 名・公開状態・掲載元の事業者・おすすめ）で、フォームの値より優先する
 */
export function parseMenuForm(
  formData: FormData,
  fixed: Partial<Pick<MenuInput, 'slug' | 'status' | 'operatorId' | 'featured'>> = {},
) {
  const raw = Object.fromEntries(formData) as Record<string, string>;
  let prices: unknown = [];
  try {
    prices = JSON.parse(raw.prices ?? '[]');
  } catch {
    prices = [];
  }
  const images = (raw.images ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return menuInputSchema.safeParse({
    ...raw,
    minAge: raw.minAge ? raw.minAge : null,
    cutoffPrevDayTime: raw.cutoffPrevDayTime ? raw.cutoffPrevDayTime : null,
    operatorId: raw.operatorId ? raw.operatorId : null,
    activityId: raw.activityId ? raw.activityId : null,
    featured: raw.featured === 'on',
    requireAges: raw.requireAges === 'on',
    includedGuests: raw.includedGuests ? raw.includedGuests : null,
    extraGuestPrice: raw.extraGuestPrice ? raw.extraGuestPrice : null,
    maxGuests: raw.maxGuests ? raw.maxGuests : null,
    images,
    prices,
    ...fixed,
  });
}

/** プランの項目名（入力エラーの表示と、変更の申請の差分に使う） */
export const MENU_FIELD_LABELS: Record<string, string> = {
  title: 'プラン名',
  slug: 'URL 名',
  status: '公開状態',
  category: 'カテゴリ',
  durationMin: '所要時間',
  minAge: '対象年齢',
  maxPartySize: '1 予約の最大人数',
  minPartySize: '1 予約の最少人数',
  bookingCutoffMin: 'Web 予約の締切',
  cutoffPrevDayTime: '前日の締切時刻',
  operatorId: '実施事業者（初期値）',
  activityId: 'アクティビティ',
  meetingAddress: '集合場所の住所',
  meetingMapUrl: '地図の URL',
  cancellationPolicy: 'このプランのキャンセル規定',
  weatherPolicy: '天候等による中止',
  capacityUnit: '定員の単位',
  includedGuests: '基本料金に含まれる人数',
  extraGuestPrice: '追加 1 名あたりの料金',
  maxGuests: '乗船人数の上限',
  summary: '一覧用の紹介文',
  description: '説明文',
  meetingPoint: '集合場所',
  whatToBring: '持ち物',
  included: '料金に含まれるもの',
  conditions: '参加条件',
  notes: '注意事項',
  images: '写真',
  requireAges: '参加者の年齢の入力',
  prices: '料金区分',
};
const PRICE_FIELD_LABELS: Record<string, string> = {
  label: '区分名',
  price: '料金',
  season: '季節',
  meetingPoint: '集合場所',
};

/** 入力エラーを、項目名つきの画面の状態にする */
export function menuFormInvalid(error: Parameters<typeof toFormIssues>[0]): AdminFormState {
  return invalidState(
    toFormIssues(error, MENU_FIELD_LABELS, (path) => {
      if (path[0] === 'images' && typeof path[1] === 'number')
        return { field: 'images', label: `写真（${path[1] + 1} 枚目）` };
      if (path[0] !== 'prices' || typeof path[1] !== 'number') return null;
      return {
        field: 'prices',
        label: `料金区分 ${path[1] + 1} 行目の${PRICE_FIELD_LABELS[String(path[2])] ?? '入力'}`,
      };
    }),
  );
}
