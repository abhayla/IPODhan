// Item 42 (OD-163) core proof, READ-ONLY: runs the REAL answers-only round (`runAnswersOnlyRound`,
// the real askEveryListedRank / mergeHeldWitnesses / computeVerdict and the real DOC, NSE, BSE and
// Chittorgarh fetchers) on ipodhan_staging for national-stock-exchange-of-india-ltd plus two more IPOs
// whose stored values were written by SYSTEM or FILING_PERSISTER, and prints per value the answers it
// WOULD record (source / outcome / value / cause) next to the stored value read before and after.
// No write: the pool is default_transaction_read_only, `trackHeldFieldWitnesses` only computes the
// merge in memory, and the round stamp is captured in memory (staging has no answers_round_at yet).
// Run (from scraper/, with the staging tunnel open): npx tsx ../docs/design/probes/item42-answers-round.mts
import { runAnswersOnlyRound, type AnswersRoundStore } from '../../../scraper/src/services/field-plan-answers-round.ts';
import { buildDocFetcher } from '../../../scraper/src/services/field-plan-walk-doc-fetcher.ts';
import { buildNseFetcher, NseFieldFetcherState } from '../../../scraper/src/services/field-plan-walk-nse-fetcher.ts';
import { buildBseFetcher, BseFieldFetcherState } from '../../../scraper/src/services/field-plan-walk-bse-fetcher.ts';
import {
  buildChittorgarhFetcher,
  ChittorgarhFieldFetcherState,
} from '../../../scraper/src/services/field-plan-walk-chittorgarh-fetcher.ts';
import { loadFieldManifest } from '../../../scraper/src/config/field-manifest-loader.ts';
import { FEATURE_FLAGS } from '../../../scraper/src/config/feature-flags.ts';
import { openReadOnlyPool } from './_lib.mjs';

FEATURE_FLAGS.ENABLE_VERDICT_WRITER = true; // staging runs with it on (brief, measured)
const manifest = loadFieldManifest();
const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const camelRow = (r: Record<string, unknown> | undefined) =>
  r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v])) : null;
const pool = await openReadOnlyPool('ipodhan_staging');
const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows;

const picked = await q(`
  (SELECT i.id, i.slug FROM ipos i WHERE i.slug = 'national-stock-exchange-of-india-ltd')
  UNION ALL
  (SELECT i.id, i.slug FROM ipos i
     JOIN field_sources fs ON fs.ipo_id = i.id AND fs.updated_by IN ('SYSTEM','FILING_PERSISTER')
                          AND (fs.witnesses IS NULL OR jsonb_array_length(fs.witnesses) = 0)
    WHERE i.slug <> 'national-stock-exchange-of-india-ltd' AND i.status::text IN ('OPEN','UPCOMING','CLOSED')
    GROUP BY i.id, i.slug ORDER BY COUNT(*) DESC LIMIT 2)`);

const ipoRepository = { findById: async (id: string) => camelRow((await q(`SELECT * FROM ipos WHERE id=$1`, [id]))[0]) };
const cap = (src: string) => (t: string, f: string) => manifest.fields[`${t}.${f}`]?.capability?.[src]?.capable === true;
const doc = buildDocFetcher({
  fieldSources: {
    findByField: async (ipoId: string, t: string, f: string, rk: string) =>
      (await q(`SELECT source::text AS source, data_lineage AS "dataLineage" FROM field_sources WHERE ipo_id=$1 AND table_name=$2 AND field_name=$3 AND row_key=$4`, [ipoId, t, f, rk]))[0] ?? null,
  } as never,
  ipoRepository: ipoRepository as never,
  documentRepository: {
    findByIPO: async (id: string) =>
      q(`SELECT id, type::text AS type, extraction_status::text AS "extractionStatus", is_active AS "isActive", sha256, filing_date AS "filingDate" FROM documents WHERE ipo_id=$1`, [id]),
  } as never,
  manifestDocumentType: (t, f) => manifest.fields[`${t}.${f}`]?.documentType,
  isDocCapable: cap('DOC'),
  ipoDetailsReader: { findByIpoId: async (id: string) => camelRow((await q(`SELECT issue_type FROM ipo_details WHERE ipo_id=$1`, [id]))[0]) },
  receiptReader: async (ipoId: string) => {
    const m = new Map<string, Map<string, string | null>>();
    for (const r of await q(`SELECT r.document_id, r.table_name, r.row_key, r.field_name, r.value FROM document_field_receipts r JOIN documents d ON d.id=r.document_id WHERE d.extraction_status='COMPLETED' AND d.ipo_id=$1`, [ipoId])) {
      const k = String(r.document_id);
      if (!m.has(k)) m.set(k, new Map());
      m.get(k)!.set(`${r.table_name}|${r.row_key ?? ''}|${r.field_name}`, r.value ?? null);
    }
    return m;
  },
  receiptMarkReader: async (docId, t, rk, f) =>
    (await q(`SELECT source_text FROM document_field_receipts WHERE document_id=$1 AND table_name=$2 AND row_key=$3 AND field_name=$4`, [docId, t, rk, f]))[0]?.source_text ?? null,
} as never);
const sourceFetchers = {
  DOC: doc,
  NSE: buildNseFetcher({ ipoRepository: ipoRepository as never, isNseCapable: cap('NSE') }, new NseFieldFetcherState()),
  BSE: buildBseFetcher({ ipoRepository: ipoRepository as never, isBseCapable: cap('BSE') }, new BseFieldFetcherState()),
  CHITTORGARH: buildChittorgarhFetcher({ ipoRepository: ipoRepository as never, isChittorgarhCapable: cap('CHITTORGARH') } as never, new ChittorgarhFieldFetcherState()),
};

const report: unknown[] = [];
for (const ipo of picked) {
  const recorded: unknown[] = [];
  const valueOf = async () =>
    (async () => ({ ipoRow: (await q(`SELECT to_jsonb(i) - 'updated_at' AS row FROM ipos i WHERE id=$1`, [ipo.id]))[0]?.row ?? null, sources: await q(`SELECT table_name, row_key, field_name, source::text AS source, updated_by FROM field_sources WHERE ipo_id=$1 ORDER BY 1,2,3`, [ipo.id]) }))();
  const before = await valueOf();
  const store: AnswersRoundStore = {
    readIpo: async (id) => ({ status: (await q(`SELECT status::text AS s FROM ipos WHERE id=$1`, [id]))[0]?.s ?? null, answersRoundAt: null }),
    listUnanswered: async (id) => {
      const plans = await q(`SELECT table_name, row_key, field_name FROM ipo_field_plan WHERE ipo_id=$1`, [id]);
      const stored = new Set(
        (await q(`SELECT table_name, row_key, field_name FROM field_sources WHERE ipo_id=$1 AND (witnesses IS NULL OR jsonb_array_length(witnesses)=0)`, [id]))
          .map((s) => `${s.table_name}|${s.row_key ?? ''}|${s.field_name}`)
      );
      return plans
        .filter((p) => stored.has(`${p.table_name}|${p.row_key ?? ''}|${camel(p.field_name)}`))
        .map((p) => ({ tableName: p.table_name, rowKey: p.row_key ?? '', fieldName: p.field_name }));
    },
    markRoundDone: async () => true, // in memory only
  };
  const result = await runAnswersOnlyRound(
    ipo.id,
    {
      fieldPlanRepository: {} as never,
      orchestrator: {} as never, // any write attempt would throw: the round must make none
      sourceFetchers: sourceFetchers as never,
      ipoRepository: ipoRepository as never,
      trackHeldFieldWitnesses: async (input) => {
        const cur = (await q(`SELECT witnesses FROM field_sources WHERE ipo_id=$1 AND table_name=$2 AND row_key=$3 AND field_name=$4`, [input.ipoId, input.tableName, input.rowKey ?? '', input.fieldName]))[0];
        const next = cur ? input.merge(cur.witnesses) : null;
        recorded.push({ field: `${input.tableName}.${input.fieldName}`, verdict: next?.verdict ?? null, answers: (next?.witnesses as any[] | undefined)?.map((w) => `${w.source}=${w.outcome}${w.value != null ? `:${JSON.stringify(w.value)}` : ''}${w.credited ? `(credited ${w.credited})` : ''}${w.cause ? ` [${w.cause}]` : ''}`) ?? null });
        return { updated: next !== null };
      },
    } as never,
    store,
    { deadlineMs: Date.now() + 120_000, now: () => Date.now() },
    { listedAllowed: true }
  );
  const after = await valueOf();
  report.push({ slug: ipo.slug, result, publishedValuesUnchanged: JSON.stringify(before) === JSON.stringify(after), storedValues: (before as any).sources.length, recorded });
}
console.log(JSON.stringify(report, null, 1));
await pool.end();
