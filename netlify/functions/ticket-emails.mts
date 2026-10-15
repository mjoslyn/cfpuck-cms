// Ticket emails that are due (src/lib/tickets/orders.ts sendDueTicketEmails), hourly on the deployed
// site: reminders before events and follow-ups after them (as turned on under Settings > Tickets),
// waitlists told of tickets that unpaid orders gave back, and expired holds closed. Schedules only run
// on published deploys, not under astro dev.
import { sendDueTicketEmails } from '../../src/lib/tickets/orders';

export default async () => {
  try {
    console.log(`ticket emails: ${await sendDueTicketEmails()}`);
  } catch (e) {
    console.error(`ticket emails failed: ${(e as Error).message}`);
  }
  return new Response('ok');
};

export const config = { schedule: '@hourly' };
