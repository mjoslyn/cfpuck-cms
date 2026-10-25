// Background jobs (server only): work that outlasts a request (a Compose turn, a campaign's sending run,
// a restore) goes on the JOBS queue, whose consumer (src/worker.ts) runs it with up to 15 minutes and
// nobody waiting. Each job claims its work with a token or id it was given, so a stray message does
// nothing. Where there is no queue (scripts), the caller runs the job itself.
import { bindings } from './platform';

export type Job =
  | { kind: 'compose'; jobId: string; token: string }
  | { kind: 'mail-send'; campaignId: number; token: string }
  | { kind: 'restore'; job: string };

/** Queue a job: false when there is no queue to take it. */
export async function enqueue(job: Job): Promise<boolean> {
  const queue = bindings()?.JOBS;
  if (!queue) return false;
  await queue.send(job);
  return true;
}
