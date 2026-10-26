// Per test file: its own copy of the migrated database (D1_LOCAL_FILE, read by src/lib/db/d1.ts), set as
// the DB binding behind a check of every statement against D1's limits, so a query that local SQLite
// takes but D1 refuses fails here.
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inject } from 'vitest';
import { database } from '../../src/lib/db/d1';
import { setBindings } from '../../src/lib/platform';
import { checkedD1 } from './d1-limits';

const file = join(mkdtempSync(join(tmpdir(), 'cfpuck-test-')), 'd1.sqlite');
copyFileSync(inject('d1Template'), file);
process.env.D1_LOCAL_FILE = file;
setBindings({ DB: checkedD1(await database()) });
