# Item 17 — The closed-IPO job (OD-22)

## Purpose

Every night at 22:00 IST, at most ten already-closed IPOs get walked through the same per-field
pull loop a live IPO gets, newest close date first, and each is marked so it is never picked again
unless the reason it failed has actually changed — so the closed-IPO backlog drains instead of
either repeating forever or being re-walked blind with no memory of what happened last time.

## Serves

`docs/design/data-sourcing-pull-model.md` §6 in full (OD-22, the owner's 2026-09-09 instruction:
*"Add another cycle at ten o'clock at night that deals only with old IPOs, latest closed first, at
most 10 old IPOs a day, do not repeat which are already done."*), §6.2, §6.3, §6.4, §7.1 item 17.

Findings closed by this item: **F-31** ("`field_sources` holds one prior value, so the per-field
rollback claim fails past one overwrite" — closed by taking the snapshot *before* the first closed
IPO is walked, not after) and **F-35**'s scheduling half ("a nightly backlog drain adds a third
extractor to a 2-vCPU box" — closed by running at 22:00, outside the data job's slots, and never
starting while the data job's cycle lock is held; the box-capacity half of F-35 is item 7's, this
item only owns *when* the drain runs relative to the data job).

## Files

| Path | State | Change |
|---|---|---|
| `packages/shared/src/db/schema.ts` | exists | **NEW** table `closedIpoResourcing` — add after `ipoPipelineSteps` (currently the last table, ending line 1989) following the same pattern (uuid PK, FK to `ipos.id` with `onDelete: 'cascade'`, one status enum, a `relations()` block, `$inferSelect`/`$inferInsert` type exports). See Schema below. |
| `web/drizzle/migrations/NNNN_closed_ipo_resourcing.sql` | NEW | The generated migration — see Schema below for the SQL `npm run db:generate` will emit once the table above is added. Non-destructive (CREATE TABLE + CREATE TYPE only), so it belongs in the journal, not `_gated/`. |
| `scraper/src/scheduler/closed-ipo-job.ts` | NEW | The job itself: the selection query, the per-IPO walk dispatch, and the done-marker writes. Mirrors the shape of `scraper/src/services/document-cycle.ts`'s `runDocumentPurge` (query → per-row decision → per-row action → summary) but selects from `ipos` joined to the new table instead of `document_fetch_state`. |
| `scraper/src/scheduler/due-step-cycle.ts` | exists | `DISCOVERY_SLOTS_IST_MINUTES` (line 15) currently holds D-13's four slots (`08:30, 11:00, 14:00, 17:30`), not OD-19's replacement (`00:00, 08:00, 14:00`) or the new 22:00 closed-IPO slot — **this file's slot constants are item 7's to change, not item 17's.** Item 17 adds the 22:00 trigger as its own scheduled entry point (see Feature flag / scheduling below); it does not touch this file's existing slot logic. |
| `scraper/src/index.ts` | exists | **NEW** call site: a `triggerClosedIpoJob` step (named after the existing `triggerDocumentPurge` pattern at line 1228) that (a) checks the data job's cycle lock (`CYCLE_LOCK_RESOURCE = 'scraper:cycle'`, `index.ts:167`) is free before doing anything, and (b) if free, runs the closed-IPO job. Wired the same way `runStep(cycleId, 'documentPurge', triggerDocumentPurge)` is wired at line 834. |
| `packages/shared/src/db/schema.ts` | exists | `documents.filingDate` (line 645, `date('filing_date')`) — no schema change, but see Interfaces: the backfill this item owns targets this existing nullable column. |

## Schema

**New table**, Drizzle:

```ts
export const closedIpoResourcingOutcomeEnum = pgEnum('closed_ipo_resourcing_outcome', [
  'DONE',
  'PARTIAL',
  'FAILED',
]);

export const closedIpoResourcingCauseClassEnum = pgEnum('closed_ipo_resourcing_cause_class', [
  'DOCUMENT_UNOBTAINABLE',
  'EXTRACTOR_MISSING',
  'VALIDATION_REJECTED',
  'SOURCE_UNREACHABLE',
  'WRITE_SKIPPED',
]);

export const closedIpoResourcing = pgTable(
  'closed_ipo_resourcing',
  {
    ipoId: uuid('ipo_id')
      .primaryKey()
      .references(() => ipos.id, { onDelete: 'cascade' }),
    firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true }).notNull(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    outcome: closedIpoResourcingOutcomeEnum('outcome').notNull(),
    causeClass: closedIpoResourcingCauseClassEnum('cause_class'),
    causeDetail: text('cause_detail'),
    fieldsWritten: integer('fields_written').notNull().default(0),
    fieldsLeftEmpty: integer('fields_left_empty').notNull().default(0),
    resourcedAtVersion: varchar('resourced_at_version', { length: 50 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    outcomeIdx: index('idx_closed_ipo_resourcing_outcome').on(table.outcome),
    causeClassIdx: index('idx_closed_ipo_resourcing_cause_class').on(table.causeClass),
  })
);

export const closedIpoResourcingRelations = relations(closedIpoResourcing, ({ one }) => ({
  ipo: one(ipos, {
    fields: [closedIpoResourcing.ipoId],
    references: [ipos.id],
  }),
}));

export type ClosedIpoResourcing = typeof closedIpoResourcing.$inferSelect;
export type NewClosedIpoResourcing = typeof closedIpoResourcing.$inferInsert;
```

`ipoId` is the primary key (one row per IPO, per §6.2's "one new table... one row per IPO") rather
than a separate `id` + unique constraint — there is exactly one resourcing record per IPO by
design, so a natural PK avoids a redundant unique index.

**Generated migration SQL** (following the style of `web/drizzle/migrations/0035_add_document_fetch_state.sql`,
which is the most recent CREATE-TABLE-plus-CREATE-TYPE migration in this journal):

```sql
DO $$ BEGIN
  CREATE TYPE "closed_ipo_resourcing_outcome" AS ENUM ('DONE', 'PARTIAL', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "closed_ipo_resourcing_cause_class" AS ENUM (
    'DOCUMENT_UNOBTAINABLE',
    'EXTRACTOR_MISSING',
    'VALIDATION_REJECTED',
    'SOURCE_UNREACHABLE',
    'WRITE_SKIPPED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "closed_ipo_resourcing" (
	"ipo_id" uuid PRIMARY KEY REFERENCES "ipos"("id") ON DELETE CASCADE,
	"first_attempt_at" timestamp with time zone NOT NULL,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"outcome" "closed_ipo_resourcing_outcome" NOT NULL,
	"cause_class" "closed_ipo_resourcing_cause_class",
	"cause_detail" text,
	"fields_written" integer DEFAULT 0 NOT NULL,
	"fields_left_empty" integer DEFAULT 0 NOT NULL,
	"resourced_at_version" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_closed_ipo_resourcing_outcome" ON "closed_ipo_resourcing" USING btree ("outcome");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_closed_ipo_resourcing_cause_class" ON "closed_ipo_resourcing" USING btree ("cause_class");
```

This is non-destructive (CREATE only) and goes in the numbered journal, **not**
`web/drizzle/migrations/_gated/`, per the schema heading's rule and the project's own precedent
(`0035_add_document_fetch_state.sql`'s header: "NON-DESTRUCTIVE by construction, which is why it
belongs in the journal and NOT in `_gated/`"). The exact numeric prefix and hash-suffixed filename
(the journal's two naming styles both appear — `00NN_name.sql` and `<timestamp>_<words>.sql`, see
`web/drizzle/migrations/meta/_journal.json`) is assigned by `npm run db:generate` at implementation
time, not invented here.

**`field_sources` snapshot (closes F-31).** No schema change — the existing `field_sources` table
(`packages/shared/src/db/schema.ts:1376`) already holds `previousValue`/`previousSource` (exactly
one prior value, which is what makes F-31 true). This item's answer is operational, not
structural: **before the first closed IPO is ever walked**, run a one-time export of every
`field_sources` row for every LISTED/CLOSED IPO to a durable, timestamped snapshot (a table dump or
an object-store copy — the design does not name the storage, so this is a fork; see Rollback). The
design's own number for why this must happen first, not after: **6,600 rows** is `field_sources`'
current row count for the population this job will touch (read from the design's evidence
requirement in §6.4 — the design does not print the literal row count in the text made available to
this card; **the design does not say** the exact figure here beyond describing the operation as
"cheap before, impossible after" — this card does not invent one). **Fork, not invented:** the
concrete snapshot mechanism (pg_dump of the table, a `field_sources_snapshot` shadow table, or an
export script) is not specified in the design text read this session — flag as **O-nn** per the
template's own instruction ("If a heading would need 'it depends'... record it... as `O-nn`").

## Interfaces

```ts
// scraper/src/scheduler/closed-ipo-job.ts (NEW)

export interface ClosedIpoJobDeps {
  db: NodePgDatabase<typeof schema>;
  now?: Date;
  cap?: number; // default 10
}

export interface ClosedIpoJobSummary {
  candidatesConsidered: number;
  attempted: number;
  outcomes: Record<'DONE' | 'PARTIAL' | 'FAILED', number>;
  skippedCycleLockHeld: boolean;
}

/** The selection query (verbatim, per §6.1's four ordered rules). */
export const CLOSED_IPO_CANDIDATES_SQL = `
  SELECT i.id, i.close_date, i.status
    FROM ipos i
    LEFT JOIN closed_ipo_resourcing r ON r.ipo_id = i.id
   WHERE upper(i.status::text) IN ('LISTED', 'CLOSED')
     AND i.close_date < CURRENT_DATE
     AND (
       r.ipo_id IS NULL
       OR (r.outcome IN ('PARTIAL', 'FAILED') AND r.cause_class IS DISTINCT FROM :new_cause_class)
     )
   ORDER BY i.close_date DESC
   LIMIT 10
`;

/** Runs the job once: cycle-lock check, candidate selection, per-IPO walk, done-marker write. */
export async function runClosedIpoJob(deps: ClosedIpoJobDeps): Promise<ClosedIpoJobSummary>;
```

The `WHERE ... cause_class IS DISTINCT FROM :new_cause_class` clause is written as a placeholder
because the retry rule (§6.2: "a `FAILED` row is picked again only when its cause class has
changed") is evaluated **per candidate against that candidate's own next attempt**, which is not
known until the walk is attempted — so the real implementation filters in two passes: the SQL
above pulls every not-done candidate (dropping only rows whose last outcome was `DONE`), and the
job code then skips a `FAILED`/`PARTIAL` row in-process if a fresh attempt would hit the identical
`cause_class` it failed with last time **and** the `resourced_at_version` has not changed (§6.2:
"Same cause, same outcome, no retry" is conditioned on nothing having changed — a version bump is
what licenses a retry even with an unchanged cause class). Note: **`upper(i.status::text)`, not
`upper(i.status)`** — `PURGE_CANDIDATES_SQL` (`scraper/src/services/document-cycle.ts:1410-1425`,
enum cast at line 1423) already hit Postgres error 42883 doing this against the `ipo_status` enum,
per the fix note at lines 1404-1407 ("Found live 2026-09-03: `upper(i.status)` failed with Postgres
42883... `upper(i.status::text)` fixes it"); this new query must not repeat that bug.

**`documents.filing_date` backfill** (§6.4, §6.5 — "populated on a minority of rows... backfilling
it is part of build item 17, not a separate errand"):

```ts
// scraper/scripts/backfill-filing-date.ts (NEW)
export interface FilingDateBackfillSummary {
  documentsConsidered: number;
  filingDateSet: number;
  filingDateUnresolvable: number;
}
export async function backfillFilingDates(deps: { db: ...; dryRun?: boolean }): Promise<FilingDateBackfillSummary>;
```

Resolves `filing_date` from whatever the document's own extracted text or metadata already carries
(the same signal the pull walk's document-type ranking needs per §6.5) for existing `documents`
rows where `filing_date IS NULL`. Dry-run default, per the project's data-repair convention
(`.claude/rules/defect-fix-contract.md` item 4: "a productized, source-backed, re-runnable tool,
never hand arithmetic").

## Feature flag

`ENABLE_CLOSED_IPO_JOB` (**NEW**, `scraper/src/config/feature-flags.ts`), read the same way every
other boolean flag in that file is (`process.env.ENABLE_CLOSED_IPO_JOB === 'true'`, no implicit
default beyond `false`). Default per slot: the design does not state per-slot defaults for this
flag — **the design does not say**; this card recommends `false` in local and staging until item 7
(the scheduler rewrite this job's 22:00 trigger depends on) lands, and `true` only in prod after a
staging soak, but that is a recommendation, not a decision the design makes. If the change cannot
sit behind a flag: it can — the job is entirely new code with a new table, so a flag around it is a
pure addition, and rollback is "stop calling it," not "undo a write."

The 22:00 trigger itself is **not** expressible as a `DISCOVERY_SLOTS_IST_MINUTES`-style constant
in the current `due-step-cycle.ts`, because that file's slot logic (line 15, "minutes-since-
midnight-IST for each daily discovery slot") is scoped to the *data* job's four (soon three, per
OD-19) slots. Item 17 needs its own single-slot check (`isClosedIpoJobDue`, structurally parallel
to `mostRecentDiscoverySlotEpochMinute` but for one fixed 22:00 boundary) rather than reusing or
overloading the existing array — inserting a fifth/fourth slot into that array would make the data
job's own due-check treat 22:00 as one of *its* slots too, which OD-19 explicitly forbids ("never
start while the data job's cycle lock is held" only works if the closed-IPO job is a distinct
check, not a shared one).

## Tests

Red before the change:

- `scraper/tests/unit/scheduler/closed-ipo-job.test.ts` (NEW) (**NEW**) — asserts `CLOSED_IPO_CANDIDATES_SQL`
  selects: (a) a `LISTED` IPO with `close_date` yesterday and no `closed_ipo_resourcing` row → included;
  (b) a `CLOSED` IPO with `close_date` today → excluded (`close_date < CURRENT_DATE`, not `<=`);
  (c) an `UPCOMING`/`OPEN` IPO → excluded regardless of close_date; (d) a `DONE`-outcome IPO →
  excluded; (e) a `FAILED`-outcome IPO with an unchanged `cause_class` → excluded; (f) a
  `FAILED`-outcome IPO whose `cause_class` would differ on retry → included; (g) more than ten
  eligible candidates → exactly ten returned, ordered `close_date DESC`.
- A unit test asserting the job **never starts** when `CYCLE_LOCK_RESOURCE = 'scraper:cycle'`
  (`scraper/src/index.ts:167`) is held — mock the lock manager's `acquireLock`/lock-check to report
  held, and assert `runClosedIpoJob` (or its `index.ts` wiring) returns `skippedCycleLockHeld: true`
  and makes zero calls into the walk.
- A unit test for the done-marker write rule: after a walk marked `PARTIAL` with
  `cause_class: 'DOCUMENT_UNOBTAINABLE'`, a second run at the same `resourced_at_version` does not
  re-select that IPO; bumping `resourced_at_version` does.
- `scraper/tests/unit/scripts/backfill-filing-date.test.ts` (NEW) (**NEW**) — asserts the backfill sets
  `filing_date` only where currently `NULL`, never overwrites an existing value, and the dry-run
  mode makes no writes.
- Tier: unit (`scraper/tests/unit/`, mocked DB), per `.claude/rules/scraper-test-layout.md`. An
  integration test against a real Postgres for the SQL's actual enum-cast behavior belongs in
  `scraper/tests/integration/` given the `upper(i.status::text)` lesson above — a mocked unit test
  cannot catch a real Postgres function-overload error.

## Detection

**NEW check**, `docs/reviews/detection-checks/closed_ipo_job_progress.json` (NEW) (id
`closed_ipo_job_progress`, following the shape of the existing
`docs/reviews/detection-checks/c_issue_size_consistency.json`): asserts the nightly count of
`closed_ipo_resourcing` rows with `outcome != 'DONE'` and `last_attempt_at` within the last 24h is
compared against the prior day's count and a **repeated identical `(ipo_id, cause_class)` pair for
3+ consecutive nights** fails — this is the `signal-ownership.md` R2/R4 requirement made concrete:
a "known" failure needs an issue number, and a failure that never changes for three nights is a
new, unignorable finding, not a steady-state fact. Runs nightly, after the 22:00 job's cycle
completes (per `.claude/rules/recurrence-detection-gate.md`, this PR touches
`scraper/src/scheduler/**` and `scraper/scripts/*.py`-adjacent write paths, so a detection change
is mandatory here, not optional).

## Staging proof

Per `.claude/rules/defect-fix-contract.md` item 5 and the design's own §7.2 ("item 17... additionally
needs F-31's `field_sources` snapshot taken before the first row is walked"):

1. Confirm the `field_sources` snapshot for the LISTED/CLOSED population exists and is timestamped
   **before** the staging cycle that will first run this job.
2. Run one staging 22:00 cycle. The exact log line: `closed-ipo-job: candidatesConsidered=<n>
   attempted=<n<=10> outcomes={DONE:<a>,PARTIAL:<b>,FAILED:<c>}` — healthy value is `attempted <= 10`
   and `attempted > 0` whenever `candidatesConsidered > 0` (a job that finds candidates and attempts
   zero is broken, not idle).
3. Query staging `closed_ipo_resourcing` directly: row count increases by exactly `attempted` from
   the log line above, and no `ipo_id` appears twice.
4. Because this is a data-repair-shaped change (it rewrites historical rows' field values via the
   pull walk), also run `node scripts/assert-repair-held.mjs <invariant> --cycles 2` against
   staging per `defect-fix-contract.md` — a clean read immediately after the job proves nothing
   about whether the *next* real data-job cycle (00:00/08:00/14:00) silently overwrites what the
   closed-IPO job just wrote, which is exactly the per-field-rollback question F-31 exists to
   answer.

Per §7.1's reversibility table, this item is "not cleanly reversible... once website-sourced values
on historical rows have been overwritten," so this staging proof is the gate before any production
cut, not a formality before merge.

## Rollback

Code: revert the commit — `closed-ipo-job.ts`, the `index.ts` wiring, and the feature flag are all
additive and gated by `ENABLE_CLOSED_IPO_JOB`; turning the flag off stops the job immediately.

Schema: the `closed_ipo_resourcing` table can be dropped without touching any other table (it has
no inbound foreign keys from anywhere else) — but its rows are the *only* record of which closed
IPOs were already walked, so dropping it after even one production run means the next run cannot
tell DONE from never-attempted and will re-walk everything. Practically irreversible once populated
on prod, which is why §7.2 calls this item "not cleanly reversible."

Data: any field the walk overwrote on a historical row is rolled back **per field** using
`field_sources.previousValue`/`previousSource` — but only for the *single* most recent overwrite
(F-31's own limit: "holds one prior value"). This is exactly why the pre-walk snapshot above is
load-bearing: past one overwrite, the snapshot — not `field_sources` — is the only path back to the
pre-migration value. **This card does not resolve where that snapshot lives** (flagged as a fork
above); until that fork is resolved, "roll it back per field" is true for the first closed-IPO run
only, not for any run after it.

## Tier, budget and cost

**Tier A** — per the design's own item table (§7.1: "17 | The closed-IPO job (OD-22) ... | A |
medium") and `.claude/rules/defect-fix-contract.md`: this is a scheduled write path over historical
rows on a data-integrity table, not cleanly reversible per §7.2, and it depends on items 6, 7 and 10
landing first. Fresh-context adversarial review, mutation-tested guards on the retry-rule and
cycle-lock-skip logic, 1 round default (2nd only on CRITICAL/MAJOR).

`Budget: 60 min wall-clock, 120 tool calls.`

Cost: medium, per §7.1. Blocked on items 6 (the pull walk), 7 (the scheduler + cycle-lock-skip
rule), and 10 (verification checks) landing first — it is not one of the four items free to start
immediately alongside item 1.

## Rules implemented

<!-- generated by docs/design/apply-rule-ownership.mjs - edits inside this block are overwritten -->

7 rule(s) from `docs/design/rules.json`, generated by
`node docs/design/apply-rule-ownership.mjs --apply` from `rule-ownership.json`.

| Design section | Rule ids |
|---|---|
| §2.9 | R-080 |
| §5.4 | R-116, R-117 |
| §6.1 | R-122, R-123 |
| §6.2 | R-124 |
| §6.5 | R-125 |

## Known gaps

None recorded yet. A finding this item owns but does not close is written here, with its
id and the reason — that is what stops "zero open findings" being reached by dropping one.
