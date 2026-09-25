#!/usr/bin/env node
// scripts/generate-field-manifest.mjs — item 3 slice S0b.
//
// WHY THIS EXISTS. `scraper/config/field-manifest.json` was 10 hand-written rows (item 2), and every
// rank change since has been a JSON diff nobody reviewed as "these fields now resolve differently"
// (OD-5 §7.6). This script is the missing generator: it reads
// `docs/design/field-source-resolution.spec.mjs` — the single authored source of truth for every
// sourced field's rank order and offering-type applicability — and produces the FULL manifest (every
// class D/T/X/W/M field, all three phase-1 IPO types) at `version: 2`. The generator is the only
// writer; CI (`scripts/ci/check-field-manifest-current.mjs`) refuses drift from a committed file this
// script did not produce.
//
//   node scripts/generate-field-manifest.mjs --write            rewrite scraper/config/field-manifest.json
//   node scripts/generate-field-manifest.mjs --check            exit 1 + resolved-plan diff if the committed file differs
//   node scripts/generate-field-manifest.mjs --diff <base-sha>  resolved-plan diff vs that sha's committed manifest
//
// CORE PROOF (S0b build, 2026-09-17): before this generator existed, RESOLVE() from the spec was run
// by hand against the 10 committed rows. 9/10 were byte-identical (rank/capability-code level).
// `financial_statements.revenue` differs: the committed row still ranks MONEYCONTROL as MAINBOARD[2],
// but S0a already retired Moneycontrol from every authored rank (MC_SERVES is the empty set) — the
// spec now correctly resolves that field to two sources, not three. This is the manifest catching up
// to a spec correction already landed on origin/main, not a spec defect; the generator emits the
// corrected two-source row and this file documents why, per the build brief's "STOP and report, don't
// force a match" instruction (see the PR body for the full diff).
//
// SOURCE-CODE MAPPING (R-155, supervisor card adjustment 1). The spec's labels are CG/IG/REG/DOC/
// ADMIN/NSE/BSE/MC; the manifest's `sourceCodeSchema` (scraper/src/config/field-manifest-schema.ts)
// uses CHITTORGARH/INVESTORGAIN_GMP/REG/DOC/ADMIN/NSE/BSE/MONEYCONTROL. `API_FALLBACK` is not yet a
// valid manifest code (S0c adds it) — a field whose ONLY resolvable source is one the CURRENT schema
// rejects is skipped with a printed line, never silently dropped from that line count.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const SPEC_PATH = path.join(REPO_ROOT, 'docs', 'design', 'field-source-resolution.spec.mjs');
const MANIFEST_PATH = path.join(REPO_ROOT, 'scraper', 'config', 'field-manifest.json');

// Manifest source codes currently accepted by scraper/src/config/field-manifest-schema.ts's
// sourceCodeSchema. Kept as a literal list (not imported — this is a .mjs script, the schema is a .ts
// module compiled separately) so a schema change is a one-line diff here, reviewed alongside it.
const VALID_MANIFEST_CODES = new Set([
  'ADMIN', 'DOC', 'DRHP', 'RHP', 'PROSPECTUS', 'CORRIGENDUM', 'PRICE_BAND_AD',
  'NSE', 'BSE', 'CHITTORGARH', 'MONEYCONTROL', 'INVESTORGAIN_GMP', 'REG',
]);

// Spec label -> manifest SourceCode (R-155).
const CODE_MAP = {
  CG: 'CHITTORGARH',
  IG: 'INVESTORGAIN_GMP',
  REG: 'REG',
  DOC: 'DOC',
  ADMIN: 'ADMIN',
  NSE: 'NSE',
  BSE: 'BSE',
  MC: 'MONEYCONTROL',
};

const TYPES = ['MAINBOARD', 'SME_BSE', 'SME_NSE'];
const SOURCED_CLASSES = new Set(['D', 'T', 'X', 'W', 'M']);

// documentType derived from the spec's `o.doc` section letter, per
// docs/reviews/wp-c-extraction-contract.md §1 ("Where each group lives"): groups A/B live in the
// price-band advertisement / RHP cover + "The Offer" / timetable sections (PRICE_BAND_AD); groups
// C/D/E/F live in RHP-only sections (financials, WACA, intermediaries, business/risk text). This is
// the "DOC-type map" the card refers to — it is read off the extraction contract, not invented.
function documentTypeForDocCode(docCode) {
  if (!docCode || docCode === '—') return undefined;
  const letter = docCode.trim()[0];
  if (letter === 'A' || letter === 'B') return 'PRICE_BAND_AD';
  if (['C', 'D', 'E', 'F'].includes(letter)) return 'RHP';
  return undefined;
}


// documentSection prose for the same 10 fields — hand-authored quotes of RHP/PBA table names that
// are not spec data either. Carried forward verbatim; NOT regenerated for the other 180 fields
// (schema marks documentSection optional for exactly this reason).
const HAND_AUTHORED_SECTION = {
  'ipos.issue_size': 'wp-c-extraction-contract.md §A5+A6 — PBA cover + "The Offer", and the table "details of the Fresh Issue and post-issue market capitalisation"',
  'ipo_details.fresh_issue': 'wp-c-extraction-contract.md §A — PBA cover + "The Offer"',
  'financial_statements.revenue': 'wp-c-extraction-contract.md §C1-C2 — "Restated Consolidated Statement of Profit and Loss" (falls back to "Summary of Financial Information")',
  'ipo_details.ofs_issue': 'wp-c-extraction-contract.md §A6 — PBA cover + "The Offer" (offer-for-sale rupee amount)',
  'ipo_details.min_investment': 'wp-c-extraction-contract.md §A13 — derived minimum retail investment amount (lot size × cap price)',
};

// §5.2 of data-sourcing-pull-model.md: `unit` is the DIRECT consequence of the schema column's
// amount class from docs/design/probes/amount-columns.mjs (OD-20) — CRORE -> crore, RUPEES_KEPT ->
// rupee, everything else (PER_SHARE/PERCENT/RATIO/MULTIPLE) -> keep. field-manifest-content.test.ts
// asserts exactly this for the 8 probed Group-C fields; this reads the SAME probe output rather than
// a hand-typed guess, so it cannot silently diverge from the test's own source of truth.
const AMOUNT_COLUMNS_PATH = path.join(REPO_ROOT, 'docs', 'design', 'probes', 'amount-columns.out.json');
let AMOUNT_CLASS_BY_KEY = null;
let AMOUNT_CURRENT_UNIT_BY_KEY = null;
function loadAmountProbe() {
  if (AMOUNT_CLASS_BY_KEY) return;
  const probe = JSON.parse(fs.readFileSync(AMOUNT_COLUMNS_PATH, 'utf8'));
  AMOUNT_CLASS_BY_KEY = new Map(probe.columns.map((c) => [`${c.table}.${c.col}`, c.cls]));
  AMOUNT_CURRENT_UNIT_BY_KEY = new Map(probe.columns.map((c) => [`${c.table}.${c.col}`, c.current_unit]));
}
function amountClassForKey(key) {
  loadAmountProbe();
  return AMOUNT_CLASS_BY_KEY.get(key);
}
function currentUnitForKey(key) {
  loadAmountProbe();
  return AMOUNT_CURRENT_UNIT_BY_KEY.get(key);
}

// F-156 / OD-67: the manifest's `unit` is what a column ACTUALLY HOLDS today, not what its
// amount CLASS (what it means) would suggest by default. The probe's `current_unit` (measured
// against normalizeCurrency call sites and the schema.ts column comments, OD-20/OD-67) is
// authoritative when present; the class is only a fallback for columns the probe classified but
// did not measure a current_unit for (i.e. every CRORE/RUPEES_KEPT column that already matches
// its class — current_unit === undefined there means "measurement agreed with the class default,
// no override was recorded").
// F-156 round 2 (Tier A review MINOR): the manifest unit for a MEASURED current_unit — pulled
// out of unitForField() so it can be unit-tested directly without needing to fake the probe file
// on disk. An unrecognised value (a typo, a new probe value nobody wired here) throws rather than
// silently falling through to the column's amount-class default — that silent fallback is exactly
// how a wrong unit tag would reach the manifest unnoticed.
export function manifestUnitFromCurrentUnit(currentUnit, key) {
  if (currentUnit === 'RUPEES') return 'rupee';
  if (currentUnit === 'CRORE') return 'crore';
  if (currentUnit === 'PER_ROW_UNIT') return 'per_row';
  throw new Error(
    `unitForField: unrecognised current_unit "${currentUnit}" for ${key} — add it to manifestUnitFromCurrentUnit() or fix the probe`
  );
}

export function unitForField(f) {
  const key = `${f.t}.${f.c}`;
  const currentUnit = currentUnitForKey(key);
  if (currentUnit !== undefined && currentUnit !== null) {
    return manifestUnitFromCurrentUnit(currentUnit, key);
  }
  const cls = amountClassForKey(key);
  if (cls === 'CRORE') return 'crore';
  if (cls === 'RUPEES_KEPT') return 'rupee';
  if (cls) return 'keep'; // PER_SHARE / PERCENT / RATIO / MULTIPLE
  // Not in the probe (a table the probe doesn't cover, e.g. subscriptions/registrars/documents):
  // no amount-shaped column, so 'keep' (unchanged) is the honest default — never a guessed rupee/crore.
  return 'keep';
}

// S3b step 1 (issue #775, docs/design/s3b-verdict-plan.md "Step 1"): the field ->
// ComparisonFamily mapping, derived from structure in three layers, exactly the way
// unitForField() above already layers its own answer.
//
//   Layer 1 — the amount-columns probe (same AMOUNT_CLASS_BY_KEY map unitForField uses):
//     CRORE / PER_SHARE / RUPEES_KEPT / SHARE_COUNT -> MONEY
//     RATIO / PERCENT / MULTIPLE                    -> RATIO
//   Layer 2 — the schema.ts column DECLARATION LINE (not a byte-window lookahead — see
//     SCHEMA_DECL_BY_KEY below for why that produced false positives):
//     date/timestamp -> DATE ; boolean -> BOOLEAN ; jsonb/.array() -> SET-or-ABSTAIN per
//     ARRAY_FAMILY_DECISIONS (layer 3) ; a *Enum(...) declaration -> IDENTIFIER
//   Layer 3 — docs/design/comparison-family-decisions.mjs, the small explicit decisions
//     file for what layers 1 and 2 leave as a human call (text/varchar IDENTITY-vs-
//     IDENTIFIER, the 11 integer columns the probe does not cover, the enum reason).
const SCHEMA_TS_PATH = path.join(REPO_ROOT, 'packages', 'shared', 'src', 'db', 'schema.ts');
const COMPARISON_DECISIONS_PATH = path.join(REPO_ROOT, 'docs', 'design', 'comparison-family-decisions.mjs');

const MONEY_AMOUNT_CLASSES = new Set(['CRORE', 'PER_SHARE', 'RUPEES_KEPT', 'SHARE_COUNT']);
const RATIO_AMOUNT_CLASSES = new Set(['RATIO', 'PERCENT', 'MULTIPLE']);

let SCHEMA_DECL_BY_KEY = null; // 'table.col' -> 'date'|'timestamp'|'boolean'|'jsonb'|'text'|'varchar'|'char'|'integer'|'numeric'|'bigint'
let SCHEMA_ENUM_BY_KEY = null; // 'table.col' -> the *Enum identifier name (e.g. 'ipoStatusEnum')

// Parses packages/shared/src/db/schema.ts by walking pgTable(...) blocks and matching each
// field DECLARATION LINE (`  fieldName: type('column_name'`) at the fields-object's own
// brace depth (depth === 1). Anchoring to the declaration line, not a byte-window lookahead,
// is load-bearing: a lookahead mislabelled `credit_of_shares_date` (a plain `date`) and
// `employee_discount` (a plain `numeric`) as arrays (docs/design/s3b-verdict-plan.md).
function parseSchemaDeclarations() {
  if (SCHEMA_DECL_BY_KEY) return;
  SCHEMA_DECL_BY_KEY = new Map();
  SCHEMA_ENUM_BY_KEY = new Map();

  const schema = fs.readFileSync(SCHEMA_TS_PATH, 'utf8');
  const lines = schema.split('\n');

  const tableStartRe = /pgTable\(\s*$/;
  const tableNameRe = /^\s*'([a-z0-9_]+)'/;
  const inlineTableRe = /pgTable\('([a-z0-9_]+)',\s*\{/;
  const declRe = /^\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*(date|timestamp|boolean|jsonb|text|varchar|char|integer|numeric|bigint)\(\s*'([a-z0-9_]+)'/;
  const enumRe = /^\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*([A-Za-z_][A-Za-z0-9_]*Enum)\(\s*'([a-z0-9_]+)'/;

  let currentTable = null;
  let awaitingTableName = false;
  let depth = 0;
  let inFieldsObject = false;

  for (const line of lines) {
    const inline = line.match(inlineTableRe);
    if (inline) {
      currentTable = inline[1];
      inFieldsObject = true;
      depth = 1;
      continue;
    }
    if (tableStartRe.test(line)) {
      awaitingTableName = true;
      continue;
    }
    if (awaitingTableName) {
      const nm = line.match(tableNameRe);
      if (nm) {
        currentTable = nm[1];
        awaitingTableName = false;
      }
      continue;
    }
    if (currentTable && !inFieldsObject) {
      if (/^\s*\{\s*$/.test(line)) {
        inFieldsObject = true;
        depth = 1;
      }
      continue;
    }
    if (inFieldsObject) {
      for (const ch of line) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      if (depth <= 0) {
        inFieldsObject = false;
        currentTable = null;
        continue;
      }
      const m = line.match(declRe);
      if (m && depth === 1) SCHEMA_DECL_BY_KEY.set(`${currentTable}.${m[2]}`, m[1]);
      const e = line.match(enumRe);
      if (e && depth === 1) SCHEMA_ENUM_BY_KEY.set(`${currentTable}.${e[2]}`, e[1]);
    }
  }
}

let COMPARISON_DECISIONS = null;
async function loadComparisonDecisions() {
  if (!COMPARISON_DECISIONS) {
    COMPARISON_DECISIONS = await import(pathToFileURL(COMPARISON_DECISIONS_PATH).href);
  }
  return COMPARISON_DECISIONS;
}

async function comparisonFamilyForField(f, decisions) {
  const key = `${f.t}.${f.c}`;

  // Layer 1: the amount-columns probe.
  const amountCls = amountClassForKey(key);
  if (MONEY_AMOUNT_CLASSES.has(amountCls)) return 'MONEY';
  if (RATIO_AMOUNT_CLASSES.has(amountCls)) return 'RATIO';

  // Layer 2: the schema.ts column declaration.
  parseSchemaDeclarations();
  const declType = SCHEMA_DECL_BY_KEY.get(key);
  const enumType = SCHEMA_ENUM_BY_KEY.get(key);

  if (declType === 'date' || declType === 'timestamp') return 'DATE';
  if (declType === 'boolean') return 'BOOLEAN';
  if (declType === 'jsonb') {
    const arr = decisions.ARRAY_FAMILY_DECISIONS[key];
    if (!arr) throw new Error(`comparisonFamilyForField: jsonb column ${key} has no ARRAY_FAMILY_DECISIONS entry`);
    return arr.family;
  }

  // Layer 3: the explicit decisions file, for what layers 1/2 leave as a human call.
  if (enumType) return decisions.ENUM_FAMILY_DECISION.family;

  const arrDecision = decisions.ARRAY_FAMILY_DECISIONS[key];
  if (arrDecision) return arrDecision.family; // text[]/.array() columns — declType is 'text', caught here first

  const numDecision = decisions.NUMERIC_FAMILY_DECISIONS[key];
  if (numDecision) return numDecision.family;

  const textDecision = decisions.TEXT_FAMILY_DECISIONS[key];
  if (textDecision) return textDecision.family;

  throw new Error(`comparisonFamilyForField: no family resolves for ${key} (declType=${declType ?? 'none'}) — add a Layer 3 decision in docs/design/comparison-family-decisions.mjs`);
}

function capabilityReasonFallback(f, sourceLabel) {
  // Card adjustment 2: for the 180 non-hand-authored rows, source the reason text from the spec's
  // own capability facts (o.note / o.doc / o.only), never invented. If none apply, the honest,
  // explicit fallback line — never a fabricated measurement.
  if (f.o.note) return f.o.note;
  if (f.o.only && sourceLabel === f.r[0]) return f.o.only;
  if (f.o.doc && f.o.doc !== '—') return `sourced per docs/reviews/wp-c-extraction-contract.md §${f.o.doc}`;
  return 'ranked in the approved spec (docs/design/field-source-resolution.spec.mjs); capability not separately measured';
}

function incapableReason(f, sourceLabel) {
  if (sourceLabel === 'MC') return 'OD-3 retires Moneycontrol as a scheduled source';
  if (sourceLabel === 'CG' && f.t === 'financial_data' && f.c === 'pe_ratio') {
    return 'observed 2026-09-08: CG prints a PE Ratio column only for OTHER recently listed IPOs in a comparison table, never this IPO own';
  }
  return `${sourceLabel} does not serve this field per the spec's capability pool (docs/design/field-source-resolution.spec.mjs)`;
}

async function loadSpec() {
  return import(pathToFileURL(SPEC_PATH).href);
}

// pool(f) equivalent, re-derived here ONLY to know which codes are "in the capability universe" for
// a field so we can emit a capable:false entry for a code that could apply but was excluded (CG_CANNOT,
// MC retirement) — the generator does not re-implement resolve()/pool()'s ranking logic; RESOLVE() is
// the sole source of rank order and na handling.
function candidatePoolCodes(f) {
  const codes = new Set(f.r.filter((x) => x !== '—'));
  if (['ipos', 'ipo_details', 'financial_data', 'peer_companies', 'subscriptions', 'listing_performance',
       'registrars', 'ipo_intermediaries', 'gmp_records', 'financial_statements', 'ipo_valuation', 'promoters']
      .includes(f.t) && !f.o.only) {
    codes.add('CG');
  }
  return codes;
}

export async function generateManifest({ F, RESOLVE }) {
  const fields = {};
  const skipped = [];
  let fieldCount = 0;
  const comparisonDecisions = await loadComparisonDecisions();

  for (const f of F) {
    if (!SOURCED_CLASSES.has(f.cls)) continue; // C/I: never sourced, no manifest row (item-02 rule)
    const key = `${f.t}.${f.c}`;
    // OD-100 (#1022): a field whose opts declare `jobOwned` has its own scheduled job that keeps
    // it fresh (e.g. gmp_records.gmp <- the GMP job); the field-plan walk never asks for it, so it
    // gets no manifest row, generically — never a per-table `if (f.t === 'gmp_records')` special case.
    if (f.o.jobOwned) {
      skipped.push(`skipped ${key}: job-owned (${f.o.jobOwned}) — the walk never asks for it (OD-100)`);
      continue;
    }

    const rankByType = {};
    let hasAnyRealRank = false;
    let unresolvableCode = null;
    for (const type of TYPES) {
      const resolved = RESOLVE(f, type).filter((s) => s !== '—' && s !== 'N/A');
      const mapped = [];
      for (const code of resolved) {
        const manifestCode = CODE_MAP[code] ?? code;
        if (!VALID_MANIFEST_CODES.has(manifestCode)) {
          unresolvableCode = manifestCode;
          break;
        }
        mapped.push(manifestCode);
      }
      if (unresolvableCode) break;
      rankByType[type] = mapped;
      if (mapped.length > 0) hasAnyRealRank = true;
    }

    if (unresolvableCode) {
      skipped.push(`skipped ${key}: code ${unresolvableCode} not in sourceCodeSchema (S0c)`);
      continue;
    }
    if (!hasAnyRealRank) {
      // Card's "known gaps": MAINBOARD rank list empty after N/A filtering on every type — print, no row.
      skipped.push(`skipped ${key}: resolves to no real source on any of ${TYPES.join('/')} (N/A or exhausted pool)`);
      continue;
    }

    // capability: every candidate pool code the field could use, keyed by its MANIFEST code.
    const capability = {};
    const poolCodes = candidatePoolCodes(f);
    const rankedManifestCodes = new Set(Object.values(rankByType).flat());

    const hand = f.o.capability; // moved to the spec's own rows (#739) — the generator reads only the spec
    if (hand) {
      Object.assign(capability, hand);
    } else {
      for (const code of poolCodes) {
        const manifestCode = CODE_MAP[code] ?? code;
        if (!VALID_MANIFEST_CODES.has(manifestCode)) continue;
        const isRanked = rankedManifestCodes.has(manifestCode);
        capability[manifestCode] = isRanked
          ? { capable: true, reason: capabilityReasonFallback(f, code) }
          : { capable: false, reason: incapableReason(f, code) };
      }
      // Every ranked code MUST have a capable:true entry (loader cross-check) even if it fell
      // outside candidatePoolCodes's approximation (e.g. DOC, which is not in WEB_OK's auto-append).
      for (const manifestCode of rankedManifestCodes) {
        if (!capability[manifestCode]) {
          capability[manifestCode] = { capable: true, reason: capabilityReasonFallback(f, manifestCode) };
        }
      }
    }

    const entry = { class: f.cls };
    const docType = documentTypeForDocCode(f.o.doc);
    if (docType) entry.documentType = docType;
    const section = HAND_AUTHORED_SECTION[key];
    if (section) entry.documentSection = section;
    entry.rank = rankByType;
    entry.capability = capability;
    if (f.o.na && f.o.na.length) entry.na = f.o.na;
    else entry.na = [];
    entry.unit = unitForField(f);
    entry.comparisonFamily = await comparisonFamilyForField(f, comparisonDecisions);

    fields[key] = entry;
    fieldCount++;
  }

  return {
    manifest: {
      version: 2,
      generatedFrom: 'docs/design/field-source-resolution.spec.mjs',
      fields,
    },
    skipped,
    fieldCount,
  };
}

export function resolvedPlanDiff(a, b) {
  const diffs = [];
  const keys = new Set([...Object.keys(a.fields || {}), ...Object.keys(b.fields || {})]);
  for (const key of keys) {
    const fa = a.fields?.[key];
    const fb = b.fields?.[key];
    if (!fa && fb) { diffs.push({ field: key, type: 'NEW', from: [], to: fb.rank?.MAINBOARD || [] }); continue; }
    if (fa && !fb) { diffs.push({ field: key, type: 'REMOVED', from: fa.rank?.MAINBOARD || [], to: [] }); continue; }
    for (const t of TYPES) {
      const ra = fa.rank?.[t] || [];
      const rb = fb.rank?.[t] || [];
      if (JSON.stringify(ra) !== JSON.stringify(rb)) {
        diffs.push({ field: key, type: t, from: ra, to: rb });
      }
    }
  }
  return diffs;
}

function stableStringify(manifest) {
  return JSON.stringify(manifest, null, 2) + '\n';
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const check = args.includes('--check');
  const diffIdx = args.indexOf('--diff');
  const baseSha = diffIdx >= 0 ? args[diffIdx + 1] : null;

  const spec = await loadSpec();
  const { manifest, skipped, fieldCount } = await generateManifest(spec);

  for (const line of skipped) console.log(line);
  console.log(`generated: version=${manifest.version} fields=${fieldCount}`);

  if (baseSha) {
    const baseContent = execFileSync('git', ['show', `${baseSha}:scraper/config/field-manifest.json`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    const baseManifest = JSON.parse(baseContent);
    const diffs = resolvedPlanDiff(baseManifest, manifest);
    console.log(`${diffs.length} field(s) resolve differently vs ${baseSha}:`);
    for (const d of diffs) {
      console.log(`  ${d.field} ${d.type}: [${d.from.join(',')}] -> [${d.to.join(',')}]`);
    }
    return;
  }

  if (write) {
    fs.writeFileSync(MANIFEST_PATH, stableStringify(manifest));
    console.log(`written: ${MANIFEST_PATH}`);
    return;
  }

  // default / --check: compare against the committed file. Comparison is line-ending-normalized
  // (CRLF -> LF) so a Windows checkout with core.autocrlf=true (the committed file is LF in git's
  // index, but checks out CRLF on those machines) does not report drift that CI never sees; a
  // genuine content difference still fails, since resolvedPlanDiff() below operates on the parsed
  // JSON, not on the raw bytes.
  const committedRaw = fs.existsSync(MANIFEST_PATH) ? fs.readFileSync(MANIFEST_PATH, 'utf8') : null;
  const committed = committedRaw ? JSON.parse(committedRaw) : null;
  const generatedRaw = stableStringify(manifest);
  const normalizeEol = (s) => (s == null ? s : s.split('\r\n').join('\n'));

  if (normalizeEol(committedRaw) === normalizeEol(generatedRaw)) {
    console.log('field-manifest.json matches the generator exactly.');
    process.exit(0);
  }

  const diffs = committed ? resolvedPlanDiff(committed, manifest) : [];
  console.log(`DRIFT — committed file differs from the generator.`);
  if (diffs.length) {
    console.log(`${diffs.length} field(s) resolve differently:`);
    for (const d of diffs) {
      console.log(`  ${d.field} ${d.type}: [${d.from.join(',')}] -> [${d.to.join(',')}]`);
    }
  } else {
    console.log('(byte-level formatting difference only — no resolved-plan diff)');
  }
  console.log('  fix: node scripts/generate-field-manifest.mjs --write');
  process.exit(check ? 1 : 0);
}

const IS_ENTRY = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_ENTRY) {
  main().catch((err) => {
    console.error('generate-field-manifest: the generator itself failed —', err.message);
    process.exit(2);
  });
}
