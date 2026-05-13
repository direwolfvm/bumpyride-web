import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// `pg.Pool` is lazy — the constructor doesn't open a TCP connection. That
// means we can construct eagerly here even when DATABASE_URL is missing
// (e.g. `next build` collecting route data). The connection only fails
// later on first `query()` if the URL is bogus.
//
// Pinned to globalThis so dev-mode HMR doesn't open a fresh pool per reload
// and the Auth.js Drizzle adapter sees the same instance throughout.
const globalForDb = globalThis as unknown as {
  __pgPool?: Pool;
  __drizzle?: NodePgDatabase<typeof schema>;
};

if (!globalForDb.__pgPool) {
  globalForDb.__pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });
}
if (!globalForDb.__drizzle) {
  globalForDb.__drizzle = drizzle(globalForDb.__pgPool, { schema });
}

export const pool: Pool = globalForDb.__pgPool;
export const db: NodePgDatabase<typeof schema> = globalForDb.__drizzle;
