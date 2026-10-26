import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './scripts/migration-schema.ts',
  out: './drizzle',
});
