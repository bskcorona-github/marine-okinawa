import { ConsoleNotFound } from '@/components/backoffice/console-error';

export default function AdminNotFound() {
  return <ConsoleNotFound home={{ href: '/admin', label: 'ダッシュボードへ' }} />;
}
