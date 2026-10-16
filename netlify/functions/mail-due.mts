// The mailing scheduler, every 5 minutes on the deployed site (src/lib/mailing/due.ts runDue): scheduled
// campaigns whose time has come, sending runs to carry on, digest issues due this week, and issues waiting
// for approval past their time. Schedules only run on published deploys, not under astro dev.
import { runDue } from '../../src/lib/mailing/due';

export default async () => {
  try {
    console.log(`mail due: ${await runDue()}`);
  } catch (e) {
    console.error(`mail due failed: ${(e as Error).message}`);
  }
  return new Response('ok');
};

export const config = { schedule: '*/5 * * * *' };
