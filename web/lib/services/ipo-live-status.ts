/**
 * Server-safe predicate: is this IPO "live" (currently open) — i.e. worth
 * fetching latest GMP + subscription for? Used by listing pages to scope the
 * live-metrics batch to the few open IPOs instead of the whole year's list.
 */

interface LiveStatusInput {
  openDate: string | null;
  closeDate: string | null;
  status: string;
}

export function isLiveIPO(ipo: LiveStatusInput): boolean {
  if (ipo.status === 'OPEN') return true;
  if (ipo.openDate && ipo.closeDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const open = new Date(ipo.openDate);
    const close = new Date(ipo.closeDate);
    open.setHours(0, 0, 0, 0);
    close.setHours(0, 0, 0, 0);
    return today >= open && today <= close;
  }
  return false;
}
