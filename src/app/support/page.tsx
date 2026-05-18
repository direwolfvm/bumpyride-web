import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Support',
  description:
    'Get help with the BumpyRide iOS app and bumpyride.me — contact email, FAQs, and bug-report guidance.',
};

export default function SupportPage() {
  return (
    <article className="mx-auto max-w-3xl">
      <header>
        <h1 className="mt-0 text-3xl font-semibold tracking-tight sm:text-4xl">
          Support
        </h1>
        <p className="mt-4 text-text-muted">
          Real human, not a bot. Plain email, no ticketing system.
        </p>
      </header>

      <section className="mt-8 rounded-lg border border-border bg-surface p-6">
        <div className="text-sm uppercase tracking-wide text-text-muted">
          Contact
        </div>
        <a
          href="mailto:me@jordaneccl.es"
          className="mt-2 block text-xl font-medium"
        >
          me@jordaneccl.es
        </a>
        <p className="mt-3 text-sm text-text-muted">
          Replies usually within a day or two. If your question is about a
          specific ride or account, include your account email so we can
          look it up.
        </p>
      </section>

      <H2>Frequently asked</H2>
      <Faq question="My rides aren’t syncing to bumpyride.me.">
        <ol className="ml-5 list-decimal space-y-1">
          <li>
            Open the iOS app → Settings → Web Account and confirm it says{' '}
            <em>Connected as &lt;your email&gt;</em>. If it doesn&apos;t,
            tap <em>Sign in with bumpyride.me</em> and re-pair.
          </li>
          <li>
            If you&apos;ve recently revoked tokens at{' '}
            <Link href="/settings/tokens">/settings/tokens</Link>, your
            previous token is invalid; re-pair to mint a fresh one.
          </li>
          <li>
            Confirm the phone has working network connectivity (other apps
            can reach the internet).
          </li>
          <li>
            If none of the above helps, email us with your account email
            and the approximate time of the rides that aren&apos;t showing.
          </li>
        </ol>
      </Faq>

      <Faq question="Why does the app need location access while I’m not using it?">
        <p>
          Recording a ride requires GPS while the phone&apos;s screen is off
          — for instance, when it&apos;s in your pocket or on a bar mount
          and you&apos;re not looking at it. The app stops collecting
          location the moment you tap <strong>Stop</strong>. The iOS
          background-location indicator stays visible on your status bar for
          the entire ride so you always know the app is recording.
        </p>
      </Faq>

      <Faq question="What is pocket mode?">
        <p>
          A per-ride tag indicating whether the phone was riding on your
          body (in a pocket, hydration pack, etc.) or on a fixed bike mount.
          Body-on rides are mechanically damped — the vibration the phone
          measures is softer than the actual road — so we tag and track them
          separately. The app auto-detects pocket mode from the recording,
          and you can override it at save time or later from the
          ride&apos;s menu.
        </p>
        <p className="mt-2">
          You can filter the iOS Bump Map by mode (All / Mounted / Pocket),
          and the same filter is available on{' '}
          <Link href="/bump-map">your web bump map</Link>.
        </p>
      </Faq>

      <Faq question="How do I delete my account?">
        <p>
          A self-service delete flow is on the roadmap. In the meantime,
          email <a href="mailto:me@jordaneccl.es">me@jordaneccl.es</a>{' '}
          from the address tied to your account and we&apos;ll delete the
          account, every ride, every token, and every contribution to the
          public bump map within seven days. We&apos;ll confirm by reply.
        </p>
      </Faq>

      <Faq question="Can I export my data?">
        <p>
          The iOS app has a per-ride <strong>Export to Photos</strong>{' '}
          action that saves a colored route image with a stats panel —
          handy for sharing. A full data export (JSON of every ride and its
          accelerometer windows) isn&apos;t built yet; it&apos;s on the
          roadmap. If you need an export today, email us — we can pull a
          per-account dump.
        </p>
      </Faq>

      <Faq question="Where can I report a bug?">
        <p>
          Email <a href="mailto:me@jordaneccl.es">me@jordaneccl.es</a>{' '}
          with:
        </p>
        <ul className="ml-5 mt-2 list-disc space-y-1">
          <li>iOS version (Settings → General → About → Software Version).</li>
          <li>BumpyRide app version (the app&apos;s Settings tab).</li>
          <li>A description of what happened and what you expected.</li>
          <li>
            If reproducible: rough steps that reliably trigger the bug.
          </li>
        </ul>
        <p className="mt-2">
          Screenshots, screen recordings, or sample ride exports all help.
        </p>
      </Faq>

      <H2>Privacy</H2>
      <p>
        Our <Link href="/privacy">privacy policy</Link> spells out exactly
        what the iOS app collects, what we receive on the server side, and
        how to opt out of anything you don&apos;t want.
      </p>

      <H2>Issues and source</H2>
      <p className="text-text-muted">
        BumpyRide is built in the open. You can also file issues directly at{' '}
        <a
          href="https://github.com/direwolfvm/bumpyride/issues"
          className="text-accent hover:underline"
        >
          the iOS repo
        </a>{' '}
        or{' '}
        <a
          href="https://github.com/direwolfvm/bumpyride-web/issues"
          className="text-accent hover:underline"
        >
          the web repo
        </a>{' '}
        if that&apos;s easier for you than email.
      </p>
    </article>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-10 text-xl font-semibold tracking-tight">{children}</h2>
  );
}

function Faq({
  question,
  children,
}: {
  question: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 rounded-lg border border-border bg-surface p-5">
      <h3 className="text-base font-medium">{question}</h3>
      <div className="mt-2 text-text-muted">{children}</div>
    </section>
  );
}
