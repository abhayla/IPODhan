import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq, and } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import {
  IPORepository,
  resolveIpoRow,
  IdentityHeldForReviewError,
  type SourceKeyRef,
} from '@ipodhan/shared';
import { createIpoByAdmin, type AdminIdentifierKind } from '@ipodhan/shared/services/admin-ipo-create';
import { writeAdminFieldValue, readAdminFieldVersion } from '@ipodhan/shared/services/admin-field-write';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';

/**
 * Spec §9.2 item 15 (OD-111), OD-89, OD-85, OD-34, OD-68 — proven on the REAL `createIpoByAdmin`,
 * `resolveIpoRow` and `IPORepository.create` against Postgres (ipodhan_test).
 *
 * The core: an admin creates a row by hand with a name, an offering type and ONE identifier that
 * binding uses; a scraper record carrying that identifier later BINDS to that row (same id, no second
 * row); a record carrying only the same name is HELD (audit row), never bound and never created.
 * Parameterised over every identifier kind OD-89 allows.
 *
 * To run (from scraper/):
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts tests/integration/admin-ipo-create-od111.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const PREFIX = 'OD111 Probe';
const ACTOR = { name: 'od111.test', adminId: 'od111-test-admin' };

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;
let repo: IPORepository | null = null;

const noRedis = {
  get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0,
  keys: async () => [], scan: async () => ['0', []],
} as never;

async function probeIds(): Promise<string[]> {
  const rows = await db!.select({ id: schema.ipos.id }).from(schema.ipos)
    .where(sql`${schema.ipos.companyName} LIKE ${PREFIX + '%'}`);
  return rows.map((r) => r.id);
}

async function cleanup() {
  const ids = await probeIds();
  await db!.execute(sql`DELETE FROM audit_logs WHERE admin_user = ${ACTOR.name} OR (action_type = 'IDENTITY_HELD_FOR_REVIEW' AND new_value LIKE 'od111-probe%')`);
  if (ids.length === 0) return;
  await db!.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, ids));
  await db!.delete(schema.ipoSourceKeys).where(inArray(schema.ipoSourceKeys.ipoId, ids));
  await db!.delete(schema.ipoIdentifierAliases).where(inArray(schema.ipoIdentifierAliases.ipoId, ids));
  await db!.delete(schema.fieldProtectionMetadata).where(inArray(schema.fieldProtectionMetadata.ipoId, ids));
  await db!.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, ids));
  await db!.delete(schema.ipoSlugRedirects).where(inArray(schema.ipoSlugRedirects.ipoId, ids));
  await db!.delete(schema.ipos).where(inArray(schema.ipos.id, ids));
}

interface ScrapedRecord {
  companyName: string;
  segment: 'MAINBOARD' | 'SME';
  openDate: string;
  priceRangeMin: number;
  symbol?: string | null;
  cin?: string | null;
  keys?: SourceKeyRef[];
}

/** What the live path does (BaseScraperOrchestrator step 2 + upsertIPO): resolve once, create only when nothing bound. */
async function ingest(rec: ScrapedRecord): Promise<{ outcome: 'bound' | 'created' | 'held'; id?: string }> {
  let bound;
  try {
    bound = await resolveIpoRow(repo!, {
      companyName: rec.companyName,
      normalizedName: normalizeCompanyNameForMatching(rec.companyName),
      slug: generateIPOSlug(rec.companyName),
      symbol: rec.symbol ?? null,
      cin: rec.cin ?? null,
      openDate: rec.openDate,
      priceRangeMin: rec.priceRangeMin,
      segment: rec.segment,
      sourceKeys: rec.keys ?? [],
    });
  } catch (e) {
    if (e instanceof IdentityHeldForReviewError) return { outcome: 'held' };
    throw e;
  }
  if (bound) return { outcome: 'bound', id: bound.id };
  try {
    const created = await repo!.create({
      companyName: rec.companyName,
      slug: generateIPOSlug(rec.companyName),
      offeringType: 'IPO',
      segment: rec.segment,
      status: 'UPCOMING',
      openDate: rec.openDate,
      priceRangeMin: rec.priceRangeMin,
      symbol: rec.symbol ?? null,
      cin: rec.cin ?? null,
    } as never, { sourceKeys: rec.keys ?? [], boundBy: 'od111.test' });
    return { outcome: 'created', id: created.id };
  } catch (e) {
    if (e instanceof IdentityHeldForReviewError) return { outcome: 'held' };
    throw e;
  }
}

async function rowsNamed(name: string) {
  return db!.select({ id: schema.ipos.id }).from(schema.ipos).where(eq(schema.ipos.companyName, name));
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
  db = drizzle(pool, { schema });
  repo = new IPORepository(db as never, noRedis);
});

beforeEach(async () => {
  if (db) await cleanup();
});

afterAll(async () => {
  if (db) await cleanup();
  await pool?.end();
});

/** One case per identifier kind OD-89 allows: what the admin types, and the scraper record that carries it. */
const KINDS: { kind: AdminIdentifierKind; typed: string; name: string; record: (name: string) => ScrapedRecord }[] = [
  {
    kind: 'CIN', typed: 'u31909dl2005plc139412', name: `${PREFIX} Cin Ltd`,
    record: (n) => ({ companyName: n, segment: 'MAINBOARD', openDate: '2026-10-20', priceRangeMin: 94, cin: 'U31909DL2005PLC139412' }),
  },
  {
    kind: 'NSE_SYMBOL', typed: ' od111nse ', name: `${PREFIX} Nse Symbol Ltd`,
    record: (n) => ({ companyName: n, segment: 'MAINBOARD', openDate: '2026-10-20', priceRangeMin: 94, symbol: 'OD111NSE' }),
  },
  {
    kind: 'BSE_SYMBOL', typed: 'OD111BSE', name: `${PREFIX} Bse Symbol Ltd`,
    record: (n) => ({ companyName: n, segment: 'SME', openDate: '2026-10-20', priceRangeMin: 94, symbol: 'OD111BSE' }),
  },
  {
    kind: 'BSE_IPO_NO', typed: '97111', name: `${PREFIX} Bse Ipo No Ltd`,
    record: (n) => ({ companyName: n, segment: 'MAINBOARD', openDate: '2026-10-20', priceRangeMin: 94, keys: [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '97111' }] }),
  },
  {
    kind: 'NSE_ISSUE', typed: 'od111iss|eq', name: `${PREFIX} Nse Issue Ltd`,
    record: (n) => ({ companyName: n, segment: 'MAINBOARD', openDate: '2026-10-20', priceRangeMin: 94, keys: [{ source: 'NSE', keyType: 'NSE_ISSUE', keyValue: 'OD111ISS|EQ' }] }),
  },
  {
    kind: 'CG_PAGE_ID', typed: 'https://www.chittorgarh.com/ipo/od111-probe-cg-ltd-ipo/97112/', name: `${PREFIX} Cg Page Ltd`,
    record: (n) => ({ companyName: n, segment: 'SME', openDate: '2026-10-20', priceRangeMin: 94, keys: [{ source: 'CHITTORGARH', keyType: 'CG_PAGE_ID', keyValue: '97112' }] }),
  },
];

describe.skipIf(!DATABASE_URL)('OD-111 admin-created row: the scraper binds by identifier, holds a name-only match (ipodhan_test)', () => {
  for (const k of KINDS) {
    it(`${k.kind}: the scraper record carrying it binds to the admin row (same id, one row)`, async () => {
      const segment = k.record(k.name).segment;
      const made = await createIpoByAdmin(db as never, {
        companyName: k.name, offeringType: 'IPO', segment,
        identifiers: [{ kind: k.kind, value: k.typed }], actor: ACTOR,
      });
      expect(made.kind).toBe('CREATED');
      if (made.kind !== 'CREATED') return;

      // A scraper record under a DIFFERENT spelling of the name still lands in the admin row by identifier.
      const res = await ingest(k.record(`${k.name.replace(' Ltd', '')} Limited`));
      expect(res).toEqual({ outcome: 'bound', id: made.ipoId });
      expect((await rowsNamed(k.name)).length).toBe(1);
      expect((await rowsNamed(`${k.name.replace(' Ltd', '')} Limited`)).length).toBe(0);
    });
  }

  it('a record with only the same name (no identifier) is HELD with an audit row, never bound, never created', async () => {
    const name = `${PREFIX} Name Only Ltd`;
    const made = await createIpoByAdmin(db as never, {
      companyName: name, offeringType: 'IPO', segment: 'MAINBOARD',
      identifiers: [{ kind: 'NSE_SYMBOL', value: 'OD111NAM' }], actor: ACTOR,
    });
    expect(made.kind).toBe('CREATED');
    if (made.kind !== 'CREATED') return;

    const res = await ingest({ companyName: name, segment: 'MAINBOARD', openDate: '2026-10-20', priceRangeMin: 50 });
    expect(res.outcome).toBe('held');
    expect((await rowsNamed(name)).map((r) => r.id)).toEqual([made.ipoId]);
    const holds = await db!.select({ id: schema.auditLogs.id, details: schema.auditLogs.details }).from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.actionType, 'IDENTITY_HELD_FOR_REVIEW'), eq(schema.auditLogs.ipoId, made.ipoId)));
    expect(holds.length).toBe(1);
    expect((holds[0].details as { rule?: string }).rule).toBe('OD-111');
  });

  it('records the creation (who, identifiers) in audit_logs and redirects an IPO to its editor', async () => {
    const name = `${PREFIX} Audit Ltd`;
    const made = await createIpoByAdmin(db as never, {
      companyName: name, offeringType: 'IPO', segment: 'SME',
      identifiers: [{ kind: 'CIN', value: 'L17110MH1973PLC019786' }], actor: ACTOR, sourceNote: 'RHP cover page',
    });
    expect(made.kind).toBe('CREATED');
    if (made.kind !== 'CREATED') return;
    expect(made.slug).toBe(generateIPOSlug(name));
    expect(made.editorPath).toBe(`/ipos/${made.slug}?edit=`);
    const [row] = await db!.select().from(schema.ipos).where(eq(schema.ipos.id, made.ipoId));
    expect({ cin: row.cin, offeringType: row.offeringType, segment: row.segment, status: row.status })
      .toEqual({ cin: 'L17110MH1973PLC019786', offeringType: 'IPO', segment: 'SME', status: 'UPCOMING' });
    const audit = await db!.select().from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.actionType, 'IPO_CREATED_BY_ADMIN'), eq(schema.auditLogs.ipoId, made.ipoId)));
    expect(audit.length).toBe(1);
    expect(audit[0].adminUser).toBe(ACTOR.name);
    expect(audit[0].details).toMatchObject({ rule: 'OD-111', adminId: ACTOR.adminId, sourceNote: 'RHP cover page' });
  });

  it('a non-IPO admin-owned type (BUYBACK) is created with no segment and no detail page yet', async () => {
    const made = await createIpoByAdmin(db as never, {
      companyName: `${PREFIX} Buyback Ltd`, offeringType: 'BUYBACK', segment: null,
      identifiers: [{ kind: 'BSE_IPO_NO', value: '97113' }], actor: ACTOR,
    });
    expect(made).toMatchObject({ kind: 'CREATED', editorPath: null });
  });

  describe('item 26 interaction: the hold follows the tier the resolver bound on, never a re-comparison of current values', () => {
    const name = `${PREFIX} Alias Ltd`;
    async function createThenEditSymbol(): Promise<string> {
      const made = await createIpoByAdmin(db as never, {
        companyName: name, offeringType: 'IPO', segment: 'MAINBOARD',
        identifiers: [{ kind: 'NSE_SYMBOL', value: 'OD111ALX' }], actor: ACTOR,
      });
      expect(made.kind).toBe('CREATED');
      if (made.kind !== 'CREATED') throw new Error('not created');
      const v = await readAdminFieldVersion(db as never, made.ipoId, 'ipos', 'symbol');
      const edit = await writeAdminFieldValue(db as never, {
        ipoId: made.ipoId, tableName: 'ipos', fieldName: 'symbol', value: 'OD111ALY',
        mode: { kind: 'typed', sourceNote: 'RHP cover page' }, expectedVersion: v!.version,
        actor: ACTOR, entryPoint: 'test',
      });
      expect(edit.kind).toBe('OK');
      const aliases = await db!.select().from(schema.ipoIdentifierAliases).where(eq(schema.ipoIdentifierAliases.ipoId, made.ipoId));
      expect(aliases.map((a) => [a.kind, a.value])).toEqual([['SYMBOL', 'OD111ALX']]);
      return made.ipoId;
    }

    it('a record carrying the OLD symbol (a kept alias) with a corroborating name binds the admin row, not held', async () => {
      const id = await createThenEditSymbol();
      const res = await ingest({ companyName: name, segment: 'MAINBOARD', openDate: '2026-10-20', priceRangeMin: 94, symbol: 'OD111ALX' });
      expect(res).toEqual({ outcome: 'bound', id });
      const holds = await db!.select({ id: schema.auditLogs.id }).from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.actionType, 'IDENTITY_HELD_FOR_REVIEW'), eq(schema.auditLogs.ipoId, id)));
      expect(holds.length).toBe(0);
    });

    it('a record carrying the NEW symbol binds; a record with only the same name is still held', async () => {
      const id = await createThenEditSymbol();
      expect(await ingest({ companyName: name, segment: 'MAINBOARD', openDate: '2026-10-20', priceRangeMin: 94, symbol: 'OD111ALY' }))
        .toEqual({ outcome: 'bound', id });
      expect((await ingest({ companyName: name, segment: 'MAINBOARD', openDate: '2026-10-20', priceRangeMin: 94 })).outcome).toBe('held');
      expect((await rowsNamed(name)).map((r) => r.id)).toEqual([id]);
    });
  });

  describe('concurrent creates (Tier A MINOR 2): one wins, the other is refused naming it', () => {
    for (const [label, ident] of [
      ['CIN', { kind: 'CIN' as const, value: 'U31909DL2005PLC139499' }],
      ['symbol', { kind: 'NSE_SYMBOL' as const, value: 'OD111RACE' }],
    ] as const) {
      it(`two admins create the same ${label} at the same moment -> one CREATED, one EXISTS naming it, one row`, async () => {
        const names = [`${PREFIX} Race ${label} One Ltd`, `${PREFIX} Race ${label} Two Ltd`];
        const results = await Promise.all(names.map((companyName) => createIpoByAdmin(db as never, {
          companyName, offeringType: 'IPO', segment: 'MAINBOARD', identifiers: [ident], actor: ACTOR,
        })));
        const created = results.filter((r) => r.kind === 'CREATED');
        const refused = results.filter((r) => r.kind === 'EXISTS');
        expect(created.length).toBe(1);
        expect(refused.length).toBe(1);
        if (created[0].kind !== 'CREATED' || refused[0].kind !== 'EXISTS') return;
        expect(refused[0].ipoId).toBe(created[0].ipoId);
        expect(refused[0].reason).toContain(created[0].slug);
        const rows = [...(await rowsNamed(names[0])), ...(await rowsNamed(names[1]))];
        expect(rows.map((r) => r.id)).toEqual([created[0].ipoId]);
      });
    }
  });

  describe('the create-time slug check (Tier A MINOR 3): a taken slug is a refusal naming the row, never a hold', () => {
    it('a relaunch whose old WITHDRAWN row holds the slug -> SLUG_TAKEN naming that row, nothing created, no hold', async () => {
      const name = `${PREFIX} Relaunch Ltd`;
      const oldSlug = generateIPOSlug(name);
      const [old] = await db!.insert(schema.ipos).values({
        companyName: name, slug: oldSlug, category: 'MAINBOARD', status: 'WITHDRAWN', offeringType: 'IPO', segment: 'MAINBOARD',
        openDate: '2025-03-10', cin: 'U31909DL2005PLC139401',
      } as never).returning({ id: schema.ipos.id });
      const r = await createIpoByAdmin(db as never, {
        companyName: name, offeringType: 'IPO', segment: 'MAINBOARD',
        identifiers: [{ kind: 'CIN', value: 'U31909DL2005PLC139402' }], actor: ACTOR,
      });
      expect(r).toMatchObject({ kind: 'SLUG_TAKEN', ipoId: old.id, slug: oldSlug, companyName: name });
      if (r.kind === 'SLUG_TAKEN') {
        expect(r.reason).toContain(oldSlug);
        expect(r.reason).toMatch(/merge/i);
      }
      expect((await rowsNamed(name)).map((x) => x.id)).toEqual([old.id]);
      const holds = await db!.select({ id: schema.auditLogs.id }).from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.actionType, 'IDENTITY_HELD_FOR_REVIEW'), eq(schema.auditLogs.newValue, oldSlug)));
      expect(holds.length).toBe(0);
    });
  });

  describe('refusals', () => {
    it('no identifier -> INVALID', async () => {
      const r = await createIpoByAdmin(db as never, { companyName: `${PREFIX} None Ltd`, offeringType: 'IPO', segment: 'SME', identifiers: [], actor: ACTOR });
      expect(r.kind).toBe('INVALID');
      expect((await rowsNamed(`${PREFIX} None Ltd`)).length).toBe(0);
    });

    it('a SEBI filing number alone -> INVALID naming OD-89', async () => {
      const r = await createIpoByAdmin(db as never, {
        companyName: `${PREFIX} Sebi Ltd`, offeringType: 'IPO', segment: 'SME',
        identifiers: [{ kind: 'SEBI_FILING_NO', value: '104428' }], actor: ACTOR,
      });
      expect(r.kind).toBe('INVALID');
      if (r.kind === 'INVALID') expect(r.reason).toMatch(/OD-89/);
      expect((await rowsNamed(`${PREFIX} Sebi Ltd`)).length).toBe(0);
    });

    it('an IPO with no segment -> INVALID', async () => {
      const r = await createIpoByAdmin(db as never, {
        companyName: `${PREFIX} Noseg Ltd`, offeringType: 'IPO', segment: null,
        identifiers: [{ kind: 'NSE_SYMBOL', value: 'OD111NSG' }], actor: ACTOR,
      });
      expect(r.kind).toBe('INVALID');
    });

    for (const k of KINDS) {
      it(`${k.kind} already bound to another row -> EXISTS naming that row, nothing created`, async () => {
        const first = await createIpoByAdmin(db as never, {
          companyName: k.name, offeringType: 'IPO', segment: k.record(k.name).segment,
          identifiers: [{ kind: k.kind, value: k.typed }], actor: ACTOR,
        });
        expect(first.kind).toBe('CREATED');
        if (first.kind !== 'CREATED') return;
        const otherName = `${PREFIX} Other ${k.kind} Ltd`;
        const again = await createIpoByAdmin(db as never, {
          companyName: otherName, offeringType: 'IPO', segment: k.record(k.name).segment,
          identifiers: [{ kind: k.kind, value: k.typed }], actor: ACTOR,
        });
        expect(again).toMatchObject({ kind: 'EXISTS', ipoId: first.ipoId, slug: first.slug });
        if (again.kind === 'EXISTS') expect(again.reason).toContain(first.slug);
        expect((await rowsNamed(otherName)).length).toBe(0);
      });
    }
  });
});
