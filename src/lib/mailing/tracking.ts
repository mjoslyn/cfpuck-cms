// Tracked links: /m/c/<link>/<recipient token> records the click and sends the visitor on (the address
// comes from the link's row, never the request, so it can't be used to send anyone elsewhere). A link to
// the site itself gets #mc=<click>.<signature>; the page's mail-seen.js reports the visitor's first
// interaction there (POST /api/mail/seen), which marks the click as a person's. Every click is judged
// with the send's others (src/lib/mailing/clicks.ts). Server only.
import type { Db } from '../db/query';
import { ipPrefix, judge, scannerAddress, type Click } from './clicks';
import { sign, verify } from './tokens';
import { mailOrigin } from './contacts';

export interface ClickRequest {
  linkId: number;
  /** The recipient's token from the address (may be anything: a forwarded or edited link). */
  ct: string;
  method: string;
  userAgent: string;
  ip: string;
  country: string;
}

/** Record a click; where to send the visitor (null: no such link). */
export async function recordClick(db: Db, r: ClickRequest): Promise<string | null> {
  const { data: link } = await db.from('campaign_links').select('id, campaign_id, url, kind').eq('id', r.linkId).maybeSingle();
  if (!link) return null;
  const contact = verify('click', r.ct);
  const { data: click, error } = await db
    .from('link_clicks')
    .insert({ link_id: link.id, campaign_id: link.campaign_id, contact_id: contact, method: r.method === 'HEAD' ? 'HEAD' : 'GET', user_agent: r.userAgent.slice(0, 500), ip_prefix: ipPrefix(r.ip), country: r.country.slice(0, 8), scanner_ip: scannerAddress(r.ip) })
    .select('id')
    .single();
  if (error) console.error(`mailing: click not recorded: ${error.message}`);
  else if (contact) await rejudgeSend(db, Number(link.campaign_id), contact).catch((e) => console.error(`mailing: click judging failed: ${e.message}`));
  if (link.kind === 'honeypot') return `${mailOrigin()}/`;
  return click && r.method !== 'HEAD' ? withSeen(String(link.url), Number(click.id)) : String(link.url);
}

/** A link to the site itself carries the click's signed id in its fragment, unless it already has a fragment. */
export function withSeen(url: string, clickId: number): string {
  try {
    const u = new URL(url);
    if (u.origin !== new URL(mailOrigin()).origin || u.hash) return url;
    u.hash = `mc=${sign('seen', clickId)}`;
    return u.toString();
  } catch {
    return url;
  }
}

/** The visitor interacted with the page a tracked link led to: that click was a person's. */
export async function confirmSeen(db: Db, token: unknown): Promise<boolean> {
  const id = verify('seen', token);
  if (!id) return false;
  const { data } = await db.from('link_clicks').update({ confirmed_at: new Date().toISOString() }).eq('id', id).is('confirmed_at', null).select('campaign_id, contact_id');
  const row = data?.[0];
  if (row?.contact_id) await rejudgeSend(db, Number(row.campaign_id), Number(row.contact_id));
  return !!row;
}

/** Judge one send's clicks again and write each verdict, and the send's first person's and machine's click. */
export async function rejudgeSend(db: Db, campaign: number, contact: number): Promise<void> {
  const [{ data: rows }, { data: send }, { data: traps }] = await Promise.all([
    db.from('link_clicks').select('id, link_id, at, method, user_agent, ip_prefix, scanner_ip, confirmed_at, verdict, reasons').eq('campaign_id', campaign).eq('contact_id', contact).order('at').limit(500),
    db.from('campaign_sends').select('delivered_at').eq('campaign_id', campaign).eq('contact_id', contact).maybeSingle(),
    db.from('campaign_links').select('id').eq('campaign_id', campaign).eq('kind', 'honeypot'),
  ]);
  if (!rows?.length) return;
  const trapIds = new Set((traps ?? []).map((t) => Number(t.id)));
  const clicks: Click[] = rows.map((r) => ({ id: Number(r.id), link_id: Number(r.link_id), at: r.at, method: r.method, user_agent: r.user_agent, ip_prefix: r.ip_prefix, honeypot: trapIds.has(Number(r.link_id)), scannerIp: !!r.scanner_ip, confirmed_at: r.confirmed_at }));
  const judged = judge(clicks, send?.delivered_at ?? null);
  for (const j of judged) {
    const before = rows.find((r) => Number(r.id) === j.id)!;
    if (before.verdict === j.verdict && JSON.stringify(before.reasons ?? []) === JSON.stringify(j.reasons)) continue;
    await db.from('link_clicks').update({ verdict: j.verdict, reasons: j.reasons }).eq('id', j.id);
  }
  const at = (v: (j: (typeof judged)[number]) => boolean) => {
    const first = judged.filter(v).map((j) => clicks.find((c) => c.id === j.id)!.at).sort()[0];
    return first ?? null;
  };
  await db
    .from('campaign_sends')
    .update({ clicked_at: at((j) => j.verdict !== 'machine'), machine_clicked_at: at((j) => j.verdict === 'machine'), human_confirmed_at: at((j) => j.verdict === 'human') })
    .eq('campaign_id', campaign)
    .eq('contact_id', contact);
}

/** A campaign's links with their clicks by verdict (all clicks, and distinct people). */
export async function linkStats(db: Db, campaign: number) {
  const [{ data: links }, { data: clicks }] = await Promise.all([
    db.from('campaign_links').select('id, url, label, position, kind').eq('campaign_id', campaign).order('position'),
    db.from('link_clicks').select('link_id, contact_id, verdict').eq('campaign_id', campaign).limit(100_000),
  ]);
  return (links ?? []).map((l) => {
    const mine = (clicks ?? []).filter((c) => Number(c.link_id) === Number(l.id));
    const of = (v: string) => mine.filter((c) => c.verdict === v);
    const people = (list: typeof mine) => new Set(list.map((c) => c.contact_id ?? `x${Math.random()}`)).size;
    return { ...l, human: of('human').length, humanUnique: people(of('human')), likely: of('likely_human').length, likelyUnique: people(of('likely_human')), machine: of('machine').length };
  });
}
