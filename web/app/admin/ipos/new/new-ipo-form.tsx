'use client';

/**
 * The "New IPO" form — spec §9.2 item 15 (OD-111). An admin gives the company name, the offering
 * type and at least one identifier binding uses (OD-89); the server refuses a missing identifier, a
 * SEBI filing number, and an identifier another row already has (naming that row).
 */
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export const IDENTIFIER_OPTIONS: { kind: string; label: string; placeholder: string }[] = [
  { kind: 'CIN', label: 'CIN', placeholder: 'U31909DL2005PLC139412' },
  { kind: 'NSE_SYMBOL', label: 'NSE symbol', placeholder: 'ICEL' },
  { kind: 'BSE_SYMBOL', label: 'BSE symbol', placeholder: 'ICEL' },
  { kind: 'BSE_IPO_NO', label: 'BSE IPO number', placeholder: '7900' },
  { kind: 'NSE_ISSUE', label: 'NSE issue (SYMBOL|SERIES)', placeholder: 'ICEL|SM' },
  { kind: 'CG_PAGE_ID', label: 'Chittorgarh page id or URL', placeholder: 'https://www.chittorgarh.com/ipo/<name>/<id>/' },
];

interface IdentifierRow {
  kind: string;
  value: string;
}

interface Refusal {
  message: string;
  existingSlug?: string;
}

export function NewIpoForm({ offeringTypes }: { offeringTypes: readonly string[] }) {
  const router = useRouter();
  const [companyName, setCompanyName] = useState('');
  const [offeringType, setOfferingType] = useState('IPO');
  const [segment, setSegment] = useState('');
  const [identifiers, setIdentifiers] = useState<IdentifierRow[]>([{ kind: 'CIN', value: '' }]);
  const [sourceNote, setSourceNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [createdWithoutPage, setCreatedWithoutPage] = useState<string | null>(null);

  const setIdentifier = (i: number, patch: Partial<IdentifierRow>) =>
    setIdentifiers((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setRefusal(null);
    setCreatedWithoutPage(null);
    const filled = identifiers.filter((r) => r.value.trim() !== '');
    if (filled.length === 0) {
      setRefusal({ message: 'Give at least one identifier: the CIN, an exchange or Chittorgarh record number, or the NSE or BSE symbol.' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/ipos', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName,
          offeringType,
          segment: segment === '' ? null : segment,
          identifiers: filled,
          sourceNote: sourceNote.trim() === '' ? null : sourceNote,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 201 && json?.data?.kind === 'CREATED') {
        if (json.data.editorPath) {
          router.push(json.data.editorPath);
          return;
        }
        setCreatedWithoutPage(json.data.slug);
        return;
      }
      setRefusal({
        message: json?.error?.message ?? `Not created (HTTP ${res.status}).`,
        existingSlug: json?.error?.details?.existingSlug,
      });
    } catch {
      setRefusal({ message: 'The request failed; check the connection and try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 max-w-2xl" aria-label="New IPO">
      <div>
        <label htmlFor="new-ipo-name" className="block text-sm font-medium text-gray-300">Company name</label>
        <input
          id="new-ipo-name"
          required
          maxLength={255}
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-white px-3 py-2"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="new-ipo-type" className="block text-sm font-medium text-gray-300">Offering type</label>
          <select
            id="new-ipo-type"
            value={offeringType}
            onChange={(e) => setOfferingType(e.target.value)}
            className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-white px-3 py-2"
          >
            {offeringTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="new-ipo-segment" className="block text-sm font-medium text-gray-300">
            Segment{offeringType === 'IPO' ? '' : ' (optional)'}
          </label>
          <select
            id="new-ipo-segment"
            required={offeringType === 'IPO'}
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
            className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-white px-3 py-2"
          >
            <option value="">—</option>
            <option value="MAINBOARD">MAINBOARD</option>
            <option value="SME">SME</option>
          </select>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-gray-300">Identifiers (at least one)</legend>
        <p className="text-xs text-gray-400">
          The scraper finds this row later by one of these. A match on the name alone is held for review.
        </p>
        {identifiers.map((row, i) => (
          <div key={i} className="flex flex-col gap-2 sm:flex-row">
            <select
              aria-label={`Identifier ${i + 1} kind`}
              value={row.kind}
              onChange={(e) => setIdentifier(i, { kind: e.target.value })}
              className="rounded border border-gray-600 bg-gray-900 text-white px-2 py-2 sm:w-64"
            >
              {IDENTIFIER_OPTIONS.map((o) => <option key={o.kind} value={o.kind}>{o.label}</option>)}
            </select>
            <input
              aria-label={`Identifier ${i + 1} value`}
              value={row.value}
              placeholder={IDENTIFIER_OPTIONS.find((o) => o.kind === row.kind)?.placeholder}
              onChange={(e) => setIdentifier(i, { value: e.target.value })}
              className="flex-1 rounded border border-gray-600 bg-gray-900 text-white px-3 py-2"
            />
            {identifiers.length > 1 && (
              <button
                type="button"
                onClick={() => setIdentifiers((rows) => rows.filter((_, j) => j !== i))}
                className="text-sm text-gray-400 underline"
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setIdentifiers((rows) => [...rows, { kind: 'NSE_SYMBOL', value: '' }])}
          className="text-sm text-blue-400 underline"
        >
          Add another identifier
        </button>
      </fieldset>

      <div>
        <label htmlFor="new-ipo-note" className="block text-sm font-medium text-gray-300">Where you read these (optional)</label>
        <input
          id="new-ipo-note"
          maxLength={500}
          value={sourceNote}
          placeholder="RHP cover page, or a URL"
          onChange={(e) => setSourceNote(e.target.value)}
          className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-white px-3 py-2"
        />
      </div>

      {refusal && (
        <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <p>{refusal.message}</p>
          {refusal.existingSlug && (
            <a href={`/ipos/${refusal.existingSlug}?edit=`} className="mt-1 inline-block underline">
              Open the existing row in the editor
            </a>
          )}
        </div>
      )}
      {createdWithoutPage && (
        <div role="status" className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          Created ({createdWithoutPage}). This offering type has no detail page yet, so there is no editor to open.
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50"
      >
        {submitting ? 'Creating…' : 'Create'}
      </button>
    </form>
  );
}
