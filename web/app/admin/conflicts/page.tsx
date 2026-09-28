'use client';

/**
 * /admin/conflicts — the admin data-quality queue (OD-63, OD-136, spec §9.4).
 *
 * One ordered list of everything an admin should fix: unresolved disagreements and every field no
 * source could supply, live IPOs first (OD-136), listed IPOs collapsed. Nothing is hidden: rows a
 * spec rule takes off the disagreement list (F-173) stay, labelled with that rule; a missing value
 * with no recorded reason says "no reason recorded".
 *
 * This page never writes. Each item links to the IPO-page editor at that field — "there is one
 * place where an admin value is written" (§9.4). The old resolve / bulk-resolve / auto-resolve
 * actions are gone from this page for that reason.
 */
import { useCallback, useEffect, useState } from 'react';
import { adminGet } from '@/lib/admin/admin-api-client';
import type { QueueResponse } from '@/lib/services/admin-queue-service';
import type { QueueView } from '@/lib/admin/queue/queue-order';
import { QueueCountsPanel } from '@/components/admin/queue/QueueCountsPanel';
import { QueueFilters } from '@/components/admin/queue/QueueFilters';
import { QueueItemRow } from '@/components/admin/queue/QueueItemRow';
import { QueueIpoRow } from '@/components/admin/queue/QueueIpoRow';
import { QueuePager } from '@/components/admin/queue/QueuePager';
import { queueUrl } from '@/components/admin/queue/queue-url';

export default function AdminQueuePage() {
  const [view, setView] = useState<QueueView>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (v: QueueView, p: number) => {
    setLoading(true);
    setError(null);
    try {
      setData((await adminGet(queueUrl(v, p))) as unknown as QueueResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(view, page);
  }, [load, view, page]);

  const changeView = (v: QueueView) => {
    setPage(1);
    setView(v);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Data quality queue</h1>
        <p className="text-gray-400 mt-1 text-sm">
          Everything an admin should fix, live IPOs first. Each item opens the IPO page editor at that field; values
          are changed only there.
        </p>
      </div>

      {error ? <div className="bg-red-900/30 border border-red-600 rounded-lg p-4 text-red-300">{error}</div> : null}

      {data ? <QueueCountsPanel counts={data.counts} onReason={(reason) => changeView({ ...view, reason })} /> : null}

      <QueueFilters view={view} onChange={changeView} />

      {loading && !data ? <div className="text-gray-400">Loading the queue…</div> : null}

      {data ? (
        <div className="bg-gray-800 rounded-lg p-4 space-y-4">
          <QueuePager page={data.page} totalPages={data.totalPages} totalEntries={data.totalEntries} onPage={setPage} />
          {data.entries.length === 0 ? (
            <div className="text-gray-400 py-6 text-center">Nothing to fix in this view.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full" data-testid="queue-table">
                <thead>
                  <tr className="text-left text-xs uppercase text-gray-400">
                    <th className="px-3 py-2">IPO</th>
                    <th className="px-3 py-2">Field</th>
                    <th className="px-3 py-2">Kind</th>
                    <th className="px-3 py-2">Reason</th>
                    <th className="px-3 py-2">Source values</th>
                    <th className="px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e) =>
                    e.type === 'item' ? (
                      <QueueItemRow key={e.item.id} item={e.item} group={e.group} />
                    ) : (
                      <QueueIpoRow key={e.summary.ipo.id} summary={e.summary} onOpen={(slug) => changeView({ ipo: slug })} />
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
