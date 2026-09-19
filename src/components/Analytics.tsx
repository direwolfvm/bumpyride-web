import Script from 'next/script';

// Google Analytics 4, disabled unless GA_MEASUREMENT_ID is set.
//
// Deliberately NOT a NEXT_PUBLIC_ variable. Next inlines NEXT_PUBLIC_*
// into the client bundle at BUILD time, so setting one as a Cloud Run
// runtime variable would silently do nothing. This is read here, in a
// server component, on each request — every route in this app is
// dynamic (the root layout awaits auth()), so the value is picked up
// from the environment at runtime and analytics can be switched on or
// off without rebuilding.
//
// Privacy configuration is deliberate, and /privacy describes it:
//   - allow_google_signals: false          no cross-device / demographic
//                                          data, nothing joined to a
//                                          signed-in Google identity
//   - allow_ad_personalization_signals: false
//                                          the data is never usable for
//                                          ad targeting
// GA4 does not record full IP addresses at all, so there is no
// anonymize_ip toggle to set — that behaviour is built in.
//
// This measures page visits on the website only. It is nowhere near
// ride data: rides never pass through the browser's analytics path.

const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,24}$/i;

export function Analytics() {
  const id = process.env.GA_MEASUREMENT_ID?.trim();

  // Unset is the normal case in development and in any deploy that
  // hasn't opted in. A malformed value is ignored rather than
  // interpolated into the inline script below.
  if (!id || !MEASUREMENT_ID_PATTERN.test(id)) return null;

  const safeId = JSON.stringify(id);

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];
function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());
gtag('config',${safeId},{allow_google_signals:false,allow_ad_personalization_signals:false});`}
      </Script>
    </>
  );
}
