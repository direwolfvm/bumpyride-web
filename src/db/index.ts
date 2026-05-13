import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Pool + drizzle instance are constructed lazily on first access. Doing this
// up front would crash `next build`, which loads route modules to collect
// static page data without DATABASE_URL set.
//
// Pinned to globalThis so dev-mode HMR doesn't open a new pool every reload.
const globalForDb = globalThis as unknown as {
  __pgPool?: Pool;
  __drizzle?: NodePgDatabase<typeof schema>;
};

function getPool(): Pool {
  if (globalForDb.__pgPool) return globalForDb.__pgPool;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  globalForDb.__pgPool = pool;
  return pool;
}

export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop) {
    const real = getPool() as unknown as Record<string | symbol, unknown>;
    const value = real[prop as string];
    return typeof value === 'function' ? (value as Function).bind(real) : value;
  },
});

export const db: NodePgDatabase<typeof schema> = new Proxy(
  {} as NodePgDatabase<typeof schema>,
  {
    get(_target, prop) {
      if (!globalForDb.__drizzle) {
        globalForDb.__drizzle = drizzle(getPool(), { schema });
      }
      const real = globalForDb.__drizzle as unknown as Record<
        string | symbol,
        unknown
      >;
      const value = real[prop as string];
      return typeof value === 'function' ? (value as Function).bind(real) : value;
    },
  },
);
