/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    db: import('./lib/db/query').Db;
    user: { id: string; email: string; role: 'editor' | 'admin'; name: string };
  }
}

// The Workers runtime's module (src/worker.ts), as far as the site uses it.
declare module 'cloudflare:workers' {
  export const cache: { purge(options: { tags?: string[] }): Promise<unknown> };
  export const env: Record<string, unknown>;
}
