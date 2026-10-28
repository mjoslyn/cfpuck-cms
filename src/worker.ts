// The Worker: Astro's site and admin (fetch), the scheduled runs (Cron Triggers in wrangler.jsonc) and
// the background jobs (the JOBS queue, src/lib/jobs.ts). Each runs in a scope of its own
// (src/lib/platform.ts), so its database connections belong to it.
import { handle } from '@astrojs/cloudflare/handler';
import { cache } from 'cloudflare:workers';
import { inScope, setBindings, type Bindings } from './lib/platform';
import type { Job } from './lib/jobs';
import { PAGE_CACHE_TAG } from './lib/cache';

type Env = Bindings & Record<string, unknown>;

// The parts of the Workers runtime's types used here (its full types would clash with the DOM's).
interface ExecutionContext {
  waitUntil(p: Promise<unknown>): void;
}
interface ScheduledController {
  cron: string;
}
interface MessageBatch<T> {
  messages: { body: T; ack(): void }[];
}

/** The scheduled runs, by their cron (wrangler.jsonc triggers). */
const SCHEDULES: Record<string, { name: string; run: () => Promise<string> }> = {
  // Mailing: due campaigns, sending runs to carry on, digests (src/lib/mailing/due.ts).
  '*/5 * * * *': { name: 'mail due', run: async () => (await import('./lib/mailing/due')).runDue() },
  // Mailing upkeep: Mailgun's bounces and complaints, old events pruned; 06:20 UTC.
  '20 6 * * *': { name: 'mail nightly', run: async () => (await import('./lib/mailing/due')).runNightly() },
  // Snapshots of this site when they are on and due (src/lib/sync.ts); 07:00 UTC.
  '0 7 * * *': { name: 'scheduled snapshot', run: async () => (await import('./lib/sync')).scheduledSnapshot() },
  // Ticket reminders, follow-ups, expired holds, waitlists (src/lib/tickets/orders.ts); hourly.
  '0 * * * *': { name: 'ticket emails', run: async () => (await import('./lib/tickets/orders')).sendDueTicketEmails() },
};

async function runJob(job: Job): Promise<void> {
  switch (job.kind) {
    case 'compose':
      return (await import('./lib/compose/job')).runJob(job.jobId, job.token);
    case 'mail-send':
      return (await import('./lib/mailing/send')).runCampaign(job.campaignId, job.token);
    case 'restore': {
      const done = await (await import('./lib/sync')).runRestore(job.job);
      // A restore here changes the pages: their CDN copies go (there is no page cache under astro dev).
      if (done?.site === 'here' && typeof cache?.purge === 'function') await cache.purge({ tags: [PAGE_CACHE_TAG] }).catch((e: Error) => console.error(`page cache purge failed: ${e.message}`));
      return;
    }
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    setBindings(env);
    return inScope({ waitUntil: (p) => ctx.waitUntil(p) }, () => handle(request, env as never, ctx));
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    setBindings(env);
    const s = SCHEDULES[event.cron];
    if (!s) return console.error(`no scheduled run for ${event.cron}`);
    await inScope({ waitUntil: (p) => ctx.waitUntil(p) }, async () => {
      try {
        await (await import('./lib/site-keys')).refreshSavedKeys();
        console.log(`${s.name}: ${await s.run()}`);
      } catch (e) {
        console.error(`${s.name} failed: ${(e as Error).message}`);
      }
    });
  },

  async queue(batch: MessageBatch<Job>, env: Env, ctx: ExecutionContext) {
    setBindings(env);
    for (const message of batch.messages) {
      await inScope({ waitUntil: (p) => ctx.waitUntil(p) }, async () => {
        try {
          await (await import('./lib/site-keys')).refreshSavedKeys();
          await runJob(message.body);
        } catch (e) {
          console.error(`job ${message.body.kind} failed: ${(e as Error).message}`);
        }
      });
      message.ack();
    }
  },
};
