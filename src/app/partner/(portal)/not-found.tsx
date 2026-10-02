import { ConsoleNotFound } from '@/components/backoffice/console-error';

export default function PartnerNotFound() {
  return <ConsoleNotFound home={{ href: '/partner', label: 'ホームへ' }} />;
}
