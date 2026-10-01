'use client';

/**
 * One OD-107 list in the IPO page editor (spec §9.2 items 8, 20, 21, 28(b); OD-121). Rows are added,
 * edited and removed through /api/admin/ipos/[id]/lists/[list] (the one admin list write). A remove
 * asks for a short reason. Every save carries the version token the list was opened with; when
 * another admin changed the list meanwhile the save is refused and the list reloads. Phone layout:
 * one column, 44px tap targets, as the field editor.
 */
import { useCallback, useEffect, useState } from 'react';
import { adminFailureReason, NETWORK_FAILURE_REASON, notSavedText, readJsonBody } from '@/lib/admin/admin-save-failure';

export type ListName =
  | 'lead_managers'
  | 'promoters'
  | 'peer_companies'
  | 'anchor_investors'
  | 'ipo_intermediaries'
  | 'financial_statements'
  | 'ipo_risk_factors';

interface ColumnSpec {
  name: string;
  label: string;
  numeric?: boolean;
}

/** The columns an admin types for each list's row (the server derives the row keys, R-158). */
export const LIST_COLUMNS: Record<ListName, { title: string; columns: ColumnSpec[] }> = {
  lead_managers: { title: 'Lead managers', columns: [{ name: 'name', label: 'Name' }] },
  promoters: { title: 'Promoters', columns: [{ name: 'name', label: 'Name' }, { name: 'sharesHeld', label: 'Shares held', numeric: true }] },
  peer_companies: { title: 'Peer companies', columns: [{ name: 'companyName', label: 'Company' }, { name: 'peRatio', label: 'P/E', numeric: true }] },
  anchor_investors: {
    title: 'Anchor investors',
    columns: [
      { name: 'name', label: 'Investor' },
      { name: 'type', label: 'Type' },
      { name: 'shares', label: 'Shares', numeric: true },
      { name: 'amount', label: 'Amount', numeric: true },
      { name: 'percentOfIssue', label: '% of issue', numeric: true },
    ],
  },
  ipo_intermediaries: { title: 'Intermediaries', columns: [{ name: 'role', label: 'Role' }, { name: 'name', label: 'Name' }] },
  financial_statements: {
    title: 'Financial statements (years)',
    columns: [
      { name: 'fiscalYear', label: 'Fiscal year', numeric: true },
      { name: 'basis', label: 'Basis' },
      { name: 'unit', label: 'Unit' },
      { name: 'revenue', label: 'Revenue' },
      { name: 'pat', label: 'Profit after tax' },
      { name: 'netWorth', label: 'Net worth' },
    ],
  },
  ipo_risk_factors: { title: 'Risk factors', columns: [{ name: 'seq', label: 'Order', numeric: true }, { name: 'heading', label: 'Heading' }] },
};

interface ListRow {
  key: string;
  label: string;
  row: Record<string, unknown>;
}

type Draft = Record<string, string>;

/** Where a refused save is shown: inside the row it was for, or under the add form (#1348). */
interface Failure {
  at: string;
  reason: string;
}

function FailureLine({ failure, at }: { failure: Failure | null; at: string }) {
  if (!failure || failure.at !== at) return null;
  return (
    <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-800">
      {notSavedText(failure.reason)}
    </p>
  );
}

function toRow(list: ListName, draft: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of LIST_COLUMNS[list].columns) {
    const v = (draft[c.name] ?? '').trim();
    if (v === '') continue;
    out[c.name] = c.numeric && Number.isFinite(Number(v)) ? Number(v) : v;
  }
  return out;
}

function draftOf(list: ListName, row: Record<string, unknown>): Draft {
  const d: Draft = {};
  for (const c of LIST_COLUMNS[list].columns) d[c.name] = row[c.name] == null ? '' : String(row[c.name]);
  return d;
}

function RowForm({ list, initial, submitLabel, busy, onSubmit, onCancel }: {
  list: ListName;
  initial: Draft;
  submitLabel: string;
  busy: boolean;
  onSubmit: (d: Draft) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
    >
      {LIST_COLUMNS[list].columns.map((c) => (
        <label key={c.name} className="block text-sm font-medium">
          {c.label}
          <input
            className="mt-1 block min-h-[44px] w-full rounded-md border border-gray-300 px-3 py-2 text-base"
            inputMode={c.numeric ? 'decimal' : undefined}
            value={draft[c.name] ?? ''}
            onChange={(e) => setDraft({ ...draft, [c.name]: e.target.value })}
          />
        </label>
      ))}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="submit" disabled={busy} className="min-h-[44px] rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="min-h-[44px] rounded-md border border-gray-300 px-4 py-2 text-sm">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function ListEditor({ ipoId, list, onSaved }: { ipoId: string; list: ListName; onSaved?: () => void }) {
  const [rows, setRows] = useState<ListRow[] | null>(null);
  const [version, setVersion] = useState('');
  const [owned, setOwned] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const url = `/api/admin/ipos/${ipoId}/lists/${list}`;

  const load = useCallback(async () => {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) {
      setMessage(res.status === 401 ? 'Your admin session has ended. Sign in again.' : `Could not load the list (HTTP ${res.status})`);
      return;
    }
    const data = (await res.json()).data as { rows: ListRow[]; version: string; owned: boolean };
    setRows(data.rows);
    setVersion(data.version);
    setOwned(data.owned);
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  /** `at` is the row key the save is for, or 'add'; a refusal is shown there (#1348). */
  const save = async (op: Record<string, unknown>, at: string): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    setFailure(null);
    try {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op, expectedVersion: version }),
        });
      } catch {
        setFailure({ at, reason: NETWORK_FAILURE_REASON });
        return false;
      }
      const body = await readJsonBody(res);
      if (res.status === 409) {
        setFailure({ at, reason: typeof body.reason === 'string' ? body.reason : 'someone else changed this list. It has been reloaded; make your change again.' });
        await load();
        return false;
      }
      if (!res.ok || body.success === false) {
        setFailure({ at, reason: adminFailureReason(res.status, body) });
        return false;
      }
      await load();
      setMessage('Saved. This list is now kept as you set it; a document with a different list shows up as a suggestion.');
      onSaved?.();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const spec = LIST_COLUMNS[list];
  return (
    <section className="space-y-3" data-testid={`list-editor-${list}`} aria-label={spec.title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{spec.title}</h3>
        {owned && <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-800">kept as an admin set it</span>}
      </div>
      {rows === null && !message && <p className="text-sm text-gray-600">Loading...</p>}
      {rows && rows.length === 0 && <p className="text-sm text-gray-600">No rows.</p>}
      <ul className="space-y-2">
        {(rows ?? []).map((r) => (
          <li key={r.key} className="flex flex-col gap-2 rounded-md border border-gray-200 p-3" data-testid="list-row">
            <span className="text-sm text-gray-900">{r.label}</span>
            <FailureLine failure={failure} at={r.key} />
            {editing === r.key ? (
              <RowForm
                list={list}
                initial={draftOf(list, r.row)}
                submitLabel="Save row"
                busy={busy}
                onSubmit={async (d) => {
                  if (await save({ kind: 'edit', rowKey: r.key, row: toRow(list, d) }, r.key)) setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            ) : removing === r.key ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await save({ kind: 'remove', rowKeys: [r.key], reason }, r.key)) {
                    setRemoving(null);
                    setReason('');
                  }
                }}
              >
                <label className="block text-sm font-medium">
                  Why remove it? (required)
                  <input
                    className="mt-1 block min-h-[44px] w-full rounded-md border border-red-300 px-3 py-2 text-base"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="submit" disabled={busy || reason.trim().length < 3} className="min-h-[44px] rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 disabled:opacity-50">
                    Remove row
                  </button>
                  <button type="button" onClick={() => setRemoving(null)} className="min-h-[44px] rounded-md border border-gray-300 px-4 py-2 text-sm">
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={() => setEditing(r.key)} className="min-h-[44px] rounded-md border border-gray-300 px-4 py-2 text-sm">
                  Edit
                </button>
                <button type="button" onClick={() => setRemoving(r.key)} className="min-h-[44px] rounded-md border border-red-300 px-4 py-2 text-sm text-red-700">
                  Remove
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <FailureLine failure={failure} at="add" />
      {adding ? (
        <RowForm
          list={list}
          initial={{}}
          submitLabel="Add row"
          busy={busy}
          onSubmit={async (d) => {
            if (await save({ kind: 'add', row: toRow(list, d) }, 'add')) setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="min-h-[44px] rounded-md border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-800">
          Add a row
        </button>
      )}
      {message && (
        <p className="text-sm text-gray-800" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
