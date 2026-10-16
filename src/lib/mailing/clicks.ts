// Telling people's clicks from machines'. Mail security scanners (Microsoft Defender Safe Links,
// Proofpoint, Mimecast, Barracuda and the like) follow every link in an email seconds after it arrives,
// so raw click counts overstate interest. Each click gets a verdict, machine, likely_human or human, with
// the reasons for it, and a send's clicks are judged again whenever a new click or webhook arrives for
// it, since later evidence (a click on the hidden link, a burst) changes earlier ones. The scanner lists
// below need occasional updates; each verdict records which rule fired, so they can be tuned from real
// data. Server only (the lists use node:net).
import { BlockList, isIP } from 'node:net';

export type Verdict = 'machine' | 'likely_human' | 'human';

/** User agents of mail scanners, link previewers and scripts. */
const SCANNER_UA = /bot\b|crawler|spider|preview|scanner|barracuda|mimecast|proofpoint|safelinks|ms-office|microsoft office|outlook-ios-linkpreview|google-?safety|googleimageproxy|ironport|cisco|symantec|messagelabs|trendmicro|trend micro|forcepoint|sophos|fireeye|zscaler|checkpoint|libwww|curl\/|wget\/|python-requests|python-urllib|go-http-client|okhttp|java\/|axios\/|node-fetch|headlesschrome|phantomjs|slackbot|facebookexternalhit|whatsapp|discordbot|twitterbot|linkedinbot|skypeuripreview/i;

/** Address ranges mail scanners click from (the mail filters of Microsoft, Google, Proofpoint, Mimecast, Barracuda). */
const SCANNER_NETS: [string, number, 'ipv4' | 'ipv6'][] = [
  // Microsoft Exchange Online Protection
  ['40.92.0.0', 15, 'ipv4'],
  ['40.107.0.0', 16, 'ipv4'],
  ['52.100.0.0', 14, 'ipv4'],
  ['104.47.0.0', 17, 'ipv4'],
  ['2a01:111:f400::', 48, 'ipv6'],
  ['2a01:111:f403::', 48, 'ipv6'],
  // Google's crawlers and image proxy
  ['66.249.64.0', 19, 'ipv4'],
  ['66.102.0.0', 20, 'ipv4'],
  // Proofpoint
  ['148.163.128.0', 19, 'ipv4'],
  ['67.231.144.0', 20, 'ipv4'],
  ['205.220.160.0', 19, 'ipv4'],
  // Mimecast
  ['205.139.110.0', 24, 'ipv4'],
  ['207.211.30.0', 24, 'ipv4'],
  ['216.205.24.0', 24, 'ipv4'],
  ['170.10.128.0', 22, 'ipv4'],
  ['185.58.84.0', 22, 'ipv4'],
  // Barracuda
  ['64.235.144.0', 20, 'ipv4'],
  ['209.222.80.0', 21, 'ipv4'],
];

/** Apple's Mail Privacy Protection fetches images (opens) through its own proxies. */
const PRIVACY_NETS: [string, number, 'ipv4' | 'ipv6'][] = [['17.0.0.0', 8, 'ipv4']];

const list = (nets: [string, number, 'ipv4' | 'ipv6'][]) => {
  const b = new BlockList();
  for (const [net, prefix, family] of nets) b.addSubnet(net, prefix, family);
  return b;
};
const SCANNERS = list(SCANNER_NETS);
const PRIVACY = list(PRIVACY_NETS);

const inList = (b: BlockList, ip: string) => {
  const family = isIP(ip);
  return !!family && b.check(ip, family === 6 ? 'ipv6' : 'ipv4');
};

export const scannerAgent = (ua: string) => !ua.trim() || SCANNER_UA.test(ua);
export const scannerAddress = (ip: string) => inList(SCANNERS, ip);
export const privacyProxy = (ip: string, ua = '') => inList(PRIVACY, ip) || /privacy|mpp/i.test(ua);

/** An address cut to its network: /24 of IPv4, /48 of IPv6 (the burst and network rules; never stored whole). */
export function ipPrefix(ip: string): string {
  const v4 = ip.replace(/^::ffff:/i, '');
  if (isIP(v4) === 4) return `${v4.split('.').slice(0, 3).join('.')}.0/24`;
  if (isIP(ip) === 6) {
    const full = ip.includes('::') ? expand6(ip) : ip.split(':');
    return `${full.slice(0, 3).join(':')}::/48`;
  }
  return '';
}
function expand6(ip: string): string[] {
  const [head, tail] = ip.split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  return [...a, ...Array(8 - a.length - b.length).fill('0'), ...b];
}

/** A click as recorded (link_clicks), with what the rules need. */
export interface Click {
  id: number;
  link_id: number;
  at: string;
  method: string;
  user_agent: string;
  ip_prefix: string;
  /** The hidden link. */
  honeypot: boolean;
  /** Matched the scanner address ranges when it came in (the address itself isn't kept). */
  scannerIp: boolean;
  confirmed_at: string | null;
}

export interface Judged {
  id: number;
  verdict: Verdict;
  reasons: string[];
}

export const RULES = { burstLinks: 3, burstMs: 5_000, afterDeliveryMs: 10_000, honeypotWindowMs: 2 * 60_000, laterHumanMs: 2 * 60_000 };

/**
 * One send's clicks judged together (`delivered`: its delivered event's time, if any). Machine: a HEAD
 * request, the hidden link (and every click within 2 minutes of it), a scanner's user agent or address,
 * a burst of 3 or more different links within 5 seconds, or a click within 10 seconds of delivery with
 * no later sign of a person. Human: the visitor interacted with the page the link led to. Likely human:
 * the rest (a click more than 2 minutes after a machine burst, from another network, too).
 */
export function judge(clicks: Click[], delivered: string | null): Judged[] {
  const sorted = [...clicks].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
  const t = (c: Click) => Date.parse(c.at);
  const reasons = new Map<number, string[]>(sorted.map((c) => [c.id, []]));
  const add = (c: Click, r: string) => {
    const list = reasons.get(c.id)!;
    if (!list.includes(r)) list.push(r);
  };
  const traps = sorted.filter((c) => c.honeypot);
  for (const c of sorted) {
    if (c.method === 'HEAD') add(c, 'head-request');
    if (c.honeypot) add(c, 'hidden-link');
    if (traps.some((h) => Math.abs(t(h) - t(c)) <= RULES.honeypotWindowMs)) add(c, 'near-hidden-link');
    if (scannerAgent(c.user_agent)) add(c, 'scanner-agent');
    if (c.scannerIp) add(c, 'scanner-address');
    // A burst: this click and others on different links within 5 seconds.
    const near = sorted.filter((o) => Math.abs(t(o) - t(c)) <= RULES.burstMs && !o.honeypot);
    if (new Set(near.map((o) => o.link_id)).size >= RULES.burstLinks) add(c, 'burst');
  }
  const machine = (c: Click) => reasons.get(c.id)!.length > 0 && !c.confirmed_at;
  // Within 10 seconds of delivery, unless a person showed up later (an interaction, or a click that isn't a machine's).
  if (delivered) {
    const d = Date.parse(delivered);
    const later = sorted.some((o) => o.confirmed_at || (!machine(o) && t(o) - d > RULES.afterDeliveryMs));
    for (const c of sorted) if (!later && t(c) >= d && t(c) - d <= RULES.afterDeliveryMs && !c.confirmed_at) add(c, 'right-after-delivery');
  }
  return sorted.map((c) => {
    if (c.confirmed_at) return { id: c.id, verdict: 'human', reasons: ['interaction'] };
    const r = reasons.get(c.id)!;
    if (r.length) return { id: c.id, verdict: 'machine', reasons: r };
    const afterMachine = sorted.some((o) => machine(o) && t(c) - t(o) > RULES.laterHumanMs && o.ip_prefix !== c.ip_prefix);
    return { id: c.id, verdict: 'likely_human', reasons: afterMachine ? ['later-other-network'] : [] };
  });
}

/** An open's verdict from Mailgun's client info: a scanner, a privacy proxy (Apple's), or likely a person. */
export function openVerdict(ip: string, ua: string, clientType = ''): 'machine' | 'privacy' | 'likely_human' {
  if (privacyProxy(ip, ua)) return 'privacy';
  if (scannerAddress(ip) || /robot|bot/i.test(clientType) || (ua && SCANNER_UA.test(ua) && !/googleimageproxy/i.test(ua))) return 'machine';
  return 'likely_human';
}
