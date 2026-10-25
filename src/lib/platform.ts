// Cloudflare's bindings and the request being served (server only). The Worker entry (src/worker.ts)
// hands over its bindings once and runs every request, scheduled run and queued job in a scope of its
// own (work to finish after the answer). Scripts run in Node, with no bindings and no scope: they use
// the local D1 file, or the deployed database through Cloudflare's API (src/lib/db/d1.ts).
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

/** The R2 binding, as the storage code uses it. */
export interface R2ObjectLike {
  key: string;
  size: number;
  uploaded: Date;
  httpEtag: string;
  range?: unknown;
  body?: ReadableStream<Uint8Array>;
  writeHttpMetadata(headers: Headers): void;
}
export interface R2BucketLike {
  put(key: string, value: ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string; cacheControl?: string }; onlyIf?: { etagDoesNotMatch?: string } }): Promise<R2ObjectLike | null>;
  get(key: string, options?: { onlyIf?: Headers; range?: Headers }): Promise<R2ObjectLike | null>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; delimiter?: string }): Promise<{ objects: R2ObjectLike[]; delimitedPrefixes?: string[]; truncated: boolean; cursor?: string }>;
}

export interface Bindings {
  /** The site's files (src/lib/storage.ts). */
  BUCKET?: R2BucketLike;
  /** The database (src/lib/db/d1.ts). */
  DB?: import('./db/d1').D1Database;
  IMAGES?: ImagesBinding;
  /** Background jobs (src/lib/jobs.ts). */
  JOBS?: { send(body: unknown): Promise<void> };
  /** Cloudflare Email Service (src/lib/forms/mail.ts). */
  EMAIL?: EmailBinding;
}

type EmailParty = string | { email: string; name?: string };
export interface EmailBinding {
  send(message: { from: EmailParty; to: EmailParty[]; replyTo?: EmailParty; subject: string; html: string; text: string }): Promise<{ messageId: string }>;
}

let current: Bindings | null = null;

/** The Worker's bindings (set by the Worker entry), or null in Node. */
export const bindings = (): Bindings | null => current;
export const setBindings = (env: Bindings) => {
  current = env;
};

/** What belongs to one request, run or job. */
export interface Scope {
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
