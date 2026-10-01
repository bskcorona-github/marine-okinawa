import type { Page } from '@playwright/test';

/**
 * 申込フォームの入力エラー。各欄の下のエラー（id が「…-error」の要素）を探す
 * （同じ文言は、フォームの下の「エラーの一覧」にも出るため）
 */
export function fieldError(page: Page, text: string) {
  return page.locator('[id$="-error"]', { hasText: text });
}

/** フォームの下の「エラーの一覧」の、その欄へ移動するリンク */
export function errorSummaryLink(page: Page, text: string) {
  return page.getByRole('alert').getByRole('link', { name: new RegExp(text) });
}
