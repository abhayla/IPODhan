// #488 self-test: mutation-proof — drives the real check-drizzle-where-chaining.mjs
// binary against fixture files copied verbatim from the four known-defect
// files' PRE-FIX shape (registrar-repository.ts x2 copies, market-holiday-
// repository.ts, backfill-ipo-reviews.ts) so a weakened or deleted rule turns
// this test red before the gate itself can silently stop catching it. Also
// proves the FIXED shape (current working tree) is clean, and that the two
// known-safe shapes (an if/else with no base filter, and the lane-C-pending
// exemption) are never flagged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'check-drizzle-where-chaining.mjs');
const REPO_ROOT = join(__dirname, '..', '..', '..');

function makeFixtureRoot() {
  // Fixtures live in a temp dir OUTSIDE the repo so the real check never
  // picks up this test file's own source, or the repo's real (now-fixed)
  // files, as findings.
  return mkdtempSync(join(tmpdir(), 'drizzle-where-chaining-fixture-'));
}

function writeFile(root, relPath, content) {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function runCheck(root) {
  return spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
}

// --- Fixtures copied verbatim from the PRE-FIX shape of each known-defect file ---

const REGISTRAR_PRE_FIX = `
import { eq, or, ilike, asc } from 'drizzle-orm';

export class RegistrarRepository {
  async search(query, activeOnly = true) {
    const searchPattern = \`%\${query}%\`;
    const nameCondition = or(ilike(registrars.name, searchPattern), ilike(registrars.shortName, searchPattern));

    let query2 = this.db.select().from(registrars);

    if (activeOnly) {
      // Combine both active filter and name search
      query2 = query2.where(eq(registrars.active, true));
      query2 = query2.where(nameCondition);
    } else {
      query2 = query2.where(nameCondition);
    }

    return await query2.orderBy(asc(registrars.name));
  }
}
`;

const MARKET_HOLIDAY_PRE_FIX = `
import { eq, and, gte, lte, or, asc } from 'drizzle-orm';

export class MarketHolidayRepository {
  async findAll(filters) {
    let query = this.db.select().from(marketHolidays);

    if (filters?.year) {
      query = query.where(eq(marketHolidays.year, filters.year));
    }

    if (filters?.exchange && filters.exchange !== 'ALL') {
      const exchangeFilter = or(eq(marketHolidays.exchange, filters.exchange), eq(marketHolidays.exchange, 'BOTH'));
      query = query.where(exchangeFilter);
    }

    if (filters?.upcoming) {
      const today = new Date().toISOString().split('T')[0];
      query = query.where(gte(marketHolidays.date, today));
    }

    const results = await query.orderBy(asc(marketHolidays.date));
    return results;
  }
}
`;

const BACKFILL_IPO_REVIEWS_PRE_FIX = `
import { eq, or } from 'drizzle-orm';

async function main() {
  let query = db.select({ id: schema.ipos.id }).from(schema.ipos);

  if (options.status) {
    query = query.where(eq(schema.ipos.status, options.status));
  } else {
    query = query.where(
      or(
        eq(schema.ipos.status, 'OPEN'),
        eq(schema.ipos.status, 'CLOSED'),
        eq(schema.ipos.status, 'LISTED')
      )
    );
  }

  if (options.segment) {
    query = query.where(eq(schema.ipos.segment, options.segment));
  }

  const ipos = await query;
}
`;

// --- Known-SAFE shapes that must NEVER be flagged ---

const LOT_CALCULATOR_SAFE = `
export async function GET() {
  let query = db.select({ id: ipos.id }).from(ipos).$dynamic();

  // Apply search filter if provided
  if (search && search.trim() !== '') {
    query = query.where(
      or(
        ilike(ipos.companyName, \`%\${search}%\`),
        ilike(ipos.slug, \`%\${search}%\`)
      )
    );
  } else {
    // If no search, only return active IPOs (OPEN, UPCOMING, CLOSED)
    query = query.where(
      or(
        eq(ipos.status, 'OPEN'),
        eq(ipos.status, 'UPCOMING'),
        eq(ipos.status, 'CLOSED')
      )
    );
  }

  return NextResponse.json({ query });
}
`;

test('PRE-FIX fixtures: all four known-defect shapes are flagged (RED)', () => {
  const root = makeFixtureRoot();
  try {
    writeFile(root, join('packages', 'shared', 'src', 'repositories', 'registrar-repository.ts'), REGISTRAR_PRE_FIX);
    writeFile(root, join('web', 'lib', 'repositories', 'registrar-repository.ts'), REGISTRAR_PRE_FIX);
    writeFile(root, join('packages', 'shared', 'src', 'repositories', 'market-holiday-repository.ts'), MARKET_HOLIDAY_PRE_FIX);
    writeFile(root, join('scraper', 'scripts', 'backfill-ipo-reviews.ts'), BACKFILL_IPO_REVIEWS_PRE_FIX);

    const result = runCheck(root);
    assert.equal(result.status, 1, `expected exit 1, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    const out = result.stdout + result.stderr;
    assert.match(out, /registrar-repository\.ts/);
    assert.match(out, /market-holiday-repository\.ts/);
    assert.match(out, /backfill-ipo-reviews\.ts/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('FIXED shapes (current working tree) are clean (GREEN)', () => {
  const root = makeFixtureRoot();
  try {
    const files = [
      join('packages', 'shared', 'src', 'repositories', 'registrar-repository.ts'),
      join('web', 'lib', 'repositories', 'registrar-repository.ts'),
      join('packages', 'shared', 'src', 'repositories', 'market-holiday-repository.ts'),
      join('scraper', 'scripts', 'backfill-ipo-reviews.ts'),
      join('scraper', 'scripts', 'backfill-peer-companies.ts'),
      join('scraper', 'scripts', 'backfill-objectives.ts'),
      join('scraper', 'scripts', 'backfill-anchor-investors.ts'),
    ];
    for (const relPath of files) {
      const content = readFileSync(join(REPO_ROOT, relPath), 'utf8');
      writeFile(root, relPath, content);
    }

    const result = runCheck(root);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a mutually-exclusive if/else with no base filter (lot-calculator shape) is never flagged', () => {
  const root = makeFixtureRoot();
  try {
    writeFile(root, join('web', 'app', 'api', 'tools', 'lot-calculator', 'route.ts'), LOT_CALCULATOR_SAFE);
    const result = runCheck(root);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the current real repo tree is clean end-to-end (exit 0)', () => {
  const result = runCheck(REPO_ROOT);
  assert.equal(result.status, 0, `expected exit 0 on the real repo tree, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
});

test('a zero-file scan root fails closed with exit 2', () => {
  const root = makeFixtureRoot();
  try {
    // No SCAN_ROOTS subdirectory exists under this empty fixture root.
    const result = runCheck(root);
    assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
