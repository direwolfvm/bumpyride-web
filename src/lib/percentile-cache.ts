import { pool } from '@/db';

// Per-process cache for the (best-10% / worst-10%) percentile cutoffs
// that drive ?percentile= on the tile routes.
//
// Why: prior to this, every tile request with ?percentile=top10|bottom10
// computed `percentile_cont(0.1) / (0.9)` over the full gate-passing
// dataset inside its own query. A single /bump-map page load fetches
// ~16 tiles in parallel; 16 concurrent full-table scans against
// ride_points pinned every connection in the pool, every request
// hung at Cloud Run's 60s deadline, and unrelated DB-touching
// endpoints (/rides, etc.) timed out as collateral.
//
// Now: each percentile tile request asks this module for the (lo, hi)
// cutoffs. The cache holds them for CACHE_TTL_MS so a single map
// session reuses a single DB call. Concurrent cold misses dedupe
// against a shared in-flight promise so 16 tiles fire one query, not
// 16. The compute itself runs under a statement_timeout so a wedged
// query can never hold a pool connection longer than that bound.
//
// Cache is per-Cloud-Run-instance, which is fine — the cutoff drifts
// slowly compared to the TTL, and a cold-start hit is one query per
// instance per (key, TTL window).

const CACHE_TTL_MS = 5 * 60 * 1000;
const STATEMENT_TIMEOUT_MS = 10_000;

export type PercentileThreshold = { lo: number; hi: number };

type Entry = { value: PercentileThreshold; expiresAt: number };

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<PercentileThreshold>>();

/**
 * Get the cached (lo, hi) cutoffs for the caller's percentile key, or
 * compute them via `compute()` while deduping concurrent callers and
 * memoising the result for CACHE_TTL_MS.
 *
 * `compute` receives a connected pg client with `statement_timeout`
 * already applied. It runs to a single SELECT that returns one row of
 * { lo, hi }. The caller is responsible for the SQL — different tile
 * routes compute over different sources (bumpiness vs incident
 * counts) and against different privacy gates.
 */
export async function getOrComputeThreshold(
  key: string,
  compute: (client: import('pg').PoolClient) => Promise<PercentileThreshold>,
): Promise<PercentileThreshold> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  // Coalesce concurrent cold misses.
  const pending = inFlight.get(key);
  if (pending) return pending;

  const run = (async () => {
    const client = await pool.connect();
    try {
      // Per-statement timeout: if the threshold query hangs we'd
      // rather fail this single tile request than pin the connection
      // for the full Cloud Run deadline.
      await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      const value = await compute(client);
      cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return value;
    } finally {
      client.release();
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, run);
  return run;
}

// Sentinel: caller can use this when the computation returns no rows
// (no gate-passing cells), and bypass the percentile filter rather
// than render nothing.
export const NO_DATA_THRESHOLD: PercentileThreshold = {
  lo: Number.NEGATIVE_INFINITY,
  hi: Number.POSITIVE_INFINITY,
};
