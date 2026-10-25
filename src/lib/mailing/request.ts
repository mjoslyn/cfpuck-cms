// Who sent a request, as the public mailing routes record it. Server only.

/** The visitor's address: Cloudflare's header, else the first forwarded address. */
export const clientIp = (request: Request) => request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';

/** The visitor's country, from Cloudflare's header (a two-letter code; XX or T1 when unknown or Tor). */
export function clientCountry(request: Request): string {
  const c = request.headers.get('cf-ipcountry') ?? '';
  return /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1' ? c : '';
}
