// Cloudflare's bindings and the request being served (server only). The Worker entry (src/worker.ts)
// hands over its bindings once and runs every request, scheduled run and queued job in a scope of its
// own, since a Worker's connections (the database's, through Hyperdrive) can't outlive the request that
// opened them. Scripts run in Node, with no bindings and no scope: they connect with DATABASE_URL.
import { AsyncLocalStorage } from 'node:async_hooks';

/** The Images binding, as the media code uses it. */
export interface ImagesBinding {
  info(stream: ReadableStream<Uint8Array>): Promise<{ format: string; fileSize?: number; width?: number; height?: number }>;
  input(stream: ReadableStream<Uint8Array>): ImageTransformer;
}
export interface ImageTransformer {
  transform(options: Record<string, unknown>): ImageTransformer;
  output(options: { format: string; quality?: number }): Promise<{ response(): Response; contentType(): string }>;
}

export interface Bindings {
  /** The database, through Hyperdrive. */
  HYPERDRIVE?: { connectionString: string };
  IMAGES?: ImagesBinding;
  /** Background jobs (src/lib/jobs.ts). */
  JOBS?: { send(body: unknown): Promise<void> };
}

let current: Bindings | null = null;

/** The Worker's bindings (set by the Worker entry), or null in Node. */
export const bindings = (): Bindings | null => current;
export const setBindings = (env: Bindings) => {
  current = env;
};

/** What belongs to one request, run or job. */
export interface Scope {
  /** Its database connections (src/lib/db/sql.ts). */
  pool?: unknown;
  /** Work to finish after the answer has gone (ExecutionContext.waitUntil). */
  waitUntil?: (p: Promise<unknown>) => void;
}

const scope = new AsyncLocalStorage<Scope>();

/** Run `fn` as one request, run or job. */
export const inScope = <T>(s: Scope, fn: () => T): T => scope.run(s, fn);
export const currentScope = (): Scope | undefined => scope.getStore();

/** Let `work` finish after the answer (a Worker keeps it alive; Node just carries on). */
export function afterAnswer(work: Promise<unknown>): void {
  const s = currentScope();
  const logged = work.catch((e: Error) => console.error(e?.message ?? e));
  if (s?.waitUntil) s.waitUntil(logged);
}
