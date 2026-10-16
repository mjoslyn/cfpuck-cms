// Who sent a request, as the public mailing routes record it. Server only.

/** The visitor's address: Netlify's header, else the first forwarded address. */
export const clientIp = (request: Request) => request.headers.get('x-nf-client-connection-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';

/** The visitor's country, from Netlify's geo header (base64 JSON). */
export function clientCountry(request: Request): string {
  const geo = request.headers.get('x-nf-geo');
  if (!geo) return '';
  try {
    return String(JSON.parse(Buffer.from(geo, 'base64').toString('utf8'))?.country?.code ?? '').slice(0, 8);
  } catch {
    return '';
  }
}
