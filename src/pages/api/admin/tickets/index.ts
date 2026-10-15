// The attendee list's actions (/admin/tickets/<event>/): POST { action, ... }
//   check-in { id, on }      mark an order checked in at the door (or not)
//   resend { id }            send a paid order's confirmation again
//   cancel { id }            cancel an unpaid, free or fully refunded order; its tickets go back on sale
//   refund { id, amount }    refund (part of) a paid order at Stripe or Square (admins); all of it
//                            refunds the order and puts its tickets back on sale
//   notify { event, date, ids? }  email the waitlist: those people, or as many as the free tickets cover
//   waitlist-remove { id }   take someone off the waitlist
// Freed tickets go to the waitlist at once when the event emails it on its own.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/supabase';
import { cancelOrder, loadEvent, notifyWaitlist, refundOrder, resendConfirmation, siteOrigin, waitlistAfterRelease } from '../../../../lib/tickets/orders';

export const POST: APIRoute = async ({ request, locals, url }) => {
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id) || 0;
  const db = serviceClient();
  const origin = siteOrigin(url.origin);
  try {
    switch (body.action) {
      case 'check-in': {
        const { error } = await locals.db.from('ticket_orders').update({ checked_in_at: body.on ? new Date().toISOString() : null }).eq('id', id).eq('status', 'paid');
        if (error) throw error;
        return Response.json({ ok: true });
      }
      case 'resend':
        await resendConfirmation(db, id, origin);
        return Response.json({ ok: true });
      case 'cancel': {
        await cancelOrder(db, id);
        const { data: o } = await db.from('ticket_orders').select('entry_id, occurrence').eq('id', id).single();
        await waitlistAfterRelease(db, o?.entry_id ?? null, o?.occurrence ?? '', origin);
        return Response.json({ ok: true });
      }
      case 'refund': {
        // Money goes back: admins only.
        if (locals.user?.role !== 'admin') return new Response('Only admins can refund orders.', { status: 403 });
        const amount = Math.round(Number(body.amount) || 0);
        const result = await refundOrder(db, id, amount);
        if (result.full) {
          const { data: o } = await db.from('ticket_orders').select('entry_id, occurrence').eq('id', id).single();
          await waitlistAfterRelease(db, o?.entry_id ?? null, o?.occurrence ?? '', origin);
        }
        return Response.json({ ok: true, ...result });
      }
      case 'notify': {
        const ev = await loadEvent(db, Number(body.event), String(body.date ?? ''), false);
        if (!ev) return new Response('No such event or date.', { status: 404 });
        const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean) : undefined;
        return Response.json({ ok: true, sent: await notifyWaitlist(db, ev, origin, ids) });
      }
      case 'waitlist-remove': {
        const { error } = await locals.db.from('ticket_waitlist').update({ status: 'removed' }).eq('id', id);
        if (error) throw error;
        return Response.json({ ok: true });
      }
    }
    return new Response('Unknown action', { status: 400 });
  } catch (e) {
    return new Response((e as Error).message, { status: 400 });
  }
};
