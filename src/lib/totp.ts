import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Hand-rolled RFC 6238 TOTP. ~30 lines on Node's built-in crypto.
// We use:
//   algorithm: HMAC-SHA1   (universal — every authenticator app supports it)
//   step:      30 seconds  (default; what every authenticator assumes)
//   digits:    6           (default)
//   secret:    20 random bytes (RFC 4226 recommended size)
//
// Verification accepts a ±1-step window (so a code is valid for ~60 s)
// to absorb clock drift between the device and the server.

export const SECRET_BYTES = 20;
export const STEP_SECONDS = 30;
export const DIGITS = 6;
const WINDOW = 1;

export function generateSecret(): Buffer {
  return randomBytes(SECRET_BYTES);
}

/** RFC 4648 base32 (uppercase, no padding) — what authenticator apps want. */
export function encodeBase32(buf: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 0x1f];
  return out;
}

/** otpauth:// URI consumed by authenticator app QR scanners. */
export function provisioningUri(
  secret: Buffer,
  accountLabel: string,
  issuer = 'BumpyRide',
): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret: encodeBase32(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // Counter is a 64-bit big-endian integer. JS numbers safely hold values
  // up to 2^53, and 2^53 / (30 s) is roughly 8.5 billion years — plenty.
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** True if `code` matches the current 30-s window or its immediate neighbours. */
export function verifyCode(secret: Buffer, code: string): boolean {
  const trimmed = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(trimmed)) return false;
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  // Timing-safe compare each candidate to defeat side-channel attacks.
  const candidate = Buffer.from(trimmed);
  for (let i = -WINDOW; i <= WINDOW; i++) {
    const expected = Buffer.from(hotp(secret, counter + i));
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return true;
    }
  }
  return false;
}
