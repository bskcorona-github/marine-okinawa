/** 人数で数えるプランの単位（ほかは「艇」：貸切で、1 予約＝1 艇） */
export const PER_PERSON_UNIT = '名';

/** 人数で数えるプランか（貸切は艇で数え、乗船人数を別に持つ） */
export function isPerPerson(unit: string): boolean {
  return unit === PER_PERSON_UNIT;
}
