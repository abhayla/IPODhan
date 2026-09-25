# Scope: global

# IST is the project's timezone. Every time a human reads is IST.

version: "1.1.0" (owner approved 2026-09-25, Q4) (owner directive 2026-09-19: "All time zones should be in IST hours... We are in IST
time zone, Indian standard time. So everything should by default be in IST time zone.")

## Why this rule exists

This project is an Indian IPO platform. Every date it publishes — open, close, listing, allotment —
is an Indian market date. Every schedule it runs on is an Indian market schedule. Every reader is in
India. Yet the codebase has been bitten by timezone drift repeatedly, and the same 5h30m keeps
appearing:

- Production scraper timestamps stored 5h30m behind UTC, which read as "the cron is down".
- An ad-hoc `pg.Pool` reading `timestamp` columns as IST, 5h30m early.
- A date filter returning rows whose minimum value was EARLIER than the `>` cutoff that selected
  them — an impossible result, caught only because it was impossible.
- 2026-09-19: an integration fixture wrote `05:00Z` and Postgres stored `10:30:00`, because
  node-postgres serialises a bound `Date` in the process's LOCAL zone. A UTC parser then read that
  wall-clock back AS UTC, making the shift permanent. Two rounds of a worker's time were spent on it.

The drift is never a hard failure. It is always a number that looks plausible and is wrong by
exactly 5h30m.

## The rule

**IST (UTC+05:30) is the default timezone for everything a human reads or decides by.** That means:

1. **Every timestamp shown to a reader or an admin is IST**, labelled as IST where the label fits.
   No UTC on a page, in an email, in a WhatsApp message or on an admin screen.
2. **Every schedule, cron, window and cadence is stated and reasoned about in IST** — the data job
   slots, the staging deploy windows (13:30 and 21:30 IST), the closed-IPO job at 22:00, the
   production deploy window, the market-hours gate. A cron line that runs on a UTC host carries a
   comment naming the IST time it is meant to fire.
3. **Every date the platform publishes is the Indian market date** — open, close, listing, allotment,
   refund, credit. A date is never shifted by a timezone conversion on its way to a page.
4. **Every log line, ledger entry, board stamp, memory line and report is stamped IST**, read from
   the clock at the moment of writing, never computed or guessed.

## Storage is the one exception, and it is deliberate

**Timestamps are STORED in UTC and CONVERTED to IST at the edge.** This is not a contradiction of the
rule above; it is how the rule is kept safely. Storing local time loses information the moment
anything compares two rows, and a naive `timestamp` column holding IST is indistinguishable from one
holding UTC — which is precisely the ambiguity that produced every incident listed above.

So: UTC in the column, IST at every boundary a human touches.

## The mechanics that actually bite (measured, not theoretical)

- **`timestamp` versus `timestamptz`.** Several columns are naive `timestamp`. A `Z`-suffixed literal
  compared against one is silently out by 5h30m.
- **The bind rule is SPLIT by which layer is doing the binding — and the two halves are opposite.**
  - **Raw node-postgres parameters** (a hand-written `sql\`\`` template, or a bare `pool.query(...)`)
    take a **string**. node-postgres serialises a bound `Date` OBJECT in the process's local zone, so
    binding the object shifts a naive `timestamp` column. Bind `date.toISOString()` here.
    Measured 2026-09-19 on `ipodhan_test`: binding the object stored `10:30:00` for a `05:00Z` input;
    binding the ISO string stored `05:00:00`, drift 0.
  - **Drizzle-mapped `timestamp()` columns through the query builder** (`eq`/`gt`/`gte`/`lt`/`lte`/
    `between`/`inArray`, `.set(...)`, `.values(...)`, `onConflictDoUpdate(...)`) take a **`Date`
    object**. Drizzle's own `PgTimestamp.mapToDriverValue` calls `.toISOString()` on whatever value it
    is handed, so passing an already-stringified `.toISOString()` result throws
    `TypeError: value.toISOString is not a function` at query time — a string has no `.toISOString()`
    method. **Never pass a string to a drizzle timestamp operator or write field**; pass the `Date`.
  - **Measured 2026-09-25 (#954):** `/api/ipos/[slug]/demand-graph` returned HTTP 500 for every IPO
    with demand data across 4 prod nights (09-16 through 09-23) because its repository query bound
    `date.toISOString()` into a drizzle `gte()` on a default-mode `timestamp()` column — exactly the
    binding this rule previously told every path to use. Fixed in PR #1069 (bind the `Date`); the
    same class recurred in the #1033 builder's first fix attempt on a `.set()` call (PR #1067, caught
    before merge). Registered as failure class `iso-string-bound-to-drizzle-timestamp`
    (`docs/reviews/failure-classes/iso-string-bound-to-drizzle-timestamp.json`).
  - A drizzle column declared `timestamp(..., { mode: 'string' })` or `date(...)` is unaffected by
    either rule — its driver value already IS a string, so `.toISOString()` is correct there too.
  - The two rules never overlap in one call: a `sql\`\`` template's interpolated value is a raw pg
    parameter (bind the string) even when the template's RESULT is later handed to a drizzle
    comparison; the split is by binding layer, not by which function call it sits inside.
- **A UTC read-parser does not fix a local-time write.** Both halves must agree, or the parser makes
  the drift permanent instead of visible.
- **Every pool needs `options: '-c timezone=UTC'`** AND `configureUtcTimestampParsing()` before the
  first query — web, scraper and every script. One without the other is worse than neither.
- **The VPS journal is IST while runner logs are UTC.** A UTC timestamp queried against the journal
  returns a clean, empty, wrong answer.

## CRITICAL RULES

- MUST show IST to every human surface — reader page, admin screen, log, ledger, board, report.
- MUST state every schedule, window and cadence in IST, and comment the IST intent on any UTC cron.
- MUST store timestamps in UTC and convert at the edge; MUST NOT store local time in a naive column.
- MUST bind `date.toISOString()` (never a `Date` object) to a naive `timestamp` column reached via
  raw node-postgres parameters (`sql\`\`` templates, `pool.query`).
- MUST bind a `Date` object (never a `.toISOString()` string) to a drizzle-mapped default-mode
  `timestamp()` column through the query builder (`eq`/`gt`/`gte`/`lt`/`lte`/`between`/`inArray`,
  `.set()`, `.values()`) — drizzle calls `.toISOString()` itself, so a string throws `TypeError` at
  query time (class `iso-string-bound-to-drizzle-timestamp`, #954). CI check:
  `scripts/ci/check-drizzle-iso-string.mjs`.
- MUST configure every pool with `options: '-c timezone=UTC'` and call
  `configureUtcTimestampParsing()` before its first query.
- MUST verify a timezone claim by round-tripping a known instant and reading back the stored text —
  a value that looks plausible is the failure mode here, so plausibility is not evidence.
- MUST NOT "fix" a drift on one side only. Writer and reader must agree, and the proof is a
  round-trip with drift 0.
