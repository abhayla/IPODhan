#!/usr/bin/env node
// Item 30: the canonical IPO type list — segment x offering_type x issue_type,
// read from the database, not typed into a document by hand. See
// docs/design/build-cards/item-30-ipo-type-table.md and
// docs/design/spec-deviation-guideline.md §3.2 (the two-live-samples bar this
// table exists to make a lookup instead of an ad-hoc query).
//
// Writes two generated artefacts:
//   docs/design/ipo-type-population.md    human-readable table
//   docs/design/ipo-type-population.json  machine-readable aggregate (for
//                                          items 34/35 to read)
//
// Usage (tunnel to the DB host must be open on localhost:15432, recipe
// docs/ops/prod-ops-recipes.md section 1):
//   node scripts/ops/generate-ipo-type-population.mjs           regenerate both artefacts
//   node scripts/ops/generate-ipo-type-population.mjs --check    exit 1 if the
//                                                                 committed files drift
//
// Reads the app-role password from D:/Abhay/GLOBAL.env (IPODHAN_APP_DB_PASSWORD)
// unless DATABASE_URL is already set in the environment.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { Pool } = require('pg'); // hoisted workspace dependency (root node_modules)

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const OUT_MD = join(REPO_ROOT, 'docs/design/ipo-type-population.md');
const OUT_JSON = join(REPO_ROOT, 'docs/design/ipo-type-population.json');

// live_or_recent >= this many samples => sample_sufficient. Named constant per
// the card's Interfaces section — never a literal at the comparison site.
// Renamed from `proven_scrapable` (item 30 follow-up, 2026-09-19): the old
// name read as permission to scrape once the count cleared 2, which is not
// what the owner's boundary says. See SCRAPER_OWNED_TYPES below.
const SAMPLE_SUFFICIENT_THRESHOLD = 2;

// The owner's scraper/admin boundary (docs/design/spec-deviation-guideline.md
// §5, owner decision 2026-09-19) — NOT a function of sample count. A type is
// scraper-owned only when its segment/offering_type pair is in this list,
// regardless of how many live rows it has (FPO carries zero live rows today
// and is still scraper-owned "by the owner's word, not by sample count").
// OFS is frozen per OD-53 and is never owned, no matter its segment. A row
// with an UNCLASSIFIED segment (no ipos.segment value) is never owned either
// — the boundary is drawn on the exchange-listed segment, not on an absence.
export const SCRAPER_OWNED_TYPES = [
  { segment: 'MAINBOARD', offering_type: 'IPO' },
  { segment: 'MAINBOARD', offering_type: 'FPO' },
  { segment: 'MAINBOARD', offering_type: 'RIGHTS' },
  { segment: 'SME', offering_type: 'IPO' },
  { segment: 'SME', offering_type: 'FPO' },
  { segment: 'SME', offering_type: 'RIGHTS' },
];

function isScraperOwned(segment, offeringType) {
  if (segment === 'UNCLASSIFIED' || offeringType === 'UNCLASSIFIED') return false;
  if (offeringType === 'OFS') return false; // frozen per OD-53, regardless of segment
  return SCRAPER_OWNED_TYPES.some((t) => t.segment === segment && t.offering_type === offeringType);
}

// Same 180-day window OD-35 already uses for same-offering comparisons; cited
// here rather than reinvented (card's Interfaces section).
const RECENT_LISTING_WINDOW_DAYS = 180;

const CHECK = process.argv.includes('--check');

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const globalEnvPath = 'D:/Abhay/GLOBAL.env';
  if (!existsSync(globalEnvPath)) {
    throw new Error(
      `DATABASE_URL not set and ${globalEnvPath} not found — cannot resolve the staging app-role password.`
    );
  }
  const env = Object.fromEntries(
    readFileSync(globalEnvPath, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')])
  );
  const pw = env.IPODHAN_APP_DB_PASSWORD;
  if (!pw) {
    throw new Error('IPODHAN_APP_DB_PASSWORD missing in D:/Abhay/GLOBAL.env');
  }
  return `postgresql://ipodhan_app:${pw}@localhost:15432/ipodhan_staging`;
}

// key is UNCLASSIFIED when segment is NULL (RIGHTS/NCD/INVITS/REITS have no
// segment) so a null segment lands in a named bucket instead of being
// dropped — 40 such rows were measured on staging 2026-09-19 (card's Tests
// section), and a silent drop would make the totals lie.
function buildKey(segment, offeringType, issueType) {
  const seg = segment ?? 'UNCLASSIFIED';
  const off = offeringType ?? 'UNCLASSIFIED';
  const iss = issueType ?? 'UNCLASSIFIED';
  return `${seg}/${off}/${iss}`;
}

export function rowsToTypes(rows) {
  return rows
    .map((r) => {
      const total = Number(r.total);
      const liveOrRecent = Number(r.live_or_recent);
      const segment = r.segment ?? 'UNCLASSIFIED';
      const offeringType = r.offering_type ?? 'UNCLASSIFIED';
      return {
        segment,
        offering_type: offeringType,
        issue_type: r.issue_type ?? 'UNCLASSIFIED',
        key: buildKey(r.segment, r.offering_type, r.issue_type),
        total,
        live_or_recent: liveOrRecent,
        sample_sufficient: liveOrRecent >= SAMPLE_SUFFICIENT_THRESHOLD,
        scraper_owned: isScraperOwned(segment, offeringType),
      };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

async function queryTypePopulation(pool) {
  // ipos.issue_type does not exist (class-1 card defect, corrected in the same
  // PR — see docs/design/build-cards/item-30-ipo-type-table.md's Schema
  // section). issue_type lives on ipo_details, 1:1 via ipo_details.ipo_id.
  const { rows } = await pool.query(`
    SELECT
      i.segment,
      i.offering_type,
      d.issue_type,
      COUNT(*) AS total,
      COUNT(*) FILTER (
        WHERE i.status IN ('UPCOMING', 'OPEN', 'CLOSED')
           OR (i.status = 'LISTED' AND i.listing_date >= CURRENT_DATE - INTERVAL '${RECENT_LISTING_WINDOW_DAYS} days')
      ) AS live_or_recent
    FROM ipos i
    LEFT JOIN ipo_details d ON d.ipo_id = i.id
    GROUP BY i.segment, i.offering_type, d.issue_type
    ORDER BY i.segment NULLS LAST, i.offering_type NULLS LAST, d.issue_type NULLS LAST
  `);
  return rowsToTypes(rows);
}

function renderMarkdown(types, generatedAt, source) {
  const header = [
    '<!-- GENERATED FILE — do not hand-edit. Regenerate with:',
    '     node scripts/ops/generate-ipo-type-population.mjs',
    '     Verify with --check. See docs/design/build-cards/item-30-ipo-type-table.md -->',
    '',
    '# IPO type population — generated with live counts',
    '',
    `Generated: ${generatedAt}`,
    `Source: ${source}`,
    '',
    '`scraper_owned` is the owner\'s boundary (guideline §5); `sample_sufficient` is the two-per-type',
    'evidence threshold (§3). A type is scrapable only when BOTH are true.',
    '',
    `\`sample_sufficient\` is \`live_or_recent >= ${SAMPLE_SUFFICIENT_THRESHOLD}\` and nothing else — the two-live-samples`,
    'bar from docs/design/spec-deviation-guideline.md §3.2. `live_or_recent` counts rows whose status',
    `is UPCOMING, OPEN or CLOSED, plus LISTED rows whose listing date is within ${RECENT_LISTING_WINDOW_DAYS} days —`,
    'the same window OD-35 already uses.',
    '',
    '| segment | offering_type | issue_type | total | live_or_recent | sample_sufficient | scraper_owned |',
    '|---|---|---|---|---|---|---|',
  ];
  const rows = types.map(
    (t) =>
      `| ${t.segment} | ${t.offering_type} | ${t.issue_type} | ${t.total} | ${t.live_or_recent} | ${t.sample_sufficient} | ${t.scraper_owned} |`
  );
  return [...header, ...rows, ''].join('\n');
}

function renderJson(types, generatedAt, source) {
  return JSON.stringify({ generatedAt, source, types }, null, 2) + '\n';
}

async function main() {
  const databaseUrl = resolveDatabaseUrl();
  const pool = new Pool({ connectionString: databaseUrl, options: '-c timezone=UTC' });
  let types;
  try {
    const { rows: [{ db }] } = await pool.query('select current_database() db');
    if (db !== 'ipodhan_staging') {
      throw new Error(`refusing: connected to "${db}", expected "ipodhan_staging" (this generator reads staging only)`);
    }
    types = await queryTypePopulation(pool);
  } finally {
    await pool.end();
  }

  const source = 'ipodhan_staging via localhost:15432';
  // --check compares CONTENT only (types array), not the timestamp — a
  // re-run seconds later must not report drift on generatedAt alone.
  const newJson = renderJson(types, new Date().toISOString(), source);
  const newMd = renderMarkdown(types, new Date().toISOString(), source);

  if (CHECK) {
    if (!existsSync(OUT_JSON) || !existsSync(OUT_MD)) {
      console.error('FAIL: generated files missing — run without --check first.');
      process.exit(1);
    }
    const committedTypes = JSON.parse(readFileSync(OUT_JSON, 'utf8')).types;
    const committedTypesStr = JSON.stringify(committedTypes);
    const freshTypesStr = JSON.stringify(types);
    if (committedTypesStr !== freshTypesStr) {
      console.error('FAIL: docs/design/ipo-type-population.json has drifted from the live staging data.');
      console.error('Run: node scripts/ops/generate-ipo-type-population.mjs');
      process.exit(1);
    }
    // The markdown table body (everything except the "Generated:" line) must
    // also match, since that line legitimately changes every run.
    const stripGeneratedLine = (s) => s.replace(/^Generated: .*$/m, 'Generated: <redacted>');
    if (stripGeneratedLine(readFileSync(OUT_MD, 'utf8')) !== stripGeneratedLine(newMd)) {
      console.error('FAIL: docs/design/ipo-type-population.md has drifted from the live staging data.');
      console.error('Run: node scripts/ops/generate-ipo-type-population.mjs');
      process.exit(1);
    }
    console.log(`OK: ${types.length} types match the committed table (--check).`);
    process.exit(0);
  }

  writeFileSync(OUT_JSON, newJson);
  writeFileSync(OUT_MD, newMd);
  console.log(`Wrote ${OUT_JSON} and ${OUT_MD} (${types.length} types).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
