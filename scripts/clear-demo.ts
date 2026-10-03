/**
 * scripts/seed-demo.ts で入れたデモのデータだけを消す（本番の公開の前など）。
 *   npm run clear:demo            … 消すものの件数を出すだけ（何も消さない）
 *   npm run clear:demo -- --apply … 消す（1 つのトランザクション。途中で失敗したら何も消さない）
 * - デモの見分け方：お客様・お問い合わせ・登録申請のメールが demo+…@example.com、プランの slug が demo-…
 * - 精算は、デモの予約だけでできているものだけを消す。実際の予約が混ざった精算があれば、何も消さずに止める
 * - 操作の記録（audit_logs）は書き換え・消去できない決まりなので残る（デモの予約への操作として残る）
 * - 手元（localhost）以外の DB で --apply するときは、CLEAR_DEMO_CONFIRM=yes が要る
 */
import { db } from '@/db';
import { getDatabaseUrl } from '@/db/url';

const DEMO_EMAIL = 'demo+%@example.com';

async function main() {
  const apply = process.argv.includes('--apply');
  const host = new URL(getDatabaseUrl()).hostname;
  if (apply && !['localhost', '127.0.0.1'].includes(host) && process.env.CLEAR_DEMO_CONFIRM !== 'yes') {
    throw new Error(`手元以外の DB（${host}）です。消してよいときだけ CLEAR_DEMO_CONFIRM=yes を付けて動かしてください`);
  }
  const client = await db.$client.connect();
  try {
    await client.query('begin');
    await client.query(
      `create temp table demo_bookings on commit drop as
         select b.id from bookings b join customers c on c.id = b.customer_id where c.email_normalized like $1`,
      [DEMO_EMAIL],
    );
    await client.query(
      `create temp table demo_settlements on commit drop as
         select distinct si.settlement_id as id from settlement_items si where si.booking_id in (select id from demo_bookings)`,
    );
    const mixed = await client.query(
      `select count(*)::int as n from settlement_items si
       where si.settlement_id in (select id from demo_settlements) and si.booking_id not in (select id from demo_bookings)`,
    );
    if (mixed.rows[0].n > 0) throw new Error('実際の予約が混ざった精算があります。精算を確かめてから消してください');

    const count = async (label: string, sql: string, params: unknown[] = []) => {
      const r = await client.query(`select count(*)::int as n from ${sql}`, params);
      console.info(`  ${label}: ${r.rows[0].n}`);
    };
    console.info(apply ? '次のデモのデータを消します' : '消すもの（--apply を付けると消します）');
    await count('予約', 'demo_bookings');
    await count('精算', 'demo_settlements');
    await count('お客様', 'customers where email_normalized like $1', [DEMO_EMAIL]);
    await count('お問い合わせ', 'inquiries where email like $1', [DEMO_EMAIL]);
    await count('登録申請', 'operator_applications where email like $1', [DEMO_EMAIL]);
    await count('デモのプラン', `menus where slug like 'demo-%'`);
    await count(
      '消せずに残る操作の記録',
      `audit_logs where target_type = 'booking' and target_id in (select id::text from demo_bookings)`,
    );
    if (!apply) {
      await client.query('rollback');
      return;
    }

    const run = (sql: string, params: unknown[] = []) => client.query(sql, params);
    const inDemo = '(select id from demo_bookings)';
    const demoPayments = `(select id from payments where booking_id in ${inDemo})`;
    await run(`delete from settlement_adjustments where booking_id in ${inDemo}`);
    await run(`delete from settlement_items where settlement_id in (select id from demo_settlements)`);
    await run(`delete from settlements where id in (select id from demo_settlements)`);
    for (const table of [
      'notifications',
      'booking_operator_requests',
      'booking_status_events',
      'booking_items',
      'booking_access_tokens',
    ]) {
      await run(`delete from ${table} where booking_id in ${inDemo}`);
    }
    await run(`delete from payment_events where payment_id in ${demoPayments}`);
    await run(`delete from payment_refunds where payment_id in ${demoPayments}`);
    await run(`delete from payment_receipts where payment_id in ${demoPayments}`);
    await run(`delete from payments where booking_id in ${inDemo}`);
    await run(`delete from bookings where id in ${inDemo}`);
    const demoCustomers = `(select id from customers where email_normalized like $1)`;
    await run(
      `delete from customer_merge_candidates where customer_id in ${demoCustomers} or other_customer_id in ${demoCustomers}`,
      [DEMO_EMAIL],
    );
    await run(`delete from notifications where customer_id in ${demoCustomers}`, [DEMO_EMAIL]);
    await run(`delete from customers where email_normalized like $1`, [DEMO_EMAIL]);
    await run(`delete from inquiries where email like $1`, [DEMO_EMAIL]);
    await run(`delete from operator_applications where email like $1`, [DEMO_EMAIL]);
    // デモのプラン（予約はもう残っていない）。料金・回のルールなどはプランと一緒に消える
    await run(`delete from slots where menu_id in (select id from menus where slug like 'demo-%')`);
    await run(`delete from menus where slug like 'demo-%'`);
    // デモで天候中止にした回を戻し、予約済みの人数を数え直す
    await run(
      `update slots s set status = 'open'
       where s.status = 'weather_cancelled' and not exists (select 1 from bookings b where b.slot_id = s.id)`,
    );
    await run(
      `update slots s set reserved_count = coalesce((
         select sum(b.party_size) from bookings b
         where b.slot_id = s.id and b.status not in ('cancelled', 'weather_cancelled')
       ), 0)`,
    );
    await client.query('commit');
    console.info('消しました');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
