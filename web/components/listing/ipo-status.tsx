/**
 * IPO display-status derivation + status chip (spec G6).
 *
 * One status system shared across listing tables: Open = green dot,
 * Closing soon = amber, Upcoming = accent blue, Closed/Listed = muted.
 */

export type DisplayStatus = 'open' | 'closingSoon' | 'upcoming' | 'closed' | 'listed';

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
};

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
