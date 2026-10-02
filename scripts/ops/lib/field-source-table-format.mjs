// Pure formatting for scripts/ops/field-source-table.mjs (no DB, no clock, no I/O).
//
// Why this is a port and not an import: the admin edit view's builder (web/lib/admin/ipo-editor-data.ts,
// `buildWitnesses`) is TypeScript that imports `@ipodhan/shared` (also TS); a plain `node` script cannot load
// either without a build step the ops scripts do not have. The rule is copied 1:1 (order of evidence: stored
// witnesses, then the stored value itself when that source supplied it, then the plan row's answers; spec
// §9.3, OD-103, OD-137), and it keeps the witness `outcome` the editor collapses, so the report can say it.

const DOC_LABELS = new Set(['DOC', 'DRHP', 'RHP', 'PROSPECTUS', 'CORRIGENDUM', 'PRICE_BAND_AD']);
const SOURCE_ALIASES = { DOC: DOC_LABELS, CHITTORGARH: new Set(['CHITTORGARH', 'CG']) };

export function labelMatchesRank(label, rank) {
  if (typeof label !== 'string') return false;
  const l = label.trim().toUpperCase();
  return (SOURCE_ALIASES[rank] ?? new Set([rank])).has(l);
}

/** snake_case SQL name -> the camelCase name field_sources.field_name stores. */
export function camelCase(sqlName) {
  return sqlName.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/**
 * One ranked source's answer per rank, in rank order (spec §9.3). Same evidence order as the editor.
 * Each entry: { rank, source, status: value|abstained|failed|never_asked, outcome, value, cause, docType, credited }.
 */
export function buildWitnesses({ ranks, witnesses, planAnswers, fsSource, currentValue }) {
  const lists = [witnesses, planAnswers].map((l) => (Array.isArray(l) ? l : []));
  const statusOf = (o) => {
    if (o === undefined || o === null || o === 'SUPPLIED') return 'value';
    if (o === 'NOT_PRINTED' || o === 'NOT_AVAILABLE_YET') return 'abstained';
    return 'failed';
  };
  return ranks.map((rank, i) => {
    const current = fsSource != null && fsSource !== 'ADMIN' && labelMatchesRank(fsSource, rank);
    for (const list of lists) {
      const w = list.find((x) => x && labelMatchesRank(x.source, rank));
      if (!w) continue;
      const status = statusOf(w.outcome);
      const credited = w.credited !== undefined;
      const hasValue = status === 'value' && !credited && w.value !== null && w.value !== undefined;
      return {
        rank: i + 1,
        source: rank,
        status: status === 'value' && !hasValue ? 'abstained' : status,
        outcome: w.outcome ?? 'SUPPLIED',
        value: hasValue ? w.value : null,
        cause: typeof w.cause === 'string' ? w.cause : null,
        docType: typeof w.docType === 'string' ? w.docType : null,
        credited: credited ? { kind: w.credited, rowCount: typeof w.rowCount === 'number' ? w.rowCount : null } : null,
      };
    }
    if (current && currentValue !== null && currentValue !== undefined) {
      return {
        rank: i + 1, source: rank, status: 'value', outcome: 'SUPPLIED', value: currentValue, cause: null,
        docType: DOC_LABELS.has(String(fsSource)) ? String(fsSource) : null, credited: null,
      };
    }
    return { rank: i + 1, source: rank, status: 'never_asked', outcome: null, value: null, cause: null, docType: null, credited: null };
  });
}

const MAX_VALUE = 70;

/** A stored value as one short line of text. */
export function formatValue(v) {
  if (v === null || v === undefined) return '';
  let s;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  s = s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
  return s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE)}...` : s;
}

/** One source cell: `SOURCE: value (DOCTYPE)` or `SOURCE: <plain-words outcome>`. */
export function renderSourceCell(w) {
  const head = w.source;
  if (w.status === 'never_asked') return `${head}: not asked yet`;
  if (w.credited) {
    return w.credited.kind === 'DOCUMENT_VALUE_STORED'
      ? `${head}: prints the stored value (credited)`
      : `${head}: ${w.credited.rowCount ?? 'some'} stored rows (credited)`;
  }
  if (w.status === 'value') {
    const t = w.docType && w.source === 'DOC' ? ` (${w.docType})` : '';
    return `${head}: ${formatValue(w.value)}${t}`;
  }
  const cause = w.cause ?? '';
  if (w.outcome === 'NOT_AVAILABLE_YET') return `${head}: not available yet`;
  if (w.outcome === 'NOT_PRINTED') return `${head}: not printed by the source`;
  if (w.outcome === 'CHECK_FAILED' || w.outcome === 'FAILED') {
    if (cause.includes('[gap:NO_MAPPING]')) return `${head}: no data (source not mapped)`;
    if (cause.includes('[gap:NO_DOCUMENT_PROVENANCE]')) return `${head}: not read from document`;
    return `${head}: ${w.outcome === 'FAILED' ? 'failed' : 'check failed'}`;
  }
  return `${head}: gave no value`;
}

/** Cells for the three source columns; sources beyond the third are appended to the third cell. */
export function sourceColumns(witnesses) {
  const cells = [...witnesses].sort((a, b) => a.rank - b.rank).map(renderSourceCell);
  const out = [cells[0] ?? '—', cells[1] ?? '—', cells[2] ?? '—'];
  if (cells.length > 3) out[2] = [cells[2], ...cells.slice(3)].join('; ');
  return out;
}

/** The "value on page" cell: `value [from SOURCE]`, `(empty)`, or `N rows, e.g. <first>` for a child table. */
export function renderPageCell({ value, source, rowCount = null }) {
  if (rowCount !== null) {
    if (rowCount === 0) return '(empty)';
    const first = formatValue(value);
    return `${rowCount} rows${first ? `, e.g. ${first}` : ''}${source ? ` [from ${source}]` : ''}`;
  }
  const t = formatValue(value);
  if (value === null || value === undefined || t === '' || t === '[]') return '(empty)';
  return `${t}${source ? ` [from ${source}]` : ''}`;
}

/** One markdown table row. */
export function renderRow(field, witnesses, page) {
  const [a, b, c] = sourceColumns(witnesses);
  return `| ${field} | ${a} | ${b} | ${c} | ${renderPageCell(page)} |`;
}

/** Why a field belongs in the "still empty or not from rank 1" list, or null. */
export function attention(page, ranks) {
  const empty = page.value === null || page.value === undefined || formatValue(page.value) === '' || formatValue(page.value) === '[]' || page.rowCount === 0;
  if (empty) return 'empty';
  if (!page.source) return null;
  if (page.source === 'ADMIN') return null;
  const idx = ranks.findIndex((r) => labelMatchesRank(page.source, r));
  if (idx > 0) return `from ${page.source} (rank ${idx + 1}, not rank 1)`;
  return null;
}
