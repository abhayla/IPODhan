// PULL-NOOP and PULL-WRITE (issue #1490): pure verdict logic, so a fake query can plant every shape.
// Both checks used to mis-model correct behaviour: PULL-NOOP counted any field_sources.updated_at
// as a write; PULL-WRITE compared a GLOBAL table.field set, ignoring the IPO and the row key.
import { resolveColumn, isBlankCurrentValue, isSafeTableName } from './pull-noblank-checks.mjs';

/**
 * A touched field_sources row is a REAL change only when the writer recorded a prior value, or the
 * winning source moved. A re-read that rewrote the same value leaves previous_value NULL and, at
 * most, a previous_source equal to source.
 */
export function isRealChange(r) {
  const hadPrev = r.previousValue !== null && r.previousValue !== undefined && String(r.previousValue) !== '';
  const sourceMoved = !!r.previousSource && r.previousSource !== r.source;
  return hadPrev || sourceMoved;
}

/**
 * @param {Array<{previousValue, previousSource, source, hasReceipt:boolean, answersRound:boolean}>} rows
 *   every field_sources row touched in the window, with two per-IPO flags: a document_field_receipts
 *   row created in the window (a stored document was re-read) / ipos.answers_round_at in the window.
 */
export function classifyNoopWrites(rows) {
  let realChanges = 0, unexplained = 0, exemptedReread = 0, exemptedAnswers = 0;
  for (const r of rows) {
    if (!isRealChange(r)) continue;
    realChanges++;
    if (r.hasReceipt) { exemptedReread++; continue; }
    if (r.answersRound) { exemptedAnswers++; continue; }
    unexplained++;
  }
  return { touched: rows.length, realChanges, unexplained, exemptedReread, exemptedAnswers };
}

export const toCamel = (c) => c.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());

const sval = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * One SUPPLIED plan row with no field_sources row for its own ipo + row_key + field. It is a missed
 * write unless the value is ALREADY stored: a stored non-blank column that either an answer credited
 * (item 38: value null, `credited` set) or equals a SUPPLIED answer's value.
 * @returns {Promise<{ok:boolean, why:string}>}
 */
export async function judgeUnwrittenSupplied(plan, q) {
  const table = plan.tableName;
  if (!isSafeTableName(table)) return { ok: false, why: 'unsafe table name' };
  const cols = new Set((await q(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`, [table]
  )).map((c) => c.column_name));
  const column = resolveColumn(cols, plan.fieldName) ?? resolveColumn(cols, toCamel(plan.fieldName));
  if (!column) return { ok: false, why: 'column not found' };
  const idCol = table === 'ipos' ? 'id' : 'ipo_id';
  // Identify the plan row's OWN row (scraper/src/services/child-row-keys.ts). A value in another row
  // of the same IPO never credits this one.
  let where = `${idCol} = $1`;
  const params = [plan.ipoId];
  const rowKey = plan.rowKey ?? '';
  if (rowKey !== '') {
    if (table === 'financial_statements' && /^\d+:.+$/.test(rowKey)) {
      const i = rowKey.indexOf(':');
      where += ' AND fiscal_year = $2 AND basis = $3';
      params.push(Number(rowKey.slice(0, i)), rowKey.slice(i + 1));
    } else if (table === 'ipo_valuation') {
      where += ' AND pricing_event = $2';
      params.push(rowKey);
    } else {
      return { ok: false, why: `row ${rowKey} not identifiable in ${table}` };
    }
  }
  const rows = (await q(`SELECT "${column}" AS v FROM ${table} WHERE ${where} LIMIT 500`, params)).map((r) => r.v);
  // '' on a table with several rows per IPO (item 38: risk-factor seq, statement basis/unit) means the
  // column across the IPO's rows: every one of them must carry a value.
  if (rows.length === 0) return { ok: false, why: 'stored row not found' };
  if (rows.some((v) => isBlankCurrentValue(v))) return { ok: false, why: 'stored column empty' };
  const answers = Array.isArray(plan.answers) ? plan.answers.filter((a) => a && a.outcome === 'SUPPLIED') : [];
  const withValue = answers.filter((a) => a.value !== null && a.value !== undefined);
  const stored = rows.map(sval);
  if (withValue.length > 0) {
    // A SUPPLIED answer that states a value is COMPARED with what is stored (credited or not).
    const want = new Set(withValue.map((a) => sval(a.value)));
    return stored.every((v) => want.has(v))
      ? { ok: true, why: 'stored equals answer' }
      : { ok: false, why: 'stored value differs from the SUPPLIED answer' };
  }
  if (answers.some((a) => a.credited)) return { ok: true, why: 'credited, value stored' };
  return { ok: false, why: 'no SUPPLIED answer states or credits the stored value' };
}

/**
 * @param {Array} planRows SUPPLIED plan rows {ipoId, slug, tableName, rowKey, fieldName, answers}
 * @param {Set<string>} writtenKeys `${ipoId}|${table}|${rowKey}|${camelField}` of every field_sources row
 */
export async function evaluatePullWrite(planRows, writtenKeys, q) {
  const missing = [];
  let credited = 0;
  for (const p of planRows) {
    if (writtenKeys.has(`${p.ipoId}|${p.tableName}|${p.rowKey}|${toCamel(p.fieldName)}`)) continue;
    let v;
    try { v = await judgeUnwrittenSupplied(p, q); } catch (e) { v = { ok: false, why: `unreadable: ${e.message}` }; }
    if (v.ok) credited++; else missing.push({ ...p, why: v.why });
  }
  return { missing, credited };
}
