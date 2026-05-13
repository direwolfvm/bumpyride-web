import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { createApiToken } from '@/lib/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Seamless pairing for the iOS app's "Sign in with bumpyride.me" button.
// Full contract:
//   https://github.com/direwolfvm/bumpyride/blob/main/docs/WEB_PAIRING.md
//
// The iOS side opens this in ASWebAuthenticationSession (which captures the
// custom-scheme callback privately — Safari history and other apps never see
// the token), so it's safe to ship the plaintext token in the redirect URL.
//
// Allow-list custom schemes explicitly. Today only `bumpyride` is needed; if
// we later want test/staging schemes, add them here.
const ALLOWED_CALLBACK_SCHEMES = new Set(['bumpyride']);

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' } as const;

function errorPage(message: string, status: number): Response {
  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Sign-in link error</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
           background: #0b0b10; color: #e8e8ee; margin: 0; padding: 2rem;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    main { max-width: 420px; }
    h1 { font-size: 20px; margin: 0 0 0.5rem 0; }
    p  { color: #9a9aac; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>This sign-in link isn&rsquo;t valid.</h1>
    <p>${escapeHtml(message)}</p>
    <p>Close this window and try again from the BumpyRide app.</p>
  </main>
</body>
</html>`;
  return new Response(body, { status, headers: HTML_HEADERS });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function utcStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())} UTC`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const callbackScheme = url.searchParams.get('callback_scheme')?.trim() ?? '';
  const state = url.searchParams.get('state') ?? '';

  if (!callbackScheme || !ALLOWED_CALLBACK_SCHEMES.has(callbackScheme)) {
    return errorPage('The app sent a callback scheme we do not recognise.', 400);
  }
  if (!state) {
    return errorPage('The app did not send a state parameter.', 400);
  }

  const session = await auth();
  if (!session?.user?.id) {
    // Round-trip the user through /login (or /signup, their choice). The
    // login page reads `next` and redirects back here after a successful
    // sign-in, at which point we'll be authenticated.
    //
    // We compose a relative Location so the redirect uses whatever host the
    // user actually hit (bumpyride.me, the .run.app fallback, localhost in
    // dev) — req.url under Cloud Run can show the container's bind address.
    const next = url.pathname + url.search;
    const loginPath = `/login?next=${encodeURIComponent(next)}`;
    return new NextResponse(null, {
      status: 302,
      headers: { Location: loginPath },
    });
  }

  let token: string;
  try {
    const minted = await createApiToken(
      session.user.id,
      `iOS — paired ${utcStamp(new Date())}`,
    );
    token = minted.token;
  } catch (err) {
    console.error('ios-pair: failed to mint token', err);
    return errorPage('Something went wrong on our side. Please try again.', 500);
  }

  // Build the callback URL by hand. URL serialisation would percent-encode the
  // colon after the scheme on custom schemes in some Node versions; manual
  // composition keeps `bumpyride://pair` intact regardless.
  const callback =
    `${callbackScheme}://pair` +
    `?token=${encodeURIComponent(token)}` +
    `&state=${encodeURIComponent(state)}`;
  return NextResponse.redirect(callback, 302);
}
