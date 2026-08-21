/**
 * Postgres error-cause extraction (GitHub #139).
 *
 * A repository that wraps a driver error in a generic `DatabaseError` and a
 * caller that logs only `error.message` together destroy every diagnosable
 * detail the driver gave us. That combination hid a 100% (243/243)
 * listing-performance upsert failure for seven weeks: every log line read
 * "Failed to upsert listing performance" while Postgres was actually saying
 * `null value in column "listing_price" ... violates not-null constraint`.
 *
 * `describeDbCause` walks an error's `cause` chain and pulls out the fields
 * pg attaches to a `DatabaseError` (code, detail, constraint, column, table),
 * so `error-handling.md`'s "preserve the original cause" and "actionable
 * context in every error message" are actually satisfied at the log line.
 */

/** The diagnosable fields pg attaches to a query error, plus the message chain. */
export interface DbCauseDescription {
  /** SQLSTATE, e.g. '23502' (not_null_violation) or '42P10' (invalid ON CONFLICT). */
  code?: string;
  /** pg's DETAIL line — usually names the offending row/value. */
  detail?: string;
  /** The violated constraint's name, when pg reports one. */
  constraint?: string;
  /** The offending column, when pg reports one. */
  column?: string;
  /** The target table, when pg reports one. */
  table?: string;
  /** Every message in the cause chain, outermost first. */
  chain: string[];
}

const PG_FIELDS = ['code', 'detail', 'constraint', 'column', 'table'] as const;

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}

/**
 * Walk `error.cause` (up to `maxDepth` links, so a cyclic chain cannot hang the
 * logger) and return the first Postgres diagnostics found plus the full message
 * chain. Never throws — a logger must not be able to fail the caller.
 */
export function describeDbCause(error: unknown, maxDepth = 8): DbCauseDescription {
  const out: DbCauseDescription = { chain: [] };
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < maxDepth && current != null; depth++) {
    if (seen.has(current)) break;
    seen.add(current);

    out.chain.push(messageOf(current));

    if (typeof current === 'object') {
      const record = current as Record<string, unknown>;
      for (const field of PG_FIELDS) {
        const value = record[field];
        // First (innermost-wins is wrong here: the outermost wrapper has no pg
        // fields, so "first seen" IS the driver error) non-empty value wins.
        if (out[field] === undefined && typeof value === 'string' && value !== '') {
          out[field] = value;
        }
      }
      current = record.cause;
    } else {
      break;
    }
  }

  return out;
}

/**
 * One-line, log-safe rendering of a cause chain: `23502 [listing_price] null
 * value in column "listing_price" ... <- Failed to upsert listing performance`.
 * Never includes a value the caller did not already have.
 */
export function formatDbCause(error: unknown): string {
  const d = describeDbCause(error);
  const head = [d.code, d.constraint ?? d.column].filter(Boolean).join(' ');
  const chain = d.chain.join(' <- ');
  return head ? `${head}: ${chain}` : chain;
}
