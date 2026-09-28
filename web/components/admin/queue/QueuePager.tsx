/** Server-side pagination controls for the queue. */
const BTN = 'px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm text-white disabled:opacity-40';

export function QueuePager({
  page,
  totalPages,
  totalEntries,
  onPage,
}: {
  page: number;
  totalPages: number;
  totalEntries: number;
  onPage: (p: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 text-sm text-gray-300" data-testid="queue-pager">
      <button type="button" className={BTN} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} of {totalPages} ({totalEntries} lines)
      </span>
      <button type="button" className={BTN} disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  );
}
