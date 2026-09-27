import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { db } from '@/db';
import { requireAdmin } from '@/modules/auth/guard';
import { listOperators } from '@/modules/catalog/menus';
import { createOperatorAction } from './actions';

export const metadata = { title: '提供事業者' };

const ERRORS: Record<string, string> = {
  input: '入力内容を確認してください（ID は半角英小文字・数字・ハイフン）',
  slug: 'この ID は既に使われています',
};

export default async function OperatorsPage({ searchParams }: PageProps<'/admin/operators'>) {
  const admin = await requireAdmin();
  const { error } = await searchParams;
  const operators = await listOperators(db, admin.shopId);

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-bold">提供事業者</h1>
      {typeof error === 'string' && ERRORS[error] && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-800">{ERRORS[error]}</p>
      )}
      <ul className="divide-y rounded-lg border bg-white">
        {operators.map((op) => (
          <li key={op.id}>
            <Link href={`/admin/operators/${op.id}`} className="flex justify-between p-3 hover:bg-slate-50">
              <span className="font-medium">{op.name}</span>
              <span className="text-sm text-slate-500">{op.slug}</span>
            </Link>
          </li>
        ))}
        {operators.length === 0 && <li className="p-3 text-slate-500">登録されていません</li>}
      </ul>
      <form
        action={createOperatorAction}
        className="flex flex-wrap items-end gap-2 rounded-lg border bg-white p-4 text-sm"
      >
        <label className="space-y-1">
          <span className="block font-medium">事業者名</span>
          <Input name="name" required />
        </label>
        <label className="space-y-1">
          <span className="block font-medium">ID（半角英小文字）</span>
          <Input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
        </label>
        <Button type="submit">事業者を追加</Button>
      </form>
    </div>
  );
}
