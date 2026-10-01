import type { ReactElement } from 'react';
import { Resend } from 'resend';
import { getEnv } from '@/lib/env';

export type MailMessage = {
  to: string;
  subject: string;
  react: ReactElement;
  /** 返信先（ショップの問い合わせ用メールアドレス）。送信元は送信専用のアドレスのため */
  replyTo?: string;
  /** 同じメールを二重に送らないためのキー（送信サービスに渡す） */
  idempotencyKey?: string;
};

/** 送信サービスの応答を待ちきれなかった（送れたかどうか分からない） */
export class MailTimeoutError extends Error {
  constructor(ms: number) {
    super(`mail send timed out after ${ms}ms`);
    this.name = 'MailTimeoutError';
  }
}

export interface Mailer {
  send(message: MailMessage): Promise<{ id: string }>;
}

/** メール送信の待ち時間の上限（送信中に予約の行をロックしている処理があるため、長く待たない） */
const SEND_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new MailTimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createResendMailer(apiKey: string, from: string): Mailer {
  const resend = new Resend(apiKey);
  return {
    async send(message) {
      const { data, error } = await withTimeout(
        resend.emails.send(
          {
            from,
            to: message.to,
            subject: message.subject,
            react: message.react,
            ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          },
          message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : undefined,
        ),
        SEND_TIMEOUT_MS,
      );
      if (error || !data) throw new Error(`resend: ${error?.message ?? 'no response data'}`);
      return { id: data.id };
    },
  };
}

/** 開発・テスト用：送信せずにコンソールへ出す */
export function createLogMailer(): Mailer {
  return {
    async send(message) {
      console.info(`[mail] to=${message.to} subject=${message.subject}`);
      return { id: `log-${Date.now()}` };
    },
  };
}

export function getMailer(): Mailer {
  const env = getEnv();
  if (env.MAIL_DRIVER === 'resend') {
    if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required when MAIL_DRIVER=resend');
    return createResendMailer(env.RESEND_API_KEY, env.MAIL_FROM);
  }
  return createLogMailer();
}
