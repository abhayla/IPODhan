/** A collapsed group-3 IPO (OD-136: "LISTED IPOs, collapsed, newest listing first"). */
import Link from 'next/link';
import type { QueueIpoSummary } from '@/lib/admin/queue/queue-order';

export function QueueIpoRow({ summary, onOpen }: { summary: QueueIpoSummary; onOpen: (slug: string) => void }) {
  const { ipo } = summary;
  return (
    <tr className="border-t border-gray-700" data-testid="queue-ipo" data-group={3}>
      <td className="px-3 py-2 text-sm text-gray-200">
        <div className="font-medium">{ipo.companyName}</div>
        <div className="text-xs text-gray-400">
          {ipo.slug} · {ipo.status}
          {ipo.listingDate ? ` · listed ${ipo.listingDate}` : ''}
        </div>
      </td>
      <td className="px-3 py-2 text-sm text-gray-300" colSpan={4}>
        {summary.conflicts} disagreements · {summary.missing} missing · {summary.flagged} refused by the field check ·{' '}
        {summary.ruled} not disagreements by rule
      </td>
      <td className="px-3 py-2 text-sm space-x-3">
        <button type="button" className="text-blue-400 hover:underline" onClick={() => onOpen(ipo.slug)}>
          Show items
        </button>
        <Link href={summary.editorHref} className="text-blue-400 hover:underline">
          Open IPO page
        </Link>
      </td>
    </tr>
  );
}
