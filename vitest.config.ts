// Unit tests (npm test): tests/**/*.test.ts in Node, each file with a database of its own made from
// db/migrations, whose every statement is checked against D1's limits (tests/setup/d1-limits.ts).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/setup/global.ts'],
    setupFiles: ['tests/setup/db.ts'],
  },
});
