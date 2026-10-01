import type { MenuInput } from '@/modules/catalog/menu-admin';
import type { MenuFormValues } from './menu-form';

/** 新しいプランのフォームの初期値（組合・事業者で共通） */
export const NEW_PLAN_VALUES: MenuFormValues = {
  slug: '',
  status: 'draft',
  category: 'snorkeling',
  durationMin: 120,
  minAge: null,
  minPartySize: 1,
  maxPartySize: 10,
  bookingCutoffMin: 120,
  cutoffPrevDayTime: null,
  operatorId: null,
  activityId: null,
  featured: false,
  requireAges: false,
  capacityUnit: '名',
  title: '',
  description: '',
  meetingPoint: '',
  meetingAddress: '',
  meetingMapUrl: '',
  whatToBring: '',
  cancellationPolicy: '',
  weatherPolicy: '',
  summary: '',
  included: '',
  conditions: '',
  notes: '',
  images: [],
  prices: [
    { label: '大人', price: 0, season: null, meetingPoint: null },
    { label: '子供', price: 0, season: null, meetingPoint: null },
  ],
  includedGuests: null,
  extraGuestPrice: null,
  maxGuests: null,
  candidateIds: [],
};

/** プランの内容（今の内容、または変更の申請の内容）をフォームの初期値にする */
export function toFormValues(input: MenuInput, candidateIds: string[] = []): MenuFormValues {
  return {
    ...input,
    meetingAddress: input.meetingAddress ?? '',
    meetingMapUrl: input.meetingMapUrl ?? '',
    cancellationPolicy: input.cancellationPolicy ?? '',
    weatherPolicy: input.weatherPolicy ?? '',
    prices: input.prices.map((p) => ({
      id: p.id,
      label: p.label,
      price: p.price,
      season: p.season ?? null,
      meetingPoint: p.meetingPoint ?? null,
    })),
    candidateIds,
  };
}
