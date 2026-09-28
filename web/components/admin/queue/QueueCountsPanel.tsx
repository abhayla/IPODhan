/** Counts per OD-136 group and per reason, always over the whole queue (never over the view). */
import type { QueueCounts } from '@/lib/admin/queue/queue-order';

export const GROUP_LABELS: Record<1 | 2 | 3, string> = {
  1: 'Live IPOs — fields the IPO page shows',
  2: 'Live IPOs — other fields',
  3: 'Listed and other IPOs (collapsed per IPO)',
};

export function QueueCountsPanel({ counts, onReason }: { counts: QueueCounts; onReason: (reason: string) => void }) {
  const reasons = Object.entries(counts.byReason).sort((a, b) => b[1] - a[1]);
  return (
    <section className="space-y-4" data-testid="queue-counts">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Everything to review</div>
          <div className="text-3xl font-bold text-white mt-1">{counts.total}</div>
          <div className="text-xs text-gray-400 mt-1">
            {counts.byKind.disagreement} disagreements · {counts.byKind.missing} missing · {counts.byKind.flagged} refused by the field check · {counts.byKind.ruled} not
            disagreements by rule
          </div>
        </div>
        {([1, 2, 3] as const).map((g) => (
          <div key={g} className="bg-gray-800 rounded-lg p-4" data-testid={`group-count-${g}`}>
            <div className="text-gray-400 text-sm">
              {g}. {GROUP_LABELS[g]}
            </div>
            <div className="text-3xl font-bold text-white mt-1">{counts.byGroup[g].items}</div>
            <div className="text-xs text-gray-400 mt-1">{counts.byGroup[g].ipos} IPOs</div>
          </div>
        ))}
      </div>
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="text-sm text-gray-300 mb-2">By reason (click to view only that reason)</div>
        <div className="flex flex-wrap gap-2">
          {reasons.map(([reason, n]) => (
            <button
              key={reason}
              type="button"
              onClick={() => onReason(reason)}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-200"
            >
              {reason} ({n})
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
