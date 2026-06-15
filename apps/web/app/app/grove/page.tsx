import { redirect } from 'next/navigation';

// The full-bleed grove ceremony was retired. The Keeper now lives in the docked
// panel on Grove Home (/app) for daily chat, and in the focal OnboardingCanvas
// during first run. This path is kept as a redirect so old links, bookmarks, and
// in-app redirects (diagnosis / shop adopt) still land where the Keeper is.
export const dynamic = 'force-dynamic';

export default function GroveRedirect() {
  redirect('/app');
}
