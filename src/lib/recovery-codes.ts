import { createHash, randomBytes } from 'node:crypto';

// Single-use password-recovery codes. The user is shown the plaintext
// exactly once at generation; only sha256 is stored.
//
// Codes are 10 chars from a Crockford-ish alphabet (no 0/1/I/L/O) split
// into two five-char groups for readability: e.g. "XK74M-PR2QZ". That
// gives ~50 bits of entropy per code — plenty for an unauthenticated
// proof, and brute-forcing a single account would need ~quadrillions of
// guesses before stumbling on any one of the user's 8 codes.

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODES_PER_USER = 8;
export const CODE_LENGTH = 10; // before the formatting dash

export function generatePlaintextCode(): string {
  const len = CODE_LENGTH;
  // Rejection-sample so the alphabet is sampled uniformly. With a
  // 31-char alphabet against a 256-value byte the bias would be tiny,
  // but rejection is correct and basically free.
  const out = new Array<string>(len);
  let i = 0;
  while (i < len) {
    const byte = randomBytes(1)[0];
    if (byte >= 248) continue; // 248 = floor(256 / 31) * 31
    out[i++] = ALPHABET[byte % ALPHABET.length];
  }
  // Mid-string dash purely for human readability; it's stripped on input.
  return `${out.slice(0, 5).join('')}-${out.slice(5, 10).join('')}`;
}

/**
 * Strip whitespace and any formatting dashes, uppercase, and require the
 * remaining characters to all come from the alphabet. Returns the canonical
 * form for hashing, or null if the input can't be a code.
 */
export function canonicalise(input: string): string | null {
  const stripped = input.replace(/[\s-]+/g, '').toUpperCase();
  if (stripped.length !== CODE_LENGTH) return null;
  for (const ch of stripped) {
    if (!ALPHABET.includes(ch)) return null;
  }
  return stripped;
}

export function hashCode(canonical: string): string {
  return createHash('sha256').update(canonical).digest('hex');
}

export function generateSet(): { plaintext: string; hash: string }[] {
  return Array.from({ length: CODES_PER_USER }, () => {
    const plaintext = generatePlaintextCode();
    const canonical = canonicalise(plaintext)!;
    return { plaintext, hash: hashCode(canonical) };
  });
}
