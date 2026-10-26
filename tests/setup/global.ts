// Once per run: a database with every migration applied (db/migrations, in order, as wrangler applies
// them), which each test file copies (tests/setup/db.ts).
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    d1Template: string;
  }
}

export default function setup(project: TestProject) {
  const dir = mkdtempSync(join(tmpdir(), 'cfpuck-tests-'));
  const file = join(dir, 'template.sqlite');
  const db = new DatabaseSync(file);
  for (const name of readdirSync('db/migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join('db/migrations', name), 'utf8'));
  }
  db.close();
  project.provide('d1Template', file);
  return () => rmSync(dir, { recursive: true, force: true });
}
