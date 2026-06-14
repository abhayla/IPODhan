/**
 * Status-aware empty-state copy for IPO detail panels.
 *
 * Fixes the contradiction (#8) where an OPEN IPO with no scraped data still
 * showed upcoming-state copy ("once bidding begins" / "after the company files
 * its prospectus"). The upcoming phrasing is only correct for UPCOMING IPOs;
 * for every other state (and when status is unknown) we show neutral
 * "not available yet" copy instead of asserting a lifecycle stage that has
 * already passed.
 */

export type IpoLifecycleStatus = 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED';

type EmptyStateKind = 'subscription' | 'financial';

function isUpcoming(status: string | null | undefined): boolean {
  return (status ?? '').toUpperCase() === 'UPCOMING';
}

/**
 * Returns the empty-state sentence for a given panel, branching only on whether
 * the IPO is genuinely UPCOMING. Unknown/missing status is treated as
 * not-upcoming (neutral) so we never wrongly claim bidding/filing is pending.
 */
export function ipoEmptyStateMessage(
  kind: EmptyStateKind,
  status: string | null | undefined,
  companyName: string,
): string {
  const name = companyName?.trim() || 'this company';

  if (kind === 'subscription') {
    return isUpcoming(status)
      ? `Subscription data will appear here once bidding begins for ${name}.`
      : `Live subscription data for ${name} is not available yet — please check back shortly.`;
  }

  // financial
  return isUpcoming(status)
    ? `Comprehensive financial data (revenue, profit, EBITDA trends) is not yet available. Check back after ${name} files its prospectus.`
    : `Comprehensive financial data (revenue, profit, EBITDA trends) is not available yet for ${name}.`;
}
