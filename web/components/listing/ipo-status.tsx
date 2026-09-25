/**
 * IPO display-status derivation + status chip (spec G6).
 *
 * One status system shared across listing tables: Open = green dot,
 * Closing soon = amber, Upcoming = accent blue, Closed/Listed = muted.
 */

export type DisplayStatus =
  | 'open'
  | 'closingSoon'
  | 'upcoming'
  | 'closed'
  | 'listed'
  | 'withdrawn'
  | 'postponed';

/** Minimal shape needed to derive a status — satisfied by both IPO rows and the
 * lighter HomeIPOTableData. */
export interface StatusInput {
  openDate: string | null;
  closeDate: string | null;
  status: string;
}

interface StatusMeta {
  status: DisplayStatus;
  label: string;
}

const startOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/**
 * Derive the display status from dates + stored status.
 * Dates decide "open"/"closing soon" (they are the ground truth for an active
 * window); the stored status decides upcoming/listed/closed.
 */
export function getDisplayStatus(ipo: StatusInput): StatusMeta {
  const today = startOfDay(new Date());

  // I4 / W-41: a pulled issue is checked BEFORE the dates. Its bidding window
  // still exists and still passes, so date-first logic would label a withdrawn
  // IPO "Open" during its old window and "Closed" after it — telling the reader
  // it is a live/completed issue when it will never happen.
  const stored = (ipo.status || '').toUpperCase();
  if (stored === 'WITHDRAWN') return { status: 'withdrawn', label: 'Withdrawn' };
  if (stored === 'POSTPONED') return { status: 'postponed', label: 'Postponed' };

  if (ipo.openDate && ipo.closeDate) {
    const open = startOfDay(new Date(ipo.openDate));
    const close = startOfDay(new Date(ipo.closeDate));
    if (today >= open && today <= close) {
      const daysToClose = Math.ceil(
        (close.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysToClose <= 1) return { status: 'closingSoon', label: 'Closing soon' };
      return { status: 'open', label: 'Open' };
    }
  }

  if (ipo.status === 'LISTED') return { status: 'listed', label: 'Listed' };
  if (ipo.status === 'UPCOMING') return { status: 'upcoming', label: 'Upcoming' };
  if (ipo.status === 'OPEN') return { status: 'open', label: 'Open' };
  return { status: 'closed', label: 'Closed' };
}

// Every status carries a tonal chip so the column reads at a glance (R17 #7):
// Open = live green, Closing soon = amber, Upcoming = accent blue,
// Listed = completed/positive emerald, Closed = neutral gray.
const TONE: Record<DisplayStatus, { chip: string; dot: string }> = {
  open: { chip: 'bg-green-50 text-green-700', dot: 'bg-green-600' },
  closingSoon: { chip: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  upcoming: { chip: 'bg-primary/10 text-primary', dot: 'bg-primary' },
  closed: { chip: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
  listed: { chip: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  // Terminal states read as a warning, not as neutral "closed" — the reader must
  // not mistake a dead issue for a completed one.
  withdrawn: { chip: 'bg-red-50 text-red-700', dot: 'bg-red-500' },
  postponed: { chip: 'bg-amber-50 text-amber-800', dot: 'bg-amber-600' },
};

/** Just the colored status dot — used inside the pinned Company cell on mobile so
 * the standalone Status column can be dropped and a VALUE column leads (R27 #1).
 *
 * `decorative` MUST be true whenever this is rendered inside an already-labeled
 * interactive element (e.g. the company `<Link>`) — otherwise the dot's own
 * `aria-label` is prepended to that element's accessible name (#107: a screen
 * reader announced "Open Currently Open IPO" instead of "Currently Open IPO").
 * When decorative, the dot carries no accessible name of its own and is hidden
 * from the accessibility tree; the visual `title` tooltip is unaffected. */
export function StatusDot({
  ipo,
  className = '',
  decorative = false,
}: {
  ipo: StatusInput;
  className?: string;
  decorative?: boolean;
}) {
  const { status, label } = getDisplayStatus(ipo);
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${TONE[status].dot} ${className}`}
      title={label}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
    />
  );
}

/** Screen-reader-only status label for the mobile pinned Company cell.
 *
 * Round-1 review finding on #107: making the in-Link `StatusDot` decorative
 * (aria-hidden, no aria-label) fixed the link's accessible name but left
 * mobile screen-reader users with NO status announcement at all — the
 * standalone `IpoStatusChip` Status column is `hidden md:table-cell`
 * (display:none below md), which removes it from the accessibility tree on
 * mobile too, not just visually.
 *
 * Renders OUTSIDE the `<Link>` (a sibling in the same cell) so it never
 * touches the link's accessible name, and is `md:hidden` so it drops out of
 * the accessibility tree at the same breakpoint the visible `IpoStatusChip`
 * column appears — a screen-reader user hears the status exactly once,
 * from whichever of the two is actually present at the current viewport. */
export function StatusSrLabel({ ipo }: { ipo: StatusInput }) {
  const { label } = getDisplayStatus(ipo);
  return <span className="sr-only md:hidden">{label}</span>;
}

export function IpoStatusChip({ ipo }: { ipo: StatusInput }) {
  const { status, label } = getDisplayStatus(ipo);
  const tone = TONE[status];
  // On mobile the label text is hidden (dot only) so the value column has room to
  // render its FULL number, not a clipped "+30" (R23 #2). Full chip returns at sm+.
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-xs font-medium sm:px-2 ${tone.chip}`}
      title={label}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
