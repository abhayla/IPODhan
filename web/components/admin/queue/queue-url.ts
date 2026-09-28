/** The queue API URL for a view and page (server-side pagination). */
import type { QueueView } from '@/lib/admin/queue/queue-order';

export const QUEUE_PAGE_SIZE = 50;

export function queueUrl(view: QueueView, page: number): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(QUEUE_PAGE_SIZE) });
  if (view.group) params.set('group', String(view.group));
  if (view.kind) params.set('kind', view.kind);
  if (view.reason) params.set('reason', view.reason);
  if (view.ipo) params.set('ipo', view.ipo);
  return `/api/admin/queue?${params.toString()}`;
}
