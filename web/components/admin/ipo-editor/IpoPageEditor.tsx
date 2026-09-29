'use client';

/**
 * The admin editor on the public IPO page (spec §9.2 items 1, 2, 3, 5, 7, 12, 17, 20, 21, 22).
 *
 * Rendered only when the server page recognised an admin session (item 1); a reader never receives
 * it. It fetches its own data from GET /api/admin/ipos/[id]/editor (item 24: source values never enter
 * the public payload or cache) and saves through PATCH /api/admin/update-field, the ONE admin write
 * (item 11). There is deliberately no "re-scrape" action (item 22, OD-65, OD-56).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ListEditor, LIST_COLUMNS, type ListName } from './ListEditor';
import { useRouter } from 'next/navigation';
import type { EditorField, EditorPayload, SourceWitness } from '@/lib/admin/ipo-editor-data';
import { previewTyped, showStoredValue } from '@/lib/admin/editor-value-units';

export const OPEN_EVENT = 'ipo-editor:open';

/** The page sections an Edit control opens, by the tables whose fields they show. */
export const SECTION_TABLES: Record<string, string[] | null> = {
  all: null,
  details: ['ipos', 'ipo_details'],
  financials: ['financial_data'],
  listing: ['listing_performance'],
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A stored UTC text timestamp as an IST calendar date ("16 Sep 2026"; ist-timezone rule). */
export function istDate(text: string | null): string | null {
  if (!text) return null;
  const at = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
  if (Number.isNaN(at.getTime())) return null;
  const ist = new Date(at.getTime() + 330 * 60_000);
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
}

function humanLabel(column: string): string {
  const s = column.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function witnessText(w: SourceWitness, croreInput: boolean): string {
  if (w.status === 'value') return showStoredValue(w.value, croreInput);
  if (w.status === 'abstained') return `did not give a value${w.cause ? ` (${w.cause})` : ''}`;
  if (w.status === 'failed') return `failed${w.cause ? `: ${w.cause}` : ''}`;
  return 'never asked (this IPO was read before per-source answers were kept)';
}

interface SaveBody {
  mode?: 'pick' | 'typed';
  sourceLabel?: string;
  value?: unknown;
  sourceNote?: string;
  emptyReason?: string;
  overrideReason?: string;
}

type SaveOutcome =
  | { kind: 'ok'; value: unknown; version: string }
  | { kind: 'invalid'; reason: string; checkFailed: boolean }
  | { kind: 'conflict'; currentValue: unknown; setBy: string | null; setAt: string | null; currentVersion: string }
  | { kind: 'error'; reason: string };

async function saveField(ipoId: string, field: EditorField, version: string, body: SaveBody): Promise<SaveOutcome> {
  const res = await fetch('/api/admin/update-field', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ipoId, tableName: field.tableName, fieldName: field.fieldName, expectedVersion: version, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (res.ok && json.success) return { kind: 'ok', value: json.data?.value ?? null, version: json.data?.version };
  if (res.status === 409) {
    return { kind: 'conflict', currentValue: json.currentValue, setBy: json.setBy ?? null, setAt: json.setAt ?? null, currentVersion: json.currentVersion };
  }
  if (res.status === 400) {
    const reason = String(json.reason ?? json.error ?? 'refused');
    return { kind: 'invalid', reason, checkFailed: /fails its check/.test(reason) };
  }
  return { kind: 'error', reason: String(json.reason ?? json.error ?? `HTTP ${res.status}`) };
}

export function FieldEditor({ ipoId, field, onSaved }: { ipoId: string; field: EditorField; onSaved: (f: EditorField) => void }) {
  const [version, setVersion] = useState(field.version ?? '');
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [needsOverride, setNeedsOverride] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Extract<SaveOutcome, { kind: 'conflict' }> | null>(null);
  const preview = previewTyped(typed, field.croreInput);

  const run = async (body: SaveBody) => {
    setBusy(true);
    setMessage(null);
    const out = await saveField(ipoId, field, version, body);
    setBusy(false);
    if (out.kind === 'ok') {
      setVersion(out.version);
      setConflict(null);
      setNeedsOverride(false);
      setTyped('');
      setNote('');
      setDeleteReason('');
      setOverrideReason('');
      setMessage('Saved. The page shows it now.');
      onSaved({ ...field, currentValue: out.value, version: out.version, currentSource: 'ADMIN' });
    } else if (out.kind === 'conflict') {
      setConflict(out);
    } else if (out.kind === 'invalid') {
      setNeedsOverride(out.checkFailed);
      setMessage(out.reason);
    } else {
      setMessage(out.reason);
    }
  };

  if (field.mode === 'derived') {
    return <p className="text-sm text-gray-600">Calculated from {field.derivedFrom}. Correct those fields and this follows.</p>;
  }
  if (field.mode === 'readonly') {
    return <p className="text-sm text-gray-600">{field.readonlyReason ?? 'Not edited here: this value is read many times a day or kept by the system.'}</p>;
  }

  if (field.mode === 'setting' && field.column === 'rating_override') {
    // §9.2 item 7: a plain on/off control, not the source panel — saved through the same ONE admin
    // write as a typed value, with a note (spec requires `sourceNote` on every typed save).
    const on = field.currentValue === true;
    return (
      <div className="space-y-2">
        <p className="text-sm text-gray-700">Rating override is {on ? 'on' : 'off'}.</p>
        <label className="block text-sm font-medium">
          Source note (why)
          <input
            className="mt-1 block min-h-[44px] w-full rounded-md border border-gray-300 px-3 py-2 text-base"
            value={note}
            required
            onChange={(e) => setNote(e.target.value)}
            name="source-note"
          />
        </label>
        <button
          type="button"
          disabled={busy || !note.trim()}
          className="min-h-[44px] rounded-md border border-gray-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
          onClick={() => run({ mode: 'typed', value: !on, sourceNote: note.trim() })}
        >
          Turn the override {on ? 'off' : 'on'}
        </button>
        {message && <p className="text-sm text-red-700">{message}</p>}
      </div>
    );
  }

  if (field.mode === 'setting' && field.column === 'scraper_locked') {
    const locked = field.currentValue === true;
    return (
      <div className="space-y-2">
        <p className="text-sm text-gray-700">Scraper lock is {locked ? 'on' : 'off'}.</p>
        <button
          type="button"
          disabled={busy}
          className="min-h-[44px] rounded-md border border-gray-300 px-4 py-2 text-sm font-medium"
          onClick={async () => {
            setBusy(true);
            const res = await fetch(`/api/admin/protection/ipo/${ipoId}`, {
              method: 'PATCH',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ scraperLocked: !locked }),
            });
            setBusy(false);
            if (res.ok) onSaved({ ...field, currentValue: !locked });
            else setMessage(`Could not change the lock (HTTP ${res.status})`);
          }}
        >
          Turn the lock {locked ? 'off' : 'on'}
        </button>
        {message && <p className="text-sm text-red-700">{message}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {field.planRebuildNotice && (
        <p role="note" data-testid="plan-rebuild-notice" className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
          {field.planRebuildNotice}
        </p>
      )}
      {field.e1Rule && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">{field.e1Rule}</p>}
      {field.notApplicable && <p className="text-xs text-gray-600">This field does not apply to this offering type (§1.11).</p>}

      {field.witnesses.length > 0 && (
        <ul className="space-y-2" aria-label="What each source said">
          {field.witnesses.map((w) => (
            <li key={w.source} className="flex flex-col gap-2 rounded-md border border-gray-200 p-3" data-testid={`witness-${w.source}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">
                  {w.rank}. {w.source}
                  {w.docType && w.docType !== w.source ? ` (${w.docType})` : ''}
                </span>
                {w.current && <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">supplies the page now</span>}
              </div>
              <span className="text-sm text-gray-800">{witnessText(w, field.croreInput)}</span>
              {w.readAt && <span className="text-xs text-gray-500">read {istDate(w.readAt)}</span>}
              {w.pickLabel && (
                <button
                  type="button"
                  disabled={busy}
                  className="min-h-[44px] self-start rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  // A pick sends only the source label; the server loads that source's stored answer (§9.3, OD-109).
                  onClick={() => run({ mode: 'pick', sourceLabel: w.pickLabel! })}
                >
                  Use this
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!preview.ok || !note.trim()) return;
          run({ mode: 'typed', value: preview.stored, sourceNote: note.trim(), ...(needsOverride ? { overrideReason: overrideReason.trim() } : {}) });
        }}
      >
        <label className="block text-sm font-medium">
          Type a value{field.croreInput ? ' (Rs crore)' : ''}
          <input
            className="mt-1 block min-h-[44px] w-full rounded-md border border-gray-300 px-3 py-2 text-base"
            value={typed}
            inputMode={field.croreInput ? 'decimal' : undefined}
            onChange={(e) => setTyped(e.target.value)}
            name="typed-value"
          />
        </label>
        {typed && <p className="text-xs text-gray-700" data-testid="typed-preview">{preview.text}</p>}
        <label className="block text-sm font-medium">
          Source note (document and page, or a URL)
          <input
            className="mt-1 block min-h-[44px] w-full rounded-md border border-gray-300 px-3 py-2 text-base"
            value={note}
            required
            onChange={(e) => setNote(e.target.value)}
            name="source-note"
          />
        </label>
        {needsOverride && (
          <label className="block text-sm font-medium">
            The value fails its check. Why keep it?
            <input
              className="mt-1 block min-h-[44px] w-full rounded-md border border-red-300 px-3 py-2 text-base"
              value={overrideReason}
              required
              onChange={(e) => setOverrideReason(e.target.value)}
              name="override-reason"
            />
          </label>
        )}
        <button
          type="submit"
          disabled={busy || !preview.ok || !note.trim() || (needsOverride && !overrideReason.trim())}
          className="min-h-[44px] rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Save typed value
        </button>
      </form>

      <form
        className="space-y-2 border-t border-gray-100 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!deleteReason.trim()) return;
          // OD-121: delete keeps the field empty; a source's value comes back only by picking it.
          run({ mode: 'typed', emptyReason: deleteReason.trim() });
        }}
      >
        <label className="block text-sm font-medium">
          Delete (leave the field empty) - reason
          <input
            className="mt-1 block min-h-[44px] w-full rounded-md border border-gray-300 px-3 py-2 text-base"
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            name="delete-reason"
          />
        </label>
        <button type="submit" disabled={busy || !deleteReason.trim()} className="min-h-[44px] rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 disabled:opacity-50">
          Delete value
        </button>
      </form>

      {conflict && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm" role="alert">
          <p>
            This field changed after you opened it: it is now <strong>{showStoredValue(conflict.currentValue, field.croreInput)}</strong>
            {conflict.setBy ? `, set by ${conflict.setBy}` : ''}
            {conflict.setAt ? ` on ${istDate(conflict.setAt)}` : ''}.
          </p>
          <button
            type="button"
            className="mt-2 min-h-[44px] rounded-md border border-amber-400 px-4 py-2"
            onClick={() => {
              setVersion(conflict.currentVersion);
              onSaved({ ...field, currentValue: conflict.currentValue, version: conflict.currentVersion, setBy: conflict.setBy, setAt: conflict.setAt });
              setConflict(null);
              setMessage('Loaded the newer value. Save again if your change is still needed.');
            }}
          >
            Use the newer value and edit again
          </button>
        </div>
      )}
      {message && <p className="text-sm text-gray-800" role="status">{message}</p>}
    </div>
  );
}

function FieldRow({ ipoId, field, open, onToggle, onSaved }: { ipoId: string; field: EditorField; open: boolean; onToggle: () => void; onSaved: (f: EditorField) => void }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: 'start' });
  }, [open]);
  const source =
    field.currentSource === 'ADMIN'
      ? field.admin?.mode === 'pick'
        ? `admin pick from ${field.admin.sourceLabel ?? 'a source'}`
        : 'admin value'
      : field.currentSource;
  return (
    <li ref={ref} id={`edit-${field.tableName}.${field.fieldName}`} className="border-b border-gray-100 py-2" data-field={`${field.tableName}.${field.fieldName}`}>
      <button type="button" onClick={onToggle} className="flex min-h-[44px] w-full flex-col items-start gap-0.5 text-left" aria-expanded={open}>
        <span className="text-sm font-medium">
          {humanLabel(field.column)} <span className="text-xs text-gray-500">({field.fieldClass})</span>
        </span>
        <span className="text-sm text-gray-700">
          {showStoredValue(field.currentValue, field.croreInput)}
          {source ? <span className="text-xs text-gray-500"> - {source}</span> : null}
        </span>
      </button>
      {open && (
        <div className="mt-2">
          <FieldEditor ipoId={ipoId} field={field} onSaved={onSaved} />
        </div>
      )}
    </li>
  );
}

export interface IpoPageEditorProps {
  ipoId: string;
  /** `?edit=<table>.<field>` from the admin queue: open the editor at that field. */
  editTarget?: string | null;
  /** `?row=<rowKey>` (Phase B, row-shaped tables): the row `editTarget` refers to. Never built into a selector — matched by strict equality against the editor's own field keys once the payload loads. */
  editRowKey?: string | null;
}

export function IpoPageEditor({ ipoId, editTarget, editRowKey = null }: IpoPageEditorProps) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(editTarget ? 'all' : null);
  const [payload, setPayload] = useState<EditorPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openField, setOpenField] = useState<string | null>(editTarget ?? null);
  const [filter, setFilter] = useState('');

  // MINOR 1: `edit` alone can be ambiguous once row-shaped tables (Phase B) exist. Once the payload
  // is in, re-resolve the target against the editor's OWN field keys and rowKey — never against a
  // string built from the raw query params — so `?edit=<table>.<field>&row=<rowKey>` opens the right row.
  useEffect(() => {
    if (!payload || !editTarget) return;
    const match = payload.fields.find(
      (f) => (f.key === editTarget || `${f.tableName}.${f.fieldName}` === editTarget) && (!editRowKey || f.rowKey === editRowKey)
    );
    if (match) setOpenField(`${match.tableName}.${match.fieldName}`);
  }, [payload, editTarget, editRowKey]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/admin/ipos/${ipoId}/editor`, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) {
      setError(res.status === 401 ? 'Your admin session has ended. Sign in again.' : `Could not load the editor (HTTP ${res.status})`);
      return;
    }
    setPayload((await res.json()).data);
  }, [ipoId]);

  useEffect(() => {
    const onOpen = (e: Event) => setOpen((e as CustomEvent<{ section?: string }>).detail?.section ?? 'all');
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (open && !payload) void load();
  }, [open, payload, load]);

  const fields = useMemo(() => {
    if (!payload || !open) return [];
    const tables = SECTION_TABLES[open] ?? null;
    const f = filter.trim().toLowerCase();
    return payload.fields.filter(
      (x) => (!tables || tables.includes(x.tableName)) && (!f || x.column.includes(f.replace(/\s+/g, '_')) || x.fieldName.toLowerCase().includes(f))
    );
  }, [payload, open, filter]);

  const onSaved = (updated: EditorField) => {
    setPayload((p) => (p ? { ...p, fields: p.fields.map((x) => (x.key === updated.key ? updated : x)) } : p));
    router.refresh();
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="dialog" aria-modal="true" aria-label="Edit IPO">
      <div className="flex h-full w-full flex-col bg-white shadow-xl sm:max-w-xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-3">
          <h2 className="text-base font-semibold">Edit {payload?.ipo.companyName ?? 'IPO'}</h2>
          <button type="button" className="min-h-[44px] min-w-[44px] rounded-md border border-gray-300 px-3" onClick={() => setOpen(null)}>
            Close
          </button>
        </div>
        <div className="border-b border-gray-100 p-3">
          <input
            className="block min-h-[44px] w-full rounded-md border border-gray-300 px-3 py-2 text-base"
            placeholder="Find a field"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Find a field"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {error && <p className="text-sm text-red-700">{error}</p>}
          {!payload && !error && <p className="text-sm text-gray-600">Loading what each source said...</p>}
          <ul>
            {fields.map((f) => {
              const id = `${f.tableName}.${f.fieldName}`;
              const isOpen = openField === id || openField === f.key;
              return <FieldRow key={f.key} ipoId={ipoId} field={f} open={isOpen} onToggle={() => setOpenField(isOpen ? null : id)} onSaved={onSaved} />;
            })}
          </ul>
          {/* §9.2 item 8 (OD-107): the seven lists, each with add / edit / remove (remove asks a reason). */}
          {!filter.trim() && (
            <div className="mt-4 space-y-2 border-t border-gray-200 pt-3" data-testid="list-editors">
              {(Object.keys(LIST_COLUMNS) as ListName[]).map((list) => (
                <details key={list} open={editTarget === list} className="rounded-md border border-gray-200 p-3">
                  <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-medium">{LIST_COLUMNS[list].title}</summary>
                  <ListEditor ipoId={ipoId} list={list} onSaved={() => router.refresh()} />
                </details>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The Edit control for the whole IPO or one section (item 1). Rendered only for an admin. */
export function AdminEditButton({ section = 'all', label = 'Edit' }: { section?: keyof typeof SECTION_TABLES; label?: string }) {
  return (
    <button
      type="button"
      data-testid={`admin-edit-${section}`}
      className="min-h-[44px] rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-800"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { section } }))}
    >
      {label}
    </button>
  );
}
