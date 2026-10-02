#!/usr/bin/env node
// Per-source field table for one IPO (read-only): Field | 1st | 2nd | 3rd source | Value on page.
// The same read the admin edit view uses (spec §9.3): per-source answers from field_sources.witnesses when a
// value is stored, else ipo_field_plan.answers (OD-137); ranks from Appendix A via scraper/config/field-manifest.json.
// Usage: node scripts/ops/field-source-table.mjs <slug> [--db ipodhan_staging] [--out <file.md>]
// Needs the DB tunnel: bash scripts/ops/db-tunnel.sh start
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReadOnlyPool } from '../../docs/design/probes/_lib.mjs';
import { attention, buildWitnesses, camelCase, renderRow } from './lib/field-source-table-format.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(HERE, '../../scraper/config/field-manifest.json'), 'utf8')).fields;
const IDENT = /^[a-z][a-z0-9_]*$/;
const LIST_TABLES = new Set([
  'peer_companies', 'anchor_investors', 'promoters', 'ipo_intermediaries', 'ipo_risk_factors',
  'brlm_track_record', 'promoter_acquisition_ranges', 'financial_statements', 'documents',
]);

function parseArgs(argv) {
  const a = { slug: null, db: 'ipodhan_staging', out: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--db') a.db = argv[++i];
    else if (argv[i] === '--out') a.out = argv[++i];
    else if (!argv[i].startsWith('--') && !a.slug) a.slug = argv[i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!a.slug) throw new Error('usage: field-source-table.mjs <slug> [--db ipodhan_staging] [--out <file.md>]');
  return a;
}

// Appendix A type column: the plan generator's own rule (resolveIpoTypeKey).
function typeKeyOf(ipo) {
  if (ipo.segment !== 'SME') return 'MAINBOARD';
  return (ipo.listing_exchanges ?? []).includes('NSE') ? 'SME_NSE' : 'SME_BSE';
}

const ist = (d) => (d ? `${new Date(d.getTime() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 16)} IST` : 'never');

async function main() {
  const args = parseArgs(process.argv);
  const pool = await openReadOnlyPool(args.db);
  const q = async (sql, p = []) => (await pool.query(sql, p)).rows;
  try {
    const [ipo] = await q('select * from ipos where slug = $1', [args.slug]);
    if (!ipo) throw new Error(`no IPO with slug ${args.slug} on ${args.db}`);
    const typeKey = typeKeyOf(ipo);

    const cols = new Map();
    for (const r of await q("select table_name, column_name from information_schema.columns where table_schema = 'public'")) {
      if (!cols.has(r.table_name)) cols.set(r.table_name, new Set());
      cols.get(r.table_name).add(r.column_name);
    }
    const fsRows = await q(
      'select table_name, field_name, row_key, source::text as source, witnesses from field_sources where ipo_id = $1 order by row_key',
      [ipo.id]);
    const planRows = await q(
      'select table_name, field_name, row_key, answers from ipo_field_plan where ipo_id = $1 order by row_key', [ipo.id]);
    const docs = await q(
      `select d.type::text as type, d.extraction_status, f.extractor_version, f.extracted_at, f.state::text as fetch_state
         from documents d left join document_fetch_state f on f.document_id = d.id
        where d.ipo_id = $1 order by d.type::text, d.created_at`, [ipo.id]);
    const unfetched = await q(
      `select doc_type::text as type, state::text as state, attempts from document_fetch_state
        where ipo_id = $1 and document_id is null order by doc_type::text`, [ipo.id]);

    const rowsFor = (list, table, sqlField, camel) =>
      list.filter((r) => r.table_name === table && (r.field_name === sqlField || r.field_name === camel));

    const main = [];
    const other = [];
    const attn = [];
    for (const [key, entry] of Object.entries(MANIFEST).sort(([a], [b]) => a.localeCompare(b))) {
      const [table, col] = key.split('.');
      if (!IDENT.test(table) || !IDENT.test(col)) continue;
      const ranks = entry.rank?.[typeKey];
      if (!Array.isArray(ranks) || ranks.length === 0) continue;
      if (ipo.offering_type && (entry.na ?? []).includes(ipo.offering_type)) continue;
      const camel = camelCase(col);

      const fsList = rowsFor(fsRows, table, col, camel);
      const planList = rowsFor(planRows, table, col, camel);
      const fs0 = fsList.find((r) => r.row_key === '') ?? fsList.find((r) => r.witnesses) ?? fsList[0] ?? null;
      const plan = planList.find((r) => r.row_key === '') ?? planList.find((r) => r.answers) ?? planList[0] ?? null;

      let page = { value: null, source: null, rowCount: null };
      const tc = cols.get(table);
      if (tc && tc.has(col)) {
        if (table === 'ipos') {
          page = { value: ipo[col], source: fs0?.source ?? null, rowCount: null };
        } else if (table === 'registrars') {
          const [r] = ipo.registrar_id ? await q(`select "${col}" as v from registrars where id = $1`, [ipo.registrar_id]) : [];
          page = { value: r?.v ?? null, source: fs0?.source ?? null, rowCount: null };
        } else if (tc.has('ipo_id')) {
          const r = await q(
            `select count(*) over() as n, "${col}" as v from "${table}" where ipo_id = $1 order by ("${col}" is null), 1 limit 1`,
            [ipo.id]);
          page = {
            value: r[0]?.v ?? null,
            source: fs0?.source ?? null,
            rowCount: LIST_TABLES.has(table) ? (r.length ? Number(r[0].n) : 0) : null,
          };
        }
      }

      const witnesses = buildWitnesses({
        ranks, witnesses: fs0?.witnesses, planAnswers: plan?.answers, fsSource: fs0?.source ?? null, currentValue: page.value,
      });
      (table === 'ipos' ? main : other).push(renderRow(key, witnesses, page));
      const why = attention(page, ranks);
      if (why) attn.push(`- ${key}: ${why}`);
    }

    const head = ['| Field | 1st source | 2nd source | 3rd source | Value on page |', '|---|---|---|---|---|'];
    const out = [
      `# ${ipo.company_name} — per-source field table (read-only, ${args.db})`,
      '',
      `Slug: ${ipo.slug}. Status: ${ipo.status}. Type: ${typeKey}${ipo.offering_type ? `, ${ipo.offering_type}` : ''}. Listed fields: ${main.length + other.length}.`,
      '',
      '## Documents',
      '| Type | Fetch state | Extraction status | Extractor version | Extracted at |',
      '|---|---|---|---|---|',
      ...docs.map((d) => `| ${d.type} | ${d.fetch_state ?? '—'} | ${d.extraction_status ?? '—'} | ${d.extractor_version ?? '—'} | ${ist(d.extracted_at)} |`),
      ...unfetched.map((d) => `| ${d.type} | ${d.state} | no document stored (${d.attempts} attempts) | — | never |`),
      '',
      '## Main IPO fields', ...head, ...main, '',
      '## Other tables', ...head, ...other, '',
      '## Fields still empty or not from rank 1', ...(attn.length ? attn : ['- none']), '',
    ].join('\n');
    if (args.out) fs.writeFileSync(args.out, out, 'utf8');
    else process.stdout.write(out);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
