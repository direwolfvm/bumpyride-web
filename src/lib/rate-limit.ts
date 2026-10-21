import { createHash } from 'node:crypto';
import { pool } from '@/db';

// Fixed-window attempt limits shared across every Cloud Run instance.
// Each quota is checked in order; the first one that is full rejects the
// attempt. Attempts are counted whether or not they succeed, so a correct
// password does not reset an attacker's budget.

export type Quota = { scope: string; seconds: number; limit: number };

function bucketKey(quota: Quota, now: number): { key: string; expires: Date } {
  const bucket = Math.floor(now / (quota.seconds * 1000));
  const key = createHash('sha256')
    .update(`${quota.scope}:${quota.seconds}:${bucket}`)
    .digest('hex');
  return { key, expires: new Date((bucket + 1) * quota.seconds * 1000) };
}

export async function allowAttempt(quotas: Quota[]): Promise<boolean> {
  const now = Date.now();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const quota of quotas) {
      const { key, expires } = bucketKey(quota, now);
      const result = await client.query(
        `INSERT INTO auth_rate_limits (key, count, expires_at) VALUES ($1, 1, $2)
         ON CONFLICT (key) DO UPDATE SET count = auth_rate_limits.count + 1
         WHERE auth_rate_limits.count < $3
         RETURNING count`,
        [key, expires, quota.limit],
      );
      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return false;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  // Housekeeping; a failure here must not affect the caller.
  if (Math.random() < 0.01) {
    pool
      .query('DELETE FROM auth_rate_limits WHERE expires_at < now()')
      .catch(() => {});
  }
  return true;
}

/**
 * Best-effort client IP for the per-IP quota. The first X-Forwarded-For hop
 * can be spoofed, which only lets a caller dodge the IP quota; the
 * per-identifier quota is the one that protects an account.
 */
export function clientIp(headers: Headers): string {
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first || 'unknown';
}

/** Sign-in: per login name and per IP, generous enough for typos. */
export function signInQuotas(identifier: string, ip: string): Quota[] {
  return [
    { scope: `signin:id:${identifier}`, seconds: 15 * 60, limit: 10 },
    { scope: `signin:ip:${ip}`, seconds: 15 * 60, limit: 50 },
  ];
}

/**
 * Password reset: a 6-digit TOTP code allows ~3 valid values per window,
 * so attempts per account must stay far below 10^6 / 3 over any period an
 * attacker could sustain. 5 per hour per account caps it at ~120 a day.
 */
export function resetQuotas(identifier: string, ip: string): Quota[] {
  return [
    { scope: `reset:id:${identifier}`, seconds: 60 * 60, limit: 5 },
    { scope: `reset:ip:${ip}`, seconds: 60 * 60, limit: 20 },
  ];
}
