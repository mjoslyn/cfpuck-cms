// Addresses the server must not fetch for an editor's link: its own machine and network.
import { SubnetList, isIP } from '../net';

const PRIVATE = new SubnetList();
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 3]] as const) PRIVATE.addSubnet(net, prefix, 'ipv4');
// 64:ff9b::/96 and 2002::/16 carry an IPv4 address inside them; they are refused whole.
for (const [net, prefix] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2002::', 16]] as const) PRIVATE.addSubnet(net, prefix, 'ipv6');

/** Private, loopback, link-local and multicast addresses. An IPv4 address written as IPv6
 *  (::ffff:127.0.0.1, which a URL turns into ::ffff:7f00:1) is checked as the IPv4 address it is. */
export function privateAddress(ip: string): boolean {
  return !isIP(ip) || PRIVATE.check(ip);
}
