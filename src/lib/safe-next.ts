// Normalise a `next` query parameter into a safe redirect target.
//
// Threat model: we want the seamless-pairing flow to be able to ferry a
// user through /login or /signup and back to /ios-pair?... — but we never
// want to redirect to a host the user doesn't control. So we only accept
// values that are clearly same-origin paths.
//
//   ok:   /ios-pair?callback_scheme=bumpyride&state=xyz
//         /rides/123
//   bad:  https://attacker.example/
//         //attacker.example/  (protocol-relative — would resolve cross-origin)
//         javascript:alert(1)
//
// Returns the cleaned path on success, or null if the input is unsafe / absent.
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.length > 2000) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  if (raw.startsWith('/\\')) return null;
  return raw;
}
