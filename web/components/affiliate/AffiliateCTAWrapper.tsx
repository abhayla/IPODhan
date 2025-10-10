/**
 * AffiliateCTAWrapper Component
 *
 * Client-side wrapper for AffiliateCTA to prevent hydration mismatch.
 * This component uses dynamic import with ssr: false to ensure
 * the banner only renders on the client side, avoiding issues
 * with cookie reading during SSR.
 *
 * @component
 */

'use client';

import dynamic from 'next/dynamic';

// Import AffiliateCTA as client-only to avoid hydration mismatch
// This component uses cookies and useEffect which should only run on client
const AffiliateCTA = dynamic(
  () => import('./AffiliateCTA').then((mod) => ({ default: mod.AffiliateCTA })),
  { ssr: false }
);

export function AffiliateCTAWrapper() {
  return <AffiliateCTA />;
}
