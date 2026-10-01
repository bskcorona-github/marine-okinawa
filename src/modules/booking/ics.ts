/** 予約をカレンダーアプリに追加するための iCalendar（.ics） */
export function buildBookingIcs(p: {
  uid: string;
  title: string;
  startsAt: Date;
  durationMin: number;
  location: string;
  description: string;
  now: Date;
}): string {
  const stamp = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  // RFC 5545：カンマ・セミコロン・バックスラッシュ・改行をエスケープする
  const text = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const end = new Date(p.startsAt.getTime() + p.durationMin * 60_000);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//marine-okinawa//booking//JA',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${p.uid}`,
    `DTSTAMP:${stamp(p.now)}`,
    `DTSTART:${stamp(p.startsAt)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${text(p.title)}`,
    `LOCATION:${text(p.location)}`,
    `DESCRIPTION:${text(p.description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
