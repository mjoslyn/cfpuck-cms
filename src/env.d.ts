/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    db: import('./lib/db/query').Db;
    user: { id: string; email: string; role: 'editor' | 'admin'; name: string };
  }
}
