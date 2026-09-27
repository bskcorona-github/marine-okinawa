import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/db';
import { requireAdmin } from '@/modules/auth/guard';
import { MENU_CATEGORY_LABELS, MENU_STATUS_LABELS } from '@/modules/booking/labels';
import { listMenusForAdmin } from '@/modules/catalog/menus';

export const metadata = { title: 'メニュー' };

export default async function MenusPage() {
  const admin = await requireAdmin();
  const menus = await listMenusForAdmin(db, admin.shopId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">メニュー</h1>
        <Link href="/admin/menus/new" className={buttonVariants()}>
          メニューを追加
        </Link>
      </div>
      <div className="rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>メニュー名</TableHead>
              <TableHead>事業者</TableHead>
              <TableHead>カテゴリ</TableHead>
              <TableHead>所要時間</TableHead>
              <TableHead>状態</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {menus.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <Link href={`/admin/menus/${m.id}`} className="font-medium underline">
                    {m.title}
                  </Link>
                </TableCell>
                <TableCell>{m.operatorName ?? '—'}</TableCell>
                <TableCell>{MENU_CATEGORY_LABELS[m.category]}</TableCell>
                <TableCell>{m.durationMin} 分</TableCell>
                <TableCell>
                  <Badge variant={m.status === 'published' ? 'default' : 'secondary'}>
                    {MENU_STATUS_LABELS[m.status]}
                  </Badge>
                </TableCell>
                <TableCell className="space-x-3 text-right">
                  <Link href={`/admin/menus/${m.id}/schedule`} className="underline">
                    回の設定
                  </Link>
                  {m.status === 'published' && (
                    <a href={`/ja/menus/${m.slug}`} target="_blank" rel="noreferrer" className="underline">
                      公開ページ
                    </a>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {menus.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-500">
                  メニューがありません
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
