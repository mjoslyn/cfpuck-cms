// Mailing upkeep, nightly on the deployed site (src/lib/mailing/due.ts runNightly): Mailgun's bounces,
// complaints and unsubscribes reconciled with the contacts, and old events, clicks, webhook tokens and
// unconfirmed sign-ups pruned.
import { runNightly } from '../../src/lib/mailing/due';

export default async () => {
  try {
    console.log(`mail nightly: ${await runNightly()}`);
  } catch (e) {
    console.error(`mail nightly failed: ${(e as Error).message}`);
  }
  return new Response('ok');
};

// 06:20 UTC, before the morning in the Americas.
export const config = { schedule: '20 6 * * *' };
