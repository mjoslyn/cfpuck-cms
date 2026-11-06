// The email log (src/lib/mail-log.ts): while it is on, sendMail keeps each email; sign-in and
// confirmation emails without their body; Mailing Lists' emails never. Old entries are pruned.
import { beforeEach, describe, expect, it } from 'vitest';
import { siteDb } from '../src/lib/db/site';
import { sendMail } from '../src/lib/forms/mail';
import { passwordEmail, sendLink } from '../src/lib/auth/mail';
import { pruneMailLog, resetMailLogCache } from '../src/lib/mail-log';

async function setLog(mail_log: Record<string, unknown> | undefined) {
  const db = siteDb();
  const { data } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  await db.from('settings').upsert({ key: 'site', value: { ...((data?.value as object) ?? {}), mail_log } });
  resetMailLogCache();
}
const logged = async () => ((await siteDb().from('mail_log').select('*').order('id')).data ?? []) as any[];

describe('email log', () => {
  beforeEach(async () => {
    await siteDb().from('mail_log').delete().gte('id', 0);
  });

  it('keeps nothing while it is off', async () => {
    await setLog(undefined);
    await sendMail({ to: ['a@example.org'], subject: 'Hello', html: '<p>Hi</p>', kind: 'form' });
    expect(await logged()).toEqual([]);
  });

  it('keeps each email, and sign-in links without their body, and no Mailing Lists email', async () => {
    await setLog({ enabled: true, days: 30 });
    // No mail is set up in tests: the email is logged as not sent.
    expect(await sendMail({ to: ['a@example.org'], subject: 'New entry', html: '<p>Answers</p>', kind: 'form', replyTo: 'b@example.org' })).toBe(false);
    await sendLink(passwordEmail('c@example.org', 'https://example.org/admin/set-password/?token=SECRET'));
    await sendMail({ to: ['d@example.org'], subject: 'Confirm your subscription', html: '<p>Confirm</p>', kind: 'mailing' });
    const rows = await logged();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: 'form', to_addresses: 'a@example.org', reply_to: 'b@example.org', subject: 'New entry', html: '<p>Answers</p>', status: 'not-sent', withheld: false });
    expect(rows[0].text).toContain('Answers');
    expect(rows[1]).toMatchObject({ kind: 'account', to_addresses: 'c@example.org', html: null, text: null, withheld: true });
    expect(JSON.stringify(rows)).not.toContain('SECRET');
  });

  it('prunes entries past their days, and all of them once the log is off', async () => {
    await setLog({ enabled: true, days: 7 });
    const db = siteDb();
    await db.from('mail_log').insert([
      { subject: 'old', created_at: new Date(Date.now() - 8 * 86_400_000).toISOString() },
      { subject: 'new', created_at: new Date().toISOString() },
    ]);
    await pruneMailLog(db);
    expect((await logged()).map((r) => r.subject)).toEqual(['new']);
    await setLog({ enabled: false });
    await pruneMailLog(db);
    expect(await logged()).toEqual([]);
  });
});
