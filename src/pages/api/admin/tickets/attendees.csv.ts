// An event's orders as CSV, one row per order: GET /api/admin/tickets/attendees.csv?event=<id>
// [&date=<Y-m-d>][&status=paid|all]. The event's questions get a column each.
import type { APIRoute } from 'astro';
import { allRows } from '../../../../lib/rows';
import { money, ticketsOf } from '../../../../lib/tickets/config';
import { addressText, type OrderRow } from '../../../../lib/tickets/orders';

const cell = (v: unknown) => {
  let s = String(v ?? '');
  // A buyer's answer starting with =, +, -, @ would run as a formula in a spreadsheet.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const GET: APIRoute = async ({ url, locals }) => {
  const id = Number(url.searchParams.get('event')) || 0;
  const date = url.searchParams.get('date');
  const status = url.searchParams.get('status') ?? 'paid';
  const { data: event } = await locals.db.from('entries').select('title, slug, fields').eq('id', id).maybeSingle();
  if (!event) return new Response('Not found', { status: 404 });
  const questions = ticketsOf(event.fields).questions ?? [];
  let q = locals.db.from('ticket_orders').select('*').eq('entry_id', id).order('created_at').order('id');
  if (date !== null) q = q.eq('occurrence', date);
  if (status !== 'all') q = q.eq('status', status);
  const { data: rows, error } = await allRows(q);
  if (error) return new Response(error.message, { status: 400 });
  const head = ['Code', 'Date', 'Name', 'Email', 'Phone', 'Address', 'Tickets', 'Quantity', 'Total', 'Refunded', 'Status', 'Checked in', 'Ordered', ...questions.map((x) => x.label)];
  const lines = [head.map(cell).join(',')];
  for (const o of (rows ?? []) as OrderRow[]) {
    lines.push(
      [
        o.code, o.occurrence, o.name, o.email, o.phone, addressText(o.address),
        o.items.map((i) => `${i.quantity} x ${i.name}`).join('; '), o.quantity, money(o.amount, o.currency, '0'), o.refunded_amount ? money(o.refunded_amount, o.currency) : '',
        o.status, o.checked_in_at ?? '', o.created_at, ...questions.map((x) => o.answers?.[x.id] ?? ''),
      ].map(cell).join(','),
    );
  }
  const name = `${event.slug}${date ? `-${date}` : ''}-attendees`.replace(/[^a-z0-9-]+/gi, '-');
  return new Response(`﻿${lines.join('\r\n')}\r\n`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"` } });
};
