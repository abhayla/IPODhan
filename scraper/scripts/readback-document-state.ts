/**
 * T-403 W-2 — read the document pipeline's state back out of Postgres with SQL.
 *
 * WHY THIS FILE EXISTS. The round-3 evidence contained a
 * `state-table-from-postgres.json` produced by an ad-hoc script that was never
 * committed. A reviewer could not re-run it, could not read what it selected,
 * and had to take on trust that the json came from the database it claimed. An
 * evidence file with no committed producer is an assertion, not evidence.
 *
 * What it emits is deliberately a JOIN and not a dump of one table: the claims
 * being checked are cross-table ("every FOUND row names a document", "every
 * FOUND document has a sha256", "the hint columns are populated"), and reading
 * them out of three separate files would let a mismatch hide in the seams.
 *
 * Read-only. It runs against any database, including production, because it
 * only SELECTs — unlike the acceptance harness, which writes and is therefore
 * fenced to `_test` databases.
 *
 * Usage (from scraper/):
 *   DATABASE_URL=... npx tsx scripts/readback-document-state.ts > out.json
 *   DATABASE_URL=... npx tsx scripts/readback-document-state.ts --out=path.json
 *   ... --company="Skyways Air Services Ltd." --company="ESDS ..."   (filter)
 */

import { writeFileSync } from 'node:fs';

export interface ReadbackRow {
  company_name: string;
  doc_type: string;
  state: string;
  attempts: number;
  next_retry_at: string | null;
  blocked_since_at: string | null;
  last_attempt_at: string | null;
  document_id: string | null;
  document_url: string | null;
  document_sha256: string | null;
  document_file_size: number | null;
  company_website: string | null;
  verifier_url: string | null;
  last_attempt: unknown;
  rung_chain: string | null;
}

export interface Readback {
  generatedAt: string;
  database: string;
  rowCount: number;
  byState: Record<string, number>;
  withLastAttempt: number;
  foundWithSha256: number;
  ipos: { company_name: string; company_website: string | null; verifier_url: string | null }[];
  documents: {
    company_name: string;
    type: string;
    url: string;
    file_size: number | null;
    sha256: string | null;
  }[];
  rows: ReadbackRow[];
}

/**
 * The chain line for THIS row, pulled out of last_attempt for readability.
 *
 * F-4: a row's `last_attempt` must carry only its own type's rung chain. Lifting
 * it to a top-level field is what makes a violation obvious on sight rather than
 * something a reader has to notice inside a nested array.
 */
export function rungChainOf(lastAttempt: unknown): string | null {
  if (!Array.isArray(lastAttempt)) return null;
  for (const a of lastAttempt) {
    const outcome = (a as { source?: string; outcome?: string })?.outcome;
    if ((a as { source?: string })?.source === 'CHAIN' && typeof outcome === 'string') return outcome;
  }
  return null;
}

export async function readback(databaseUrl: string, companies: string[]): Promise<Readback> {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: databaseUrl, max: 2, options: '-c timezone=UTC' });
  const q = async <T>(text: string, params: unknown[] = []): Promise<T[]> =>
    (await pool.query(text, params)).rows as T[];

  try {
    const filter = companies.length > 0 ? 'WHERE i.company_name = ANY($1)' : '';
    const params = companies.length > 0 ? [companies] : [];

    const rows = await q<ReadbackRow>(
      `SELECT i.company_name,
              s.doc_type,
              s.state,
              s.attempts,
              s.next_retry_at,
              s.blocked_since_at,
              s.last_attempt_at,
              s.document_id,
              d.url          AS document_url,
              d.sha256       AS document_sha256,
              d.file_size    AS document_file_size,
              i.company_website,
              i.verifier_url,
              s.last_attempt
         FROM document_fetch_state s
         JOIN ipos i       ON i.id = s.ipo_id
         LEFT JOIN documents d ON d.id = s.document_id
         ${filter}
        ORDER BY i.company_name, s.doc_type`,
      params
    );
    for (const r of rows) r.rung_chain = rungChainOf(r.last_attempt);

    const ipos = await q<{ company_name: string; company_website: string | null; verifier_url: string | null }>(
      `SELECT company_name, company_website, verifier_url FROM ipos i ${filter} ORDER BY company_name`,
      params
    );

    const documents = await q<{
      company_name: string;
      type: string;
      url: string;
      file_size: number | null;
      sha256: string | null;
    }>(
      `SELECT i.company_name, d.type::text AS type, d.url, d.file_size, d.sha256
         FROM documents d JOIN ipos i ON i.id = d.ipo_id
         ${filter}
        ORDER BY i.company_name, d.type`,
      params
    );

    const byState: Record<string, number> = {};
    for (const r of rows) byState[r.state] = (byState[r.state] ?? 0) + 1;

    return {
      generatedAt: new Date().toISOString(),
      database: new URL(databaseUrl).pathname.replace(/^\//, ''),
      rowCount: rows.length,
      byState,
      withLastAttempt: rows.filter((r) => Array.isArray(r.last_attempt) && r.last_attempt.length > 0).length,
      foundWithSha256: rows.filter((r) => r.state === 'FOUND' && Boolean(r.document_sha256)).length,
      ipos,
      documents,
      rows,
    };
  } finally {
    await pool.end();
  }
}

const isMain = /readback-document-state[.]ts$/.test(String(process.argv[1] ?? '').split(/[/\\]/).pop() ?? '');
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('readback-document-state: DATABASE_URL is required');
    process.exit(1);
  }
  const companies = process.argv
    .filter((a) => a.startsWith('--company='))
    .map((a) => a.slice('--company='.length));
  const outArg = process.argv.find((a) => a.startsWith('--out='));

  readback(url, companies)
    .then((result) => {
      const json = JSON.stringify(result, null, 2);
      if (outArg) {
        writeFileSync(outArg.slice('--out='.length), json);
        console.log(
          `readback: ${result.rowCount} state row(s), ${result.documents.length} document(s) -> ${outArg.slice('--out='.length)}`
        );
      } else {
        console.log(json);
      }
    })
    .catch((error) => {
      console.error('readback failed:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
