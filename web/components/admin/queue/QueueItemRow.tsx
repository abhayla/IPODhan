/**
 * One queue item. Its only action is the link to the IPO-page editor at this field (§9.4: "there is
 * one place where an admin value is written"); this row never writes. Source values are shown here
 * only — an admin-only, logged-in view (§9.2 item 24).
 */
import Link from 'next/link';
import type { QueueItem } from '@/lib/admin/queue/queue-order';

function kindLabel(item: QueueItem): string {
  if (item.kind === 'missing') return 'Missing';
  return item.ruleFilter === null ? 'Disagreement' : 'Not a disagreement';
}

export function QueueItemRow({ item, group }: { item: QueueItem; group: 1 | 2 | 3 }) {
  return (
    <tr className="border-t border-gray-700" data-testid="queue-item" data-group={group} data-kind={item.kind}>
      <td className="px-3 py-2 text-sm text-gray-200">
        <div className="font-medium">{item.ipo.companyName}</div>
        <div className="text-xs text-gray-400">
          {item.ipo.slug} · {item.ipo.status}
        </div>
      </td>
      <td className="px-3 py-2 text-sm text-gray-200">
        <div>{item.fieldName}</div>
        <div className="text-xs text-gray-400">
          {item.tableName}
          {item.rowKey ? ` · row ${item.rowKey}` : ''}
        </div>
      </td>
      <td className="px-3 py-2 text-sm text-gray-200">{kindLabel(item)}</td>
      <td className="px-3 py-2 text-sm text-gray-300">
        <div>{item.reason}</div>
        {item.planState ? <div className="text-xs text-gray-400">{item.planState}</div> : null}
      </td>
      <td className="px-3 py-2 text-xs text-gray-300">
        {item.sources?.map((s, i) => (
          <div key={i}>
            <span className="text-gray-400">{s.source}:</span> {s.value ?? '(empty)'}
          </div>
        ))}
      </td>
      <td className="px-3 py-2 text-sm">
        <Link href={item.editorHref} className="text-blue-400 hover:underline">
          Fix in editor
        </Link>
      </td>
    </tr>
  );
}
