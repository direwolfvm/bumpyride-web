import { permanentRedirect } from 'next/navigation';

// The about content moved to the home page (`/`). Keep this route as a
// permanent redirect so existing inbound links (header bookmarks,
// previous PR descriptions, the iOS app's "learn more" link if any)
// still resolve correctly.
export default function AboutPage() {
  permanentRedirect('/');
}
