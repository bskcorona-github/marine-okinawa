/** CSV の 1 項目。カンマ・改行・ダブルクォートを含むときはクォートし、数式として読まれる先頭文字は無害化する */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Excel で開いたときに =・+・-・@ で始まる文字列が数式として実行されないようにする（数値はそのまま）
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 見出しと行から CSV を作る（Excel で文字化けしないよう BOM つき・改行は CRLF） */
export function toCsv(headers: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]) {
  const lines = [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** CSV のダウンロードの応答（個人情報を含むのでキャッシュさせない） */
export function csvResponse(body: string, fileName: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
      ...headers,
    },
  });
}
