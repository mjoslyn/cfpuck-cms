// IP addresses and subnets, without node:net (the Worker runtime has no BlockList): what an address is
// and whether it falls in any of some subnets. An IPv4 address written as IPv6 (::ffff:1.2.3.4, or
// ::ffff:102:304 as URLs write it) is checked as the IPv4 address it is, as Node's BlockList does.

const V4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** 4 for IPv4, 6 for IPv6, 0 for anything else. */
export function isIP(s: string): 0 | 4 | 6 {
  if (V4.test(s)) return 4;
  return v6Bits(s) === null ? 0 : 6;
}

const v4Bits = (s: string): bigint => s.split('.').reduce((n, p) => (n << 8n) | BigInt(Number(p)), 0n);

/** An IPv6 address as a 128-bit number, or null when it isn't one. */
function v6Bits(raw: string): bigint | null {
  let s = raw.toLowerCase();
  if (!s.includes(':') || /[^0-9a-f:.]/.test(s)) return null;
  // A trailing dotted IPv4 part (::ffff:1.2.3.4) becomes two groups.
  const dotted = s.match(/^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (dotted) {
    if (!V4.test(dotted[2])) return null;
    const n = v4Bits(dotted[2]);
    s = `${dotted[1]}${(n >> 16n).toString(16)}:${(n & 0xffffn).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.reduce((n, g) => (n << 16n) | BigInt(parseInt(g, 16)), 0n);
}

const MAPPED = 0xffffn << 32n;

/** An address as [family, bits]: IPv4-mapped IPv6 addresses as IPv4. */
function parse(ip: string): [4 | 6, bigint] | null {
  if (V4.test(ip)) return [4, v4Bits(ip)];
  const bits = v6Bits(ip);
  if (bits === null) return null;
  if (bits >> 32n === MAPPED >> 32n) return [4, bits & 0xffffffffn];
  return [6, bits];
}

/** Subnets of either family, and whether an address is in any of them. */
export class SubnetList {
  private nets: { family: 4 | 6; base: bigint; prefix: number }[] = [];

  addSubnet(net: string, prefix: number, family: 'ipv4' | 'ipv6'): void {
    const p = parse(net);
    const f = family === 'ipv4' ? 4 : 6;
    if (!p || p[0] !== f) throw new Error(`not an ${family} subnet: ${net}/${prefix}`);
    this.nets.push({ family: f, base: p[1] >> BigInt((f === 4 ? 32 : 128) - prefix), prefix });
  }

  check(ip: string): boolean {
    const p = parse(ip);
    if (!p) return false;
    const [family, bits] = p;
    const width = family === 4 ? 32 : 128;
    return this.nets.some((n) => n.family === family && bits >> BigInt(width - n.prefix) === n.base);
  }
}
