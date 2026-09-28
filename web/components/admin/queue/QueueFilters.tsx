/** View filters only: they narrow what is listed; the default view shows everything (OD-136). */
import type { QueueView } from '@/lib/admin/queue/queue-order';

const SELECT = 'px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm block mt-1';

export function QueueFilters({ view, onChange }: { view: QueueView; onChange: (v: QueueView) => void }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 flex flex-wrap gap-3 items-end" data-testid="queue-filters">
      <label className="text-sm text-gray-300">
        Group
        <select
          className={SELECT}
          value={view.group ?? ''}
          onChange={(e) => onChange({ ...view, group: e.target.value ? (Number(e.target.value) as 1 | 2 | 3) : undefined })}
        >
          <option value="">All groups</option>
          <option value="1">1 — live, shown fields</option>
          <option value="2">2 — live, other fields</option>
          <option value="3">3 — listed and other</option>
        </select>
      </label>
      <label className="text-sm text-gray-300">
        Kind
        <select
          className={SELECT}
          value={view.kind ?? ''}
          onChange={(e) => onChange({ ...view, kind: (e.target.value || undefined) as QueueView['kind'] })}
        >
          <option value="">All kinds</option>
          <option value="disagreement">Disagreements</option>
          <option value="missing">Missing values</option>
          <option value="flagged">Refused by the field check</option>
          <option value="ruled">Not disagreements by rule</option>
        </select>
      </label>
      {view.reason ? <span className="text-sm text-gray-300">Reason: {view.reason}</span> : null}
      {view.ipo ? <span className="text-sm text-gray-300">IPO: {view.ipo}</span> : null}
      <button
        type="button"
        className="px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded-md text-white text-sm"
        onClick={() => onChange({})}
      >
        Show everything
      </button>
    </div>
  );
}
