# Item 5 — `ipo_field_plan`

## Purpose

After this ships, there is one row per (IPO, table, field) recording what was asked for and what
came back — closing the gap §2.3 names: `field_sources` records only successful writes, so a field
never attempted and a field attempted and failed are indistinguishable in it today, both simply
absent.

## Serves

§2.3 (the full column list this card reproduces), OD-9 (one row per IPO — the plan's key includes
`ipo_id` as a real foreign key, never a duplicate), §7.1 item 5 (depends on items 1, 2, 3), and the
resolved fork in §7.3 point 2 (*"RESOLVED 2026-09-09: a new table"* — `field_sources` cannot carry
this because it records what a successful write used, not what was asked for and did not come back).

## Files

| Path | State | Change |
|---|---|---|
| `packages/shared/src/db/schema.ts` | exists (1970 lines) | New table `ipoFieldPlan`, appended after `ipoPipelineSteps` (currently the last table, ending line 1970) — the closest existing analogue in shape (per-IPO, per-catalogue-item state machine with `attempts`/`nextDueAt`). |
| `web/drizzle/migrations/<generated-timestamp>_<generated-name>.sql` | **NEW** | Output of `npm run db:generate`, reproduced below in the shape drizzle-kit emits (verified against the two most recent real migrations in this repo, `20260906090638_icy_firelord.sql` and `20260908004955_left_loners.sql`, for statement-breakpoint style). |
| `scraper/src/services/field-plan-repository.ts` | **NEW** | The two queries this card is asked to specify: claim-next-due-field, record-outcome. Mirrors the existing repository pattern (`packages/shared/src/repositories/field-sources-repository.ts` extends `BaseRepository`). |
| `scraper/src/services/document-state-machine.ts` | exists (765 lines) | Not modified by this item — `isStaleInProgress` (line 730-734) and `IN_PROGRESS_STALE_MINUTES = 30` (line 719) are **read as the pattern to mirror**, not imported; `ipo_field_plan`'s claim/reclaim is table-specific (a field claim, not a document claim) and belongs in its own repository, per `claude-behavior.md` rule 8 (no shared dumping-ground module) — but the 30-minute constant and the "state didn't change AND it's been long enough" reclaim shape are copied verbatim into the new file's own `FIELD_PLAN_STALE_CLAIM_MINUTES`, cited here so a future reader can see the two are the same idea applied twice, not two different guesses. |
| `packages/shared/src/repositories/index.ts` (or wherever the repository barrel file is — confirm the exact path at start of work; every other repository in `packages/shared/src/repositories/` is re-exported from one) | exists | Add the export for the new repository, matching the existing pattern. |

## Schema

§2.3's table (reproduced faithfully, with types and indexes added):

```typescript
// packages/shared/src/db/schema.ts — NEW, appended after ipoPipelineSteps (line 1970)

export const ipoFieldPlanStateEnum = pgEnum('ipo_field_plan_state', [
  'PENDING',
  'SUPPLIED',
  'NOT_PRINTED',
  'NOT_AVAILABLE_YET',
  'CHECK_FAILED',
  'EXHAUSTED',
]);

// §3's re-read/verification sub-state, kept as its own enum rather than folded into
// the main `state` column — a field can be SUPPLIED and simultaneously due for
// verification; conflating the two would force a field back to a "not answered yet"
// state just because it's due for a re-check, which is exactly the "verification is
// a read" rule (§2.5.2, OD-6) getting confused with "verification is a re-ask".
export const ipoFieldPlanVerifyStateEnum = pgEnum('ipo_field_plan_verify_state', [
  'NOT_DUE',
  'DUE',
  'IN_PROGRESS',
  'CONFIRMED',
  'DISAGREED',
]);

export const ipoFieldPlan = pgTable(
  'ipo_field_plan',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // ---- the key (§2.3: "one row per (IPO, table, field)") ----
    ipoId: uuid('ipo_id').notNull().references(() => ipos.id, { onDelete: 'cascade' }),
    tableName: varchar('table_name', { length: 100 }).notNull(),
    // NEW, not in §2.3's column list as written — but §2.3 is written before item 1
    // resolved child-row identity (this card is written after item 1's card exists).
    // A financial_statements row's plan entry needs the SAME row-level discriminator
    // item 1 gives field_sources, for an identical reason: "the plan has to record
    // what was asked for and did not come back" (§7.3 point 2) is exactly as false
    // for two fiscal years sharing one plan row as it is for field_sources sharing
    // one provenance row. Default '' for singleton tables (ipos, ipo_details,
    // anchor_investors), matching item 1's convention exactly so a join between the
    // two tables on (ipoId, tableName, rowKey, fieldName) is meaningful.
    rowKey: varchar('row_key', { length: 200 }).notNull().default(''),
    fieldName: varchar('field_name', { length: 100 }).notNull(),

    // ---- resolved ranks (§2.3: "resolved for this IPO's type, so an SME-on-BSE IPO
    // never lists NSE") ----
    rank1Source: scraperSourceEnum('rank1_source'),
    rank2Source: scraperSourceEnum('rank2_source'),
    rank3Source: scraperSourceEnum('rank3_source'),

    // ---- state (§2.3's six values) ----
    state: ipoFieldPlanStateEnum('state').notNull().default('PENDING'),

    // ---- what won, and on what evidence (§2.3: "this is what makes §2.5 work") ----
    chosenSource: scraperSourceEnum('chosen_source'),
    chosenRank: integer('chosen_rank'), // 1 | 2 | 3 — which of rank1/2/3Source actually supplied it
    chosenDocumentId: uuid('chosen_document_id').references(() => documents.id, { onDelete: 'set null' }),
    chosenDocumentType: documentTypeEnum('chosen_document_type'),
    chosenSha256: char('chosen_sha256', { length: 64 }), // matches documents.sha256's own type exactly
    chosenPage: integer('chosen_page'),

    // ---- per-field backoff (§2.3) ----
    attempts: integer('attempts').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    nextDueAt: timestamp('next_due_at', { withTimezone: true }),

    // ---- claim/reclaim, mirroring isStaleInProgress (document-state-machine.ts:730) ----
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    claimToken: uuid('claim_token'), // the walk run's own id; null when unclaimed

    // ---- §3's verification/re-read state ----
    verifyDueAt: timestamp('verify_due_at', { withTimezone: true }),
    verifyState: ipoFieldPlanVerifyStateEnum('verify_state').notNull().default('NOT_DUE'),
    verifySource: scraperSourceEnum('verify_source'),
    verifyValue: text('verify_value'), // the re-read value, for comparison — not written to the row
    disagreementCount: integer('disagreement_count').notNull().default(0),

    // ---- §2.5's supersession trigger needs to know which document superseded this
    // row's evidence (trigger 3: a document reaches EXTRACTED that outranks the
    // stored one). Not in §2.3's literal column list, but §2.5's own text
    // ("chosen_document_id it supersedes goes SUPPLIED -> PENDING ... with
    // superseded_by recorded") names a column §2.3 forgot to list — Appendix A wins
    // over §1 on a conflict per §1.1's own rule; the same "later section wins"
    // reading applies here between §2.3 and §2.5. ----
    supersededBy: uuid('superseded_by').references(() => documents.id, { onDelete: 'set null' }),

    // ---- reconciliation with the manifest (§2.3: "so the plan is reconciled when
    // the manifest changes, never regenerated per cycle") ----
    manifestVersion: varchar('manifest_version', { length: 50 }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueFieldPlanRow: unique('unique_ipo_field_plan_row').on(
      table.ipoId, table.tableName, table.rowKey, table.fieldName
    ),
    // The claim query's index — "find PENDING/reclaimable rows due now"
    stateDueIdx: index('idx_ipo_field_plan_state_next_due').on(table.state, table.nextDueAt),
    // The reclaim query's index — mirrors isStaleInProgress's shape (state + a timestamp)
    claimedIdx: index('idx_ipo_field_plan_claimed_at').on(table.claimedAt),
    verifyDueIdx: index('idx_ipo_field_plan_verify_due').on(table.verifyState, table.verifyDueAt),
    ipoIdIdx: index('idx_ipo_field_plan_ipo_id').on(table.ipoId),
  })
);

export const ipoFieldPlanRelations = relations(ipoFieldPlan, ({ one }) => ({
  ipo: one(ipos, { fields: [ipoFieldPlan.ipoId], references: [ipos.id] }),
  chosenDocument: one(documents, { fields: [ipoFieldPlan.chosenDocumentId], references: [documents.id] }),
}));

export type IpoFieldPlan = typeof ipoFieldPlan.$inferSelect;
export type NewIpoFieldPlan = typeof ipoFieldPlan.$inferInsert;
```

**One thing the design does not say, flagged rather than guessed:** whether `chosen_source` should
be `scraperSourceEnum` at all. §1.1's source labels (`DOC`, `NSE`, `BSE`, `CG`, `MC`, `IG`, `REG`,
`ADMIN`) do not line up 1:1 with the DB enum `scraper_source` (`schema.ts:121-129`: `ADMIN`, `DRHP`,
`NSE`, `BSE`, `API_FALLBACK`, `MONEYCONTROL`, `CHITTORGARH`) — **the enum has no member for
`INVESTORGAIN_GMP`**, even though it is a live `ScraperSource` in
`scraper/src/config/field-priority-matrix.ts:16` and is used as a rank-1 source for five fields
there (lines 669-710). A class-W field's plan row (grey market, §1.1) would have no valid enum value
to write into `rank1Source`/`chosen_source` today. **This is a pre-existing gap this card surfaces,
not one item 5 introduces** — the same enum is reused by `field_sources.source` and
`data_conflicts.source1/2`, so it already cannot record a GMP-sourced field's provenance correctly,
which item 1's staging proof would also hit the first time a GMP field is walked. **Recommended:
item 5's migration also adds `'INVESTORGAIN_GMP'` to the `scraper_source` enum** (`ALTER TYPE
scraper_source ADD VALUE 'INVESTORGAIN_GMP'` — additive, non-destructive, safe outside a transaction
per Postgres's `ALTER TYPE ... ADD VALUE` rules) — named here because item 5 is the first place a
plan row for a class-W field would actually need to store it, but the fix belongs to the enum, not
to this table alone.

Generated migration (in the two-migration style this repo's history shows):

```sql
CREATE TYPE "public"."ipo_field_plan_state" AS ENUM('PENDING', 'SUPPLIED', 'NOT_PRINTED', 'NOT_AVAILABLE_YET', 'CHECK_FAILED', 'EXHAUSTED');--> statement-breakpoint
CREATE TYPE "public"."ipo_field_plan_verify_state" AS ENUM('NOT_DUE', 'DUE', 'IN_PROGRESS', 'CONFIRMED', 'DISAGREED');--> statement-breakpoint
ALTER TYPE "public"."scraper_source" ADD VALUE 'INVESTORGAIN_GMP';--> statement-breakpoint
CREATE TABLE "ipo_field_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"table_name" varchar(100) NOT NULL,
	"row_key" varchar(200) DEFAULT '' NOT NULL,
	"field_name" varchar(100) NOT NULL,
	"rank1_source" "scraper_source",
	"rank2_source" "scraper_source",
	"rank3_source" "scraper_source",
	"state" "ipo_field_plan_state" DEFAULT 'PENDING' NOT NULL,
	"chosen_source" "scraper_source",
	"chosen_rank" integer,
	"chosen_document_id" uuid,
	"chosen_document_type" "document_type",
	"chosen_sha256" char(64),
	"chosen_page" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_due_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"claim_token" uuid,
	"verify_due_at" timestamp with time zone,
	"verify_state" "ipo_field_plan_verify_state" DEFAULT 'NOT_DUE' NOT NULL,
	"verify_source" "scraper_source",
	"verify_value" text,
	"disagreement_count" integer DEFAULT 0 NOT NULL,
	"superseded_by" uuid,
	"manifest_version" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "ipo_field_plan" ADD CONSTRAINT "ipo_field_plan_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ipo_field_plan" ADD CONSTRAINT "ipo_field_plan_chosen_document_id_documents_id_fk" FOREIGN KEY ("chosen_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ipo_field_plan" ADD CONSTRAINT "ipo_field_plan_superseded_by_documents_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_ipo_field_plan_row" ON "ipo_field_plan" USING btree ("ipo_id","table_name","row_key","field_name");--> statement-breakpoint
CREATE INDEX "idx_ipo_field_plan_state_next_due" ON "ipo_field_plan" USING btree ("state","next_due_at");--> statement-breakpoint
CREATE INDEX "idx_ipo_field_plan_claimed_at" ON "ipo_field_plan" USING btree ("claimed_at");--> statement-breakpoint
CREATE INDEX "idx_ipo_field_plan_verify_due" ON "ipo_field_plan" USING btree ("verify_state","verify_due_at");--> statement-breakpoint
CREATE INDEX "idx_ipo_field_plan_ipo_id" ON "ipo_field_plan" USING btree ("ipo_id");
```

Not destructive (a new table plus one additive enum value) — does not go in `_gated/`.

## Interfaces

**The two queries the walk runs against the plan**, as the repository methods this card was asked
to specify:

```typescript
// scraper/src/services/field-plan-repository.ts

export const FIELD_PLAN_STALE_CLAIM_MINUTES = 30; // mirrors IN_PROGRESS_STALE_MINUTES,
                                                     // document-state-machine.ts:719

export class FieldPlanRepository extends BaseRepository {
  constructor(protected db: NodePgDatabase<typeof schema>, protected redis: Redis) {
    super(db, redis);
  }

  /**
   * QUERY 1 — claim the next due field for one IPO.
   *
   * "Due" means: state is PENDING (never supplied — trigger 1, §2.5.1), OR
   * verify_state = 'DUE' (a scheduled re-check — trigger 4), OR next_due_at has
   * passed (a NOT_AVAILABLE_YET reclaim — trigger 2), OR the row is claimed but the
   * claim is stale (a crashed walk — mirrors isStaleInProgress). Returns at most
   * ONE row, claimed atomically in the same statement (no separate SELECT then
   * UPDATE — two walk processes racing on the same field is the exact class the
   * distributed lock in data-consolidation-orchestrator.ts already exists to
   * prevent one level up; this claim is the field-level equivalent, needed because
   * §2.2 says the walk itself is single-field-at-a-time and resumable, not because
   * two processes are expected to run at once).
   */
  async claimNextDueField(ipoId: string, claimToken: string): Promise<IpoFieldPlan | null> {
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - FIELD_PLAN_STALE_CLAIM_MINUTES * 60_000);
    const result = await this.db.execute(sql`
      UPDATE ipo_field_plan
      SET claimed_at = ${now}, claim_token = ${claimToken}::uuid
      WHERE id = (
        SELECT id FROM ipo_field_plan
        WHERE ipo_id = ${ipoId}
          AND (
            (state = 'PENDING' AND (next_due_at IS NULL OR next_due_at <= ${now}))
            OR (state = 'NOT_AVAILABLE_YET' AND next_due_at <= ${now})
            OR (verify_state = 'DUE' AND verify_due_at <= ${now})
          )
          AND (claimed_at IS NULL OR claimed_at < ${staleThreshold})
        ORDER BY next_due_at NULLS FIRST, verify_due_at NULLS LAST
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
    `);
    return result.rows[0] ?? null;
  }

  /**
   * QUERY 2 — record the outcome of one field attempt (§2.4's per-field loop body).
   *
   * Never a partial write: every branch of §2.4 (SUPPLIED / CHECK_FAILED /
   * NOT_PRINTED / NOT_AVAILABLE_YET / EXHAUSTED) sets `state`, clears `claimed_at`
   * and `claim_token` (the claim is released whether the outcome is success or
   * failure — an unclaimed row is what makes it pickable again), and bumps
   * `attempts` + `last_attempt_at`. `next_due_at` is set by the CALLER per the
   * outcome (a NOT_AVAILABLE_YET reclaim interval differs from an EXHAUSTED
   * backoff — this card does not invent the backoff schedule, since the design
   * does not specify one; item 6's card names this as its own open question).
   */
  async recordOutcome(params: {
    id: string;
    claimToken: string; // must match the current claim_token, or the write is a no-op —
                          // prevents a reclaimed-as-stale row from having its outcome
                          // written twice by the walk that lost the race
    state: 'SUPPLIED' | 'NOT_PRINTED' | 'NOT_AVAILABLE_YET' | 'CHECK_FAILED' | 'EXHAUSTED';
    chosenSource?: ScraperSourceLiteral;
    chosenRank?: number;
    chosenDocumentId?: string;
    chosenDocumentType?: string;
    chosenSha256?: string;
    chosenPage?: number;
    nextDueAt?: Date | null;
  }): Promise<{ updated: boolean }> {
    const result = await this.db.execute(sql`
      UPDATE ipo_field_plan
      SET state = ${params.state},
          chosen_source = COALESCE(${params.chosenSource ?? null}, chosen_source),
          chosen_rank = COALESCE(${params.chosenRank ?? null}, chosen_rank),
          chosen_document_id = COALESCE(${params.chosenDocumentId ?? null}, chosen_document_id),
          chosen_document_type = COALESCE(${params.chosenDocumentType ?? null}, chosen_document_type),
          chosen_sha256 = COALESCE(${params.chosenSha256 ?? null}, chosen_sha256),
          chosen_page = COALESCE(${params.chosenPage ?? null}, chosen_page),
          attempts = attempts + 1,
          last_attempt_at = now(),
          next_due_at = ${params.nextDueAt ?? null},
          claimed_at = NULL,
          claim_token = NULL,
          updated_at = now()
      WHERE id = ${params.id} AND claim_token = ${params.claimToken}::uuid
      RETURNING id;
    `);
    return { updated: result.rows.length > 0 };
  }
}
```

**§2.3's "written from the result of the write, never in parallel with it" rule** (the
`LOCK_NOT_ACQUIRED` false-clean-state guard) applies here as: `recordOutcome` is called AFTER
`consolidatedUpsertChildRows`/`consolidatedUpsertIPO` returns, and a `skipped: true` result from
either means the caller passes `state: 'PENDING'` (i.e., does not call `recordOutcome` with
`SUPPLIED` at all) — this card's queries enforce nothing about that ordering themselves; it is the
walk's (item 6's) responsibility to call them in the right sequence.

## Feature flag

`FEATURE_FLAGS.ENABLE_FIELD_PLAN` (**NEW**, `scraper/src/config/feature-flags.ts`), default **off**
in every slot until item 6 (the walk) exists to populate and consume it — a plan table nothing reads
or writes is inert but the flag still gates the generator (item 2/3's manifest reconciliation) that
would otherwise create rows for an IPO the walk can't yet process. Once item 6 ships, default flips
to **on in staging, off in prod** until item 6's own staging proof passes, then **on in prod**. The
table itself is never the rollback surface — rows are additive state, not overwritten values;
rollback is turning the flag off, which simply stops new rows being claimed (existing rows are
inert, harmless to leave).

## Tests

Tier: unit, `scraper/tests/unit/services/field-plan-repository.test.ts` (NEW) (new file, naming matches
Tier: unit, `scraper/tests/unit/services/field-plan-repository.test.ts` (new file, naming matches
existing `data-consolidation-*.test.ts` convention) — **red before the change** (the table and
repository do not exist yet, so these are written against the interfaces above and fail to compile
until item 5 lands, which is the correct "red" for a new-table item):

1. `claimNextDueField` returns a `PENDING` row with `next_due_at IS NULL`, and does not return the
   same row to a second concurrent call before `recordOutcome` releases the claim (`FOR UPDATE SKIP
   LOCKED` — asserted by claiming from two connections in the same test, not by inspecting SQL text).
2. A row claimed longer than `FIELD_PLAN_STALE_CLAIM_MINUTES` ago IS returned again (the reclaim
   path) — asserts the stale-claim threshold, mirroring `document-state-machine.test.ts`'s existing
   coverage of `isStaleInProgress`.
3. `recordOutcome` with a `claimToken` that does not match the row's current `claim_token` returns
   `{ updated: false }` and writes nothing — the double-write-after-reclaim guard.
4. The unique constraint `unique_ipo_field_plan_row` rejects a second row for the same
   `(ipoId, tableName, rowKey, fieldName)` — a plain constraint test, not requiring the repository.

Integration, `scraper/tests/integration/field-plan-claim-race.integration.test.ts` (NEW) (**NEW**, real DB
Integration, `scraper/tests/integration/field-plan-claim-race.integration.test.ts` (**NEW**, real DB
— `FOR UPDATE SKIP LOCKED` behaviour cannot be proven against a mock): two simulated walk processes
call `claimNextDueField` concurrently against ten PENDING rows; assert each row is claimed exactly
once and all ten are eventually claimed.

## Detection

`No detection change: this item creates an inert table with no write path of its own; item 6 (the
pull walk, which is this table's only writer and reader) carries the detection check that proves the
plan is being populated and drained correctly — a check here would either duplicate item 6's or
assert nothing beyond "the migration applied", which the CI schema-drift check already covers.`

## Staging proof

This table has no independent staging proof until item 6 exists to populate it — **item 5 alone
cannot produce a real row**. The proof that belongs here is narrower: after deploying the migration
to staging, `\d ipo_field_plan` through the tunnel shows the table and both new enums exist, and
`SELECT count(*) FROM ipo_field_plan` returns `0` (confirms the migration applied cleanly with no
seed/backfill side effect it shouldn't have). The real staging proof — rows moving through
`PENDING -> SUPPLIED`, claims being taken and released — is item 6's, named there.

## Rollback

Drop the table and both enums (`DROP TABLE ipo_field_plan; DROP TYPE ipo_field_plan_state; DROP TYPE
ipo_field_plan_verify_state;`) — safe because nothing outside this table and item 6's walk reads or
writes it; no other table has a foreign key pointing INTO `ipo_field_plan`. The `INVESTORGAIN_GMP`
enum addition to `scraper_source` is **not reversible** by a plain migration (Postgres cannot drop a
single enum value without recreating the type and every column that uses it) — if item 5 is rolled
back, that addition should be left in place rather than attempting a rollback of it; an unused enum
value is harmless, unlike a half-reverted type recreation.

## Tier, budget and cost

**Tier A** — a new table plus an enum-widening migration that other tables' columns depend on
(`scraper_source` is used by `field_sources`, `data_conflicts`, and now `ipo_field_plan`), and it is
a named prerequisite (§7.1: depends on 1, 2, 3) for item 6, the core of the whole pull loop.
`Budget: 45 min wall-clock, 90 tool calls`. Cost: medium per §7.1's own sizing — schema-only, no
write-path logic to get wrong, but the claim-query's `FOR UPDATE SKIP LOCKED` correctness needs the
integration test above proven for real, not just unit-mocked, before this is trusted as item 6's
foundation.

## Rules implemented

<!-- generated by docs/design/apply-rule-ownership.mjs - edits inside this block are overwritten -->

4 rule(s) from `docs/design/rules.json`, generated by
`node docs/design/apply-rule-ownership.mjs --apply` from `rule-ownership.json`.

| Design section | Rule ids |
|---|---|
| §2.3 | R-026, R-027, R-028, R-029 |

## Known gaps

None recorded yet. A finding this item owns but does not close is written here, with its
id and the reason — that is what stops "zero open findings" being reached by dropping one.
