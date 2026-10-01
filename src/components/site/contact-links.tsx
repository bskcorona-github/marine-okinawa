import { Mail, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { telHref, type Contact } from '@/modules/shop/contact';

const BUTTON: Record<'foam' | 'white', string> = {
  foam: 'bg-foam hover:bg-lagoon-soft',
  white: 'bg-white ring-1 ring-ocean/15 hover:bg-lagoon-soft',
};

/** 電話（受付時間・事業者名つき）とメールのリンク。tone は置く場所の背景に合わせたボタンの色 */
export function ContactLinks({
  contact,
  tone = 'foam',
  className,
}: {
  contact: Contact;
  tone?: 'foam' | 'white';
  className?: string;
}) {
  const button = cn(
    'inline-flex min-h-12 max-w-full flex-wrap items-center gap-x-2 rounded-xl px-4 py-2 font-bold text-ocean',
    BUTTON[tone],
  );
  return (
    <div className={cn('space-y-2', className)}>
      {contact.phone && (
        <div>
          <a href={telHref(contact.phone)} className={button}>
            <Phone aria-hidden className="size-4 shrink-0" />
            {contact.phone}
            {contact.hours && <span className="text-sm font-normal text-ink/70">（{contact.hours}）</span>}
          </a>
          {contact.name && <p className="mt-1.5 text-xs text-ink/70">{contact.name}</p>}
        </div>
      )}
      {contact.email && (
        <a href={`mailto:${contact.email}`} className={cn(button, 'break-all')}>
          <Mail aria-hidden className="size-4 shrink-0" />
          {contact.email}
        </a>
      )}
    </div>
  );
}
