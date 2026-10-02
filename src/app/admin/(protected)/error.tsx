'use client';

import { ConsoleError } from '@/components/backoffice/console-error';

export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ConsoleError error={error} retry={retry} home={{ href: '/admin', label: 'ダッシュボードへ' }} />;
}
