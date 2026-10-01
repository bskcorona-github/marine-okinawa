type Translate = (key: 'minutes' | 'hours' | 'hoursMinutes', values: Record<string, number>) => string;

/** 所要時間を「約90分」「約3時間」「約1時間30分」の形にする（t は duration 名前空間） */
export function formatDuration(t: Translate, minutes: number): string {
  if (minutes < 60 || minutes === 90) return t('minutes', { minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? t('hours', { hours }) : t('hoursMinutes', { hours, minutes: rest });
}
