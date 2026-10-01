import type { z } from 'zod';

/** 画面に出す入力エラー（field は入力欄の id。エラー一覧からその欄へ移動するのに使う） */
export type FormIssue = { field: string; message: string };

/** 管理画面のフォームの状態（Server Action の戻り値） */
export type AdminFormState = { error: string | null; issues?: FormIssue[] };

const hasJapanese = (text: string) => /[぀-ヿ一-龯]/.test(text);

/** zod の既定メッセージ（英語）を、項目名なしの日本語にする。スキーマ側で日本語を指定していればそれを使う */
function issueMessage(issue: z.core.$ZodIssue): string {
  if (hasJapanese(issue.message)) return issue.message;
  switch (issue.code) {
    case 'too_small': {
      const min = Number(issue.minimum);
      if (issue.origin === 'string') return min <= 1 ? '入力してください' : `${min} 文字以上で入力してください`;
      if (issue.origin === 'array' || issue.origin === 'set') return `${min} 件以上登録してください`;
      return `${min} 以上にしてください`;
    }
    case 'too_big': {
      const max = Number(issue.maximum);
      if (issue.origin === 'string') return `${max} 文字以内で入力してください`;
      if (issue.origin === 'array' || issue.origin === 'set') return `${max} 件までにしてください`;
      return `${max} 以下にしてください`;
    }
    case 'invalid_type':
      return issue.expected === 'number' ? '数字で入力してください' : '入力してください';
    case 'invalid_format':
      return issue.format === 'email' ? 'メールアドレスの形式が正しくありません' : '形式が正しくありません';
    case 'invalid_value':
      return '選択肢から選んでください';
    case 'not_multiple_of':
      return '整数で入力してください';
    default:
      return '入力内容を確認してください';
  }
}

/**
 * zod のエラーを「項目名：内容」の一覧にする。labels は入力欄の name → 項目名。
 * 配列の項目（例：prices.0.label）は fieldFor で入力欄の id と項目名を決められる
 */
export function toFormIssues(
  error: z.ZodError,
  labels: Record<string, string>,
  fieldFor?: (path: PropertyKey[]) => { field: string; label: string } | null,
): FormIssue[] {
  const seen = new Set<string>();
  const issues: FormIssue[] = [];
  for (const issue of error.issues) {
    const custom = fieldFor?.(issue.path);
    const key = String(issue.path[0] ?? '');
    const field = custom?.field ?? key;
    const label = custom?.label ?? labels[key] ?? '入力内容';
    const message = `${label}：${issueMessage(issue)}`;
    if (seen.has(message)) continue;
    seen.add(message);
    issues.push({ field, message });
  }
  return issues;
}

export function invalidState(issues: FormIssue[]): AdminFormState {
  return { error: '入力内容を確認してください。', issues };
}
