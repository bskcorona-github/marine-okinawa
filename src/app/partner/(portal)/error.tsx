'use client';

import { ConsoleError } from '@/components/backoffice/console-error';

export default function PartnerError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ConsoleError error={error} retry={retry} home={{ href: '/partner', label: 'ホームへ' }} />;
}
