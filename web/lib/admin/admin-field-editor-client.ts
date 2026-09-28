/**
 * Browser side of the ONE admin field write for the older editors (spec §9.2 items 3, 10, 20).
 *
 * The server refuses a save without the version token the editor OPENED the field with, and a typed
 * value without a source note (OD-108). These helpers load the token with the value, send it back
 * with the save, and report refused items instead of a blanket success. The API calls are injected
 * so the behaviour is unit-tested without a browser.
 */

type Get = (url: string) => Promise<any>;
type Send = (url: string, body: unknown) => Promise<any>;

/** The legacy editor names some tables in camelCase; the write takes the SQL name. */
const EDITOR_TABLE_NAMES: Record<string, string> = {
  financialData: 'financial_data',
  ipoDetails: 'ipo_details',
  listingPerformance: 'listing_performance',
  ipoFinancials: 'ipo_financials',
  ipoScores: 'ipo_scores',
};

export function sqlTableForEditor(tableName: string): string {
  return EDITOR_TABLE_NAMES[tableName] ?? tableName;
}

export const versionKey = (tableName: string, fieldName: string) => `${sqlTableForEditor(tableName)}.${fieldName}`;

/**
 * Load the version tokens for the fields an editor shows, at the moment it loads their values.
 * A field whose token cannot be read is left out; saving it is then refused by the server as a
 * stale editor rather than silently written.
 */
export async function loadFieldVersions(
  get: Get,
  ipoId: string,
  fields: Array<{ tableName: string; fieldName: string; shown?: unknown }>,
  onStale?: (key: string) => void
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    fields.map(async (field) => {
      const { tableName, fieldName } = field;
      const table = sqlTableForEditor(tableName);
      try {
        const r = await get(
          `/api/admin/update-field?ipoId=${encodeURIComponent(ipoId)}&tableName=${encodeURIComponent(table)}&fieldName=${encodeURIComponent(fieldName)}`
        );
        const v = r?.data?.version;
        // The page's values come from the cached public API; the token is read fresh. When the
        // two disagree the admin is looking at an old value, so no token is kept and the server
        // refuses the save as a stale editor (item 20) instead of overwriting the newer value.
        if ('shown' in field && !sameShownValue(field.shown, r?.data?.currentValue)) {
          onStale?.(versionKey(table, fieldName));
          return;
        }
        if (typeof v === 'string' && v !== '') out[versionKey(table, fieldName)] = v;
      } catch {
        // not admin-writable, or the read failed: no token, the save will be refused
      }
    })
  );
  return out;
}

/**
 * Whether the value an editor shows is the value the database holds. Empty forms (null,
 * undefined, '') are equal; numbers compare numerically ("100.00" == 100); dates compare by
 * instant; everything else by trimmed text.
 */
export function sameShownValue(shown: unknown, stored: unknown): boolean {
  const blank = (x: unknown) => x === null || x === undefined || (typeof x === 'string' && x.trim() === '');
  if (blank(shown) || blank(stored)) return blank(shown) && blank(stored);
  const a = String(shown).trim();
  const b = String(stored).trim();
  if (a === b) return true;
  const na = Number(a);
  const nb = Number(b);
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (!Number.isNaN(da) && !Number.isNaN(db) && /\d{4}-\d{2}-\d{2}/.test(a) && /\d{4}-\d{2}-\d{2}/.test(b)) return da === db || a.slice(0, 10) === b.slice(0, 10);
  return false;
}

/** A typed save with the opened token and the admin's source note. Returns the new token. */
export async function saveTypedField(
  patch: Send,
  args: { ipoId: string; tableName: string; fieldName: string; value: unknown; sourceNote: string; expectedVersion: string | undefined; overrideReason?: string }
): Promise<{ version: string | undefined }> {
  if (!args.sourceNote.trim()) throw new Error('A source note is required for a typed value (document and page, or a URL).');
  const r = await patch('/api/admin/update-field', {
    ipoId: args.ipoId,
    tableName: sqlTableForEditor(args.tableName),
    fieldName: args.fieldName,
    value: args.value,
    mode: 'typed',
    sourceNote: args.sourceNote,
    overrideReason: args.overrideReason,
    expectedVersion: args.expectedVersion ?? '',
  });
  return { version: r?.data?.version };
}

/** "Protect this field": a hold of the shown value, with the token the field opened with. */
export async function holdShownField(
  post: Send,
  args: { ipoId: string; tableName: string; fieldName: string; expectedVersion: string | undefined }
): Promise<void> {
  await post(`/api/admin/protection/fields/${args.ipoId}`, {
    tableName: sqlTableForEditor(args.tableName),
    fieldName: args.fieldName,
    isProtected: true,
    expectedVersion: args.expectedVersion ?? '',
  });
}

export interface BulkHoldResult {
  held: number;
  refused: Array<{ fieldName: string; kind: string; reason: string }>;
}

/** Bulk hold of shown values, each with its own opened token. The refused list is always returned. */
export async function bulkHoldFields(
  post: Send,
  args: { ipoId: string; tableName: string; fieldNames: string[]; versions: Record<string, string> }
): Promise<BulkHoldResult> {
  const table = sqlTableForEditor(args.tableName);
  const versions: Record<string, string> = {};
  for (const f of args.fieldNames) {
    const v = args.versions[versionKey(table, f)];
    if (v) versions[f] = v;
  }
  const r = await post('/api/admin/protection/fields/bulk', { ipoId: args.ipoId, tableName: table, fieldNames: args.fieldNames, isProtected: true, versions });
  const refused = Array.isArray(r?.data?.refused) ? r.data.refused : [];
  const held = typeof r?.data?.updatedCount === 'number' ? r.data.updatedCount : args.fieldNames.length - refused.length;
  return { held, refused };
}

/** Never "N succeeded" when some were refused: the message names every refused field and why. */
export function bulkHoldMessage(result: BulkHoldResult): string {
  if (result.refused.length === 0) return `${result.held} field(s) protected`;
  const list = result.refused.map((r) => `${r.fieldName} (${r.kind}: ${r.reason})`).join('; ');
  return `Error: ${result.refused.length} field(s) refused, ${result.held} protected. Refused: ${list}`;
}
