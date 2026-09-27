import Link from 'next/link';
import { db } from '@/db';
import { requireAdmin } from '@/modules/auth/guard';
import { listOperators } from '@/modules/catalog/menus';
import { createMenuAction } from '../actions';
import { MenuForm } from '../menu-form';

export const metadata = { title: 'メニューを追加' };

export default async function NewMenuPage() {
  const admin = await requireAdmin();
  const operators = await listOperators(db, admin.shopId);
  return (
    <div className="space-y-4">
      <Link href="/admin/menus" className="text-sm text-slate-600">
        ← メニュー一覧へ
      </Link>
      <h1 className="text-xl font-bold">メニューを追加</h1>
      <p className="text-sm text-slate-600">保存後、「回の設定」で開始時刻と定員を登録すると予約を受け付けられます。</p>
      <MenuForm
        action={createMenuAction}
        operators={operators}
        submitLabel="作成して回の設定へ"
        initial={{
          slug: '',
          status: 'draft',
          category: 'snorkeling',
          durationMin: 120,
          minAge: null,
          maxPartySize: 10,
          bookingCutoffMin: 120,
          cutoffPrevDayTime: null,
          operatorId: null,
          capacityUnit: '名',
          title: '',
          description: '',
          meetingPoint: '',
          whatToBring: '',
          summary: '',
          included: '',
          conditions: '',
          notes: '',
          images: [],
          prices: [
            { label: '大人', price: 0, season: null },
            { label: '子供', price: 0, season: null },
          ],
        }}
      />
    </div>
  );
}
