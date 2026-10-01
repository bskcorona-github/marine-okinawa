import { render } from '@react-email/components';
import { beforeEach, describe, expect, it } from 'vitest';
import { notifications } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedShop } from '../../../tests/helpers/fixtures';
import type { Mailer, MailMessage } from '../notification/mailer';
import {
  countNewInquiries,
  createInquiry,
  getInquiry,
  listInquiries,
  sendInquiryMails,
  updateInquiry,
} from './inquiries';
import { getSitePage, isSitePageSlug, listSitePages, saveSitePage } from './pages';

const db = getTestDb();
const NOW = new Date('2026-09-28T00:00:00Z');

function fakeMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      return { id: `msg-${sent.length}` };
    },
  };
}

describe('固定ページ', () => {
  beforeEach(() => resetDb(db));

  it('保存がなければ初期文、保存したらその内容（ショップごと）', async () => {
    const shop = await seedShop(db);
    const other = await seedShop(db, { name: '別ショップ' });
    expect(await getSitePage(db, { shopId: shop.id, slug: 'privacy' })).toMatchObject({
      title: 'プライバシーポリシー',
      saved: false,
    });
    await saveSitePage(db, {
      shopId: shop.id,
      slug: 'privacy',
      input: { title: '個人情報の取扱い', body: '## 目的\n本文' },
      actorId: null,
    });
    await saveSitePage(db, {
      shopId: shop.id,
      slug: 'privacy',
      input: { title: '個人情報の取扱い', body: '## 目的\n更新した本文' },
      actorId: null,
    });
    expect(await getSitePage(db, { shopId: shop.id, slug: 'privacy' })).toMatchObject({
      title: '個人情報の取扱い',
      body: '## 目的\n更新した本文',
      saved: true,
    });
    expect((await getSitePage(db, { shopId: other.id, slug: 'privacy' })).saved).toBe(false);
    // Object の組み込みのキーは固定ページとして扱わない
    expect(isSitePageSlug('privacy')).toBe(true);
    expect(isSitePageSlug('toString')).toBe(false);
    expect(isSitePageSlug('__proto__')).toBe(false);
    expect((await listSitePages(db, shop.id)).map((p) => p.slug)).toEqual([
      'guide',
      'how-to-book',
      'safety',
      'privacy',
      'about',
    ]);
  });
});

describe('お問い合わせ', () => {
  beforeEach(() => resetDb(db));

  it('保存して、お客様への受付メールと組合への通知を送る。対応状況を更新できる', async () => {
    const shop = await seedShop(db, {
      name: '沖縄県マリンレジャー事業協同組合',
      profile: { email: 'info@kumiai.example.com' },
    });
    const { id } = await createInquiry(db, {
      shopId: shop.id,
      input: {
        kind: 'group',
        name: '学校 先生',
        email: 'Teacher@School.example.com',
        phone: '',
        message: '修学旅行で 40 名',
      },
      now: NOW,
    });
    expect(await countNewInquiries(db, shop.id)).toBe(1);
    const inquiry = await getInquiry(db, { shopId: shop.id, inquiryId: id });
    expect(inquiry).toMatchObject({
      email: 'teacher@school.example.com',
      phone: null,
      consentedAt: NOW,
      status: 'new',
    });

    const mailer = fakeMailer();
    const result = await sendInquiryMails(db, mailer, { inquiryId: id, appUrl: 'https://marine.example.com' });
    expect(result).toEqual({ ack: { status: 'sent' }, admin: { status: 'sent' } });
    const [ack, admin] = mailer.sent;
    expect(ack.to).toBe('teacher@school.example.com');
    expect(ack.replyTo).toBe('info@kumiai.example.com');
    // お客様への受付メールには本文を載せない（他人のアドレスで任意の文面を送らせない）。組合への通知には載せる
    expect(await render(ack.react)).not.toContain('修学旅行で 40 名');
    expect(await render(admin.react)).toContain('修学旅行で 40 名');
    expect(admin).toMatchObject({ to: 'info@kumiai.example.com', replyTo: 'teacher@school.example.com' });
    expect(admin.subject).toBe('【お問い合わせ】団体・学校・企業のご相談（学校 先生 様）');
    expect(await render(admin.react)).toContain(`/admin/inquiries/${id}`);
    const types = (await db.select().from(notifications)).map((n) => n.type).sort();
    expect(types).toEqual(['inquiry_ack', 'inquiry_received']);

    await updateInquiry(db, {
      shopId: shop.id,
      inquiryId: id,
      input: { status: 'done', note: '電話で回答' },
      actorId: null,
    });
    expect(await countNewInquiries(db, shop.id)).toBe(0);
    expect(await listInquiries(db, { shopId: shop.id, status: 'done' })).toHaveLength(1);
    const other = await seedShop(db, { name: '別ショップ' });
    expect(await getInquiry(db, { shopId: other.id, inquiryId: id })).toBeNull();
  });
});
