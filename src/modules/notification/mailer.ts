import type { ReactElement } from 'react';
import { Resend } from 'resend';
import { getEnv } from '@/lib/env';

export type MailMessage = { to: string; subject: string; react: ReactElement };

export interface Mailer {
  send(message: MailMessage): Promise<{ id: string }>;
}

export function createResendMailer(apiKey: string, from: string): Mailer {
  const resend = new Resend(apiKey);
  return {
    async send(message) {
      const { data, error } = await resend.emails.send({
        from,
        to: message.to,
        subject: message.subject,
        react: message.react,
      });
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
