# Item 22 — Document handling and download limits (OD-36, OD-37)

## Purpose

Every document download this system makes — from NSE, BSE, SEBI, the registrars, or an issuer's
own site, for any IPO type or slot — is bounded (a host allow-list that now includes the
registrars, a resolved-address check that refuses private/loopback/link-local ranges, a streaming
100 MB cap, the existing two-minute timeout) and fails closed with the cause logged, instead of
buffering an unbounded response into memory and hoping the content is what it claims to be.

## Serves

`docs/design/data-sourcing-pull-model.md` §2.2.1 ("What arrives is not always a clean PDF"),
OD-36 (document handling: multi-part filings, OCR routing, one blank-password attempt, content
sniffed before store, the exchange document id — line 91) and OD-37 (download limits: host
allow-list, private/loopback refusal, 100 MB cap, two-minute timeout, every refusal logged — line
92). §7.1 row 22 (line 2704: "medium — it is the network boundary, and it fails closed", Tier A,
category `download`). §2.981's "download host allow-list ... a new registrar's domain — data,
because `registrars` is a table."

**Correction to the design table, verified this session — most of OD-36 is already built, not
new.** §2.2.1's own "where it stands today" column is stale against the current code (dated
2026-09-09, but the code below is from the T-403/W-90 era, already merged). Three of the five
OD-36 rules and the content-sniff rule are already true; see the Files table and "Already true"
note below each. Only "multi-part per-part extraction with a part number in provenance",
"one blank-password attempt", and "the exchange's own document id" are genuinely new. Building all
ten as if none exist would be a wasted implementation day; this card corrects that before an
engineer starts.

## Files

| Path | State | Change |
|---|---|---|
| `scraper/src/services/document-discovery-runner.ts` | exists | `defaultFetcher` (lines 609–635) — `const body = Buffer.from(await res.arrayBuffer());` (line 619) has no size ceiling during the read: the whole response is buffered into memory before anything can reject it. Rewrite to stream via `res.body` (a `ReadableStream`), counting bytes as chunks arrive, and abort the moment the running total exceeds the cap — so a 2 GB response never fully lands in memory. `DOWNLOAD_TIMEOUT_MS = 120_000` (line 206) — **already true**, no change (confirmed: this is the two-minute timeout OD-37 asks for, already split from the 20 s `FETCH_TIMEOUT_MS` at line 163). `contentType` capture at line 622 — **already true**, no change (feeds `verifyDownload`, see below). |
| `scraper/src/services/document-download-verifier.ts` | exists | `MAX_DOCUMENT_BYTES = 150 * 1024 * 1024` (line 34) — lower to `100 * 1024 * 1024` per the probe measurement (see Interfaces). `verifyDownload()` (lines 274–378) already does content-sniffing before store: HTML-body detection (`looksLikeHtml`, the `html_body` branch at line 285), the `%PDF` magic-byte check (`looksLikePdf`, line 331), the zip magic-byte check (`readUInt32LE(0) === 0x04034b50`, line 313), and `wrong_content_type` (line 294) — **this is "content is sniffed before store" already wired end-to-end**, called from `fetchAndVerify` below and gating every `storeDocument` call. What is new here: (a) a `password_protected` failure reason and the one-blank-attempt rule (see Interfaces), (b) the multi-part-extraction change (a zip with N real PDF members today keeps only the ONE member `selectZipMemberForType` (line 241) chooses — see below), (c) recording the exchange's own document id, which this module never sees (it is upstream, at discovery time). |
| `scraper/src/services/document-discovery-runner.ts` | exists | `fetchAndVerify` (lines 929–999) already calls `verifyDownload` on every fetched body and only proceeds to `storeDocument` on success (`downloadOneCandidate`, lines 1016–1122) — **content-sniff-before-store is already true end-to-end, no change needed here for that rule.** New: `downloadOneCandidate` currently stores exactly one PDF per download (`storeDocument({ ipoId, docType: storedType, pdf: verdict.pdf, ... })`, lines 1063–1069) — for a multi-part filing this must become a loop over every real PDF member the zip carries (not just the one `selectZipMemberForType` currently keeps), storing each with a `partNumber` and writing it into the `field_sources.dataLineage` JSON the extractor will cite from (see Schema/Interfaces). |
| `scraper/src/services/company-host-source.ts` | exists | `TRUSTED_DOCUMENT_HOSTS` (lines 336–340, currently `['bseindia.com', 'nseindia.com', 'sebi.gov.in']`) — **partially true.** NSE, BSE, SEBI are already there; the registrars are not, because they are DATA (the `registrars` table), not a constant this array can hold. `isTrustedDocumentHost` (lines 375–383) — signature changes from a pure string constant lookup to accept an injected registrar-host set (see Interfaces), so the allow-list check stays synchronous and testable rather than doing its own DB read. `PRIVATE_HOST_PATTERNS` (lines 216–233) and `normalizeCompanyUrl` (lines 242–265) — **already true, but narrower than OD-37 asks.** This is a hostname-STRING-pattern block (`/^127\./`, `/^10\./`, `/^192\.168\./`, etc.), applied only to the company-website rung's origin URL (`normalizeCompanyUrl`, called from the company-URL path, not from every document fetch). OD-37 asks for "any **resolved** address" to be refused — a DNS-rebinding-safe check (resolve the hostname, then check the returned IP against the private/loopback/link-local ranges), which this is not: a hostname whose string looks public but resolves to `127.0.0.1` passes today. See Interfaces for the new, narrower function this item adds. |
| `scraper/src/services/document-discovery-runner.ts` | exists | Every fetch call site that reaches `defaultFetcher`/`this.request` (the private `request()` method, lines ~734–775) gets the new resolved-address check inserted before the network call, for every rung — not just the company-website rung `normalizeCompanyUrl` already covers. |
| `packages/shared/src/db/schema.ts` | exists | `documents` table (lines 615–673) gains two columns: `partNumber` (nullable integer, default null = "not a multi-part filing") and `exchangeDocumentId` (nullable varchar) — see Schema. `registrars` table (lines 822–841) already carries `website: text('website')` (line 828) — the column the allow-list extension reads; no schema change to `registrars`. |
| `scraper/src/services/document-classifier.ts` | exists | `isNseRatiosArchiveUrl()` (referenced at `document-download-verifier.ts:325`) is the existing per-archive-type check; the multi-part change adds a general "does this zip's member set look like a multi-volume filing" classifier (NSE's `VOL1_`/`VOL2_` or `Volume I`/`Volume II` naming) so `selectZipMemberForType` (line 241, currently picks ONE member) is only used for the "one filing, multiple candidate names" case it was built for, and a genuinely multi-volume zip is routed to the new per-part loop instead. |
| `scraper/src/services/document-store.ts` | exists | No change. `storeDocument()` (lines 160–204) is called once per part by the new loop in `downloadOneCandidate`; the existing sha256-keyed idempotency (line 171) already makes a re-run of a partially-stored multi-part filing safe with no change. |
| `docs/reviews/detection-checks/document-download-refusals.json` (NEW) | NEW | See Detection. |
| `scraper/tests/unit/services/document-download-verifier.test.ts` | exists | New cases for `password_protected`, the lowered 100 MB cap, and (once the runner change lands) the multi-part loop — see Tests. |
| `scraper/tests/unit/services/company-host-source.test.ts` | exists (assumed; grep this session found the module but not a confirmed test file path — implementer confirms with `grep -rl "isTrustedDocumentHost\|normalizeCompanyUrl" scraper/tests` before assuming a new file is needed) | New cases for the registrar-host allow-list extension and the resolved-address check. |

## Schema

**Two new nullable columns**, `documents` table (`packages/shared/src/db/schema.ts:615-673`):

```ts
export const documents = pgTable(
  'documents',
  {
    // ...existing columns...
    partNumber: integer('part_number'), // NEW — null = single-part document (the default, unchanged case)
    exchangeDocumentId: varchar('exchange_document_id', { length: 255 }), // NEW — NSE/BSE's own stable filing id
  },
  // ...
);
```

Migration SQL (non-destructive `ADD COLUMN`, journal-eligible, matching the style of
`web/drizzle/migrations/0035_add_document_fetch_state.sql`):

```sql
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "part_number" integer;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "exchange_document_id" varchar(255);
```

**No change** to `registrars` (`packages/shared/src/db/schema.ts:822-841`) — `website` (line 828,
`text`) already exists and is what the allow-list extension reads; a registrar with a populated,
active (`active = true`, line 833) `website` column contributes its hostname to the trusted set.
**The design does not say** whether a registrar's website should be validated (reachable, correct
protocol) before being trusted as a download host — this card recommends running it through the
same `normalizeCompanyUrl`-style parse (reject non-http(s), reject a private/loopback host string)
before adding it to the set, so a bad data-entry row in `registrars` cannot smuggle in a host that
fails the private-address rule this same item adds. **Fork, not decided**: whether that rejection
should also flag the registrar row for admin review — the design does not say, left as a follow-up.

**No change** to `field_sources.dataLineage` (jsonb, line 1394) — the part number for a multi-part
citation is written into this existing free-form JSON field (e.g.
`{"method": "SCRAPE", "documentId": "...", "partNumber": 2, "page": 118}`), not a new column,
because `dataLineage` is already the place a citation's "how do I find this" detail lives and
adding a fourth narrow column duplicates it.

## Interfaces

```ts
// scraper/src/services/document-discovery-runner.ts — defaultFetcher, rewritten (line 609)

/**
 * Streams the body, aborting once the running total exceeds `maxBytes`
 * (default 100 MB — see Feature flag) instead of buffering the whole
 * response first. `res.body` is a whatwg ReadableStream on the runtime's
 * `fetch`; a chunk beyond the cap triggers `controller.abort()` and the
 * function returns the same `{ status: 0, ... }` transport-failure shape
 * `defaultFetcher` already returns on a timeout, so no caller needs a new
 * branch for "too big" versus "timed out" — a REFUSAL is recorded either way
 * (see the refusal-logging requirement below, which is the actual gap: today
 * neither failure mode is distinguishable from "the server didn't answer").
 */
export const defaultFetcher: HttpFetcher = async (url, init) => { /* streaming rewrite */ };
```

```ts
// scraper/src/services/company-host-source.ts

/**
 * NEW — replaces the string-pattern-only PRIVATE_HOST_PATTERNS check for the
 * download path specifically. Resolves the hostname (dns.promises.lookup,
 * all=true so both A and AAAA records are checked) and refuses if ANY
 * resolved address falls in a private/loopback/link-local/unique-local
 * range (node:net's isIPv4/isIPv6 plus explicit CIDR checks — no new
 * dependency, node:dns and node:net are both runtime built-ins). This closes
 * the DNS-rebinding gap PRIVATE_HOST_PATTERNS leaves open (a hostname whose
 * STRING looks public but RESOLVES to 127.0.0.1 or a cloud metadata address).
 */
export async function isResolvedAddressPrivate(hostname: string): Promise<boolean>;

/**
 * `isTrustedDocumentHost` (line 375) signature changes to accept an injected
 * registrar-host set, so the pure allow-list check does not do its own DB
 * read (keeps the function synchronous and unit-testable against a byte
 * array of hosts, matching the module's existing PURE style — see
 * document-download-verifier.ts's own header comment on why its functions
 * stay pure).
 */
export function isTrustedDocumentHost(url: string, registrarHosts: ReadonlySet<string>): boolean;

/**
 * NEW. Reads `registrars` where `active = true` and `website` is non-null,
 * parses each through the same reject-non-http(s)/reject-private-string
 * pass `normalizeCompanyUrl` already does, and returns the resulting
 * hostname set. Cached per cycle (the registrar list changes rarely; a
 * per-request DB read for every document fetch is the wrong cost), the same
 * cache-per-cycle pattern `boardCache` already uses on the runner
 * (`document-discovery-runner.ts:643`).
 */
export async function loadRegistrarDocumentHosts(
  db: NodePgDatabase<typeof schema>
): Promise<Set<string>>;
```

```ts
// scraper/src/services/document-download-verifier.ts

export type VerifyFailureReason =
  | 'http_error' | 'html_body' | 'wrong_content_type' | 'too_small' | 'too_large'
  | 'zip_without_pdf' | 'not_a_pdf' | 'wrong_company' | 'unzipped_too_small'
  | 'unreadable_pdf'
  | 'password_protected'; // NEW

/**
 * NEW. One blank-password attempt, no retry. `looksLikePdf` already confirms
 * the %PDF header; this adds a check (via `pdf-lib`'s `PDFDocument.load` with
 * `{ password: '' }` — see Feature flag for why this needs a new dependency,
 * not `pdfplumber`, since this module is TypeScript and pure/network-free by
 * design) — on an encryption exception, fail `password_protected` with the
 * library's own error string as the detail, exactly once, and the document
 * is marked `unreadable` (documents.extractionStatus = 'FAILED',
 * extractionError = the recorded cause) with nothing retrying it on a clock.
 */
```

```ts
// scraper/src/services/document-discovery-runner.ts — downloadOneCandidate, rewritten (line 1016)

/**
 * Today: verifyDownload's zip handling keeps exactly ONE PDF member
 * (selectZipMemberForType, document-download-verifier.ts:241 - NOT the classifier) even when the zip holds several real
 * volumes. NEW: when document-classifier's multi-volume check fires, every
 * real PDF member is verified and stored individually — storeDocument called
 * once per part, each with a `partNumber` (1-indexed, in the member-name
 * order NSE/BSE publish them) and the SAME sha256-idempotency guarantee the
 * single-part path already has. A part number is written into the
 * `documents.partNumber` column and echoed into the extractor's
 * field_sources.dataLineage citation (per Schema) so a field's provenance
 * reads "part 2, page 118", not just "page 118" against an ambiguous
 * multi-hundred-page combined document.
 */
```

## Feature flag

`ENABLE_DOWNLOAD_STREAMING_CAP` (**NEW**, `scraper/src/config/feature-flags.ts`, same
`process.env.ENABLE_DOWNLOAD_STREAMING_CAP === 'true'` pattern as `ENABLE_GMP_NAME_MATCH`, line
67). Default `false` in prod/staging until the streaming rewrite of `defaultFetcher` is proven
against a real large fixture in staging (see Staging proof), `true` in local. **Recommendation,
not the design's** — §2.2.1 states the rule as a hard requirement, not something to gate, but a
rewrite of the fetcher every document download goes through is exactly the kind of change this
project's own rule (`.claude/rules/defect-fix-contract.md`, and the item's own Tier A "fails
closed" mandate) says should ship behind a flag so a defect in the streaming logic itself degrades
to "flag off, old behavior" rather than stopping every document fetch.

`MAX_DOCUMENT_BYTES` — **not a new flag**, an existing exported constant
(`document-download-verifier.ts:34`) lowered from 150 MB to 100 MB in code, overridable via a new
env var `PROSPECTUS_MAX_DOCUMENT_MB` (pattern matching `PROSPECTUS_STORE_MAX_GB`,
`document-store.ts:69`) so the number is a config change, not a redeploy, if the owner wants a
different ceiling.

`ENABLE_DOCUMENT_PASSWORD_CHECK` (**NEW**) — gates the new `pdf-lib`-based blank-password attempt.
Default `false` until the dependency is added and the one real encrypted fixture (§2.2.1's table)
is captured and passes; `true` once proven, since with the flag off an encrypted document simply
fails `not_a_pdf` today (the current, cruder behavior) rather than being correctly classified
`password_protected`.

The multi-part loop and the registrar host-set (both structural changes to already-mandatory
paths, not independently risky the way a fetcher rewrite is) are **not** flagged — they ship
directly, matching how item 18's `compactDocumentStore` reasons about what does versus does not
need a flag: additive new code paths that are inert until their trigger condition (a multi-volume
zip; a registrar row with a website) occurs.

## Tests

Red before the change:

- `scraper/tests/unit/services/document-discovery-runner.test.ts` (existing file assumed — confirm
  path) — a fixture response whose body exceeds 100 MB: today `defaultFetcher` would buffer it
  fully and only `verifyDownload`'s post-hoc `too_large` check rejects it; after the change, the
  stream aborts before the full body is buffered (assert on a byte-counted mock stream that the
  fetcher never accumulates past the cap, not just that the eventual result is a failure — the
  whole point is not fully buffering, and a test that only checks the final verdict would pass
  against the unfixed code too).
- `scraper/tests/unit/services/document-download-verifier.test.ts` — new case: a password-protected
  PDF fixture (see fixture note below) returns `password_protected`, not `not_a_pdf`. New case: a
  fixture just over 100 MB (previously accepted at the old 150 MB ceiling) is now rejected
  `too_large` — this is the one existing-behavior-change case that must be called out in review,
  since it is a stricter cap on already-passing documents, not purely additive.
- `scraper/tests/unit/services/company-host-source.test.ts` — new cases: a registrar host present
  in the injected set passes `isTrustedDocumentHost`; a hostname string that looks public but
  `isResolvedAddressPrivate` reports as resolving to a private range is refused (mock `dns.lookup`
  — no real network call in a unit test); the existing `PRIVATE_HOST_PATTERNS` string-match cases
  stay green unchanged.
- `scraper/tests/unit/services/document-discovery-runner.test.ts` — new case: a zip fixture with
  two real PDF members (a synthetic "Volume I" / "Volume II" fixture, since no real captured
  multi-volume fixture exists yet — see Known gaps) produces two stored `documents` rows with
  `partNumber` 1 and 2, not one row overwriting the other.
- **Fixture needed, not yet in the repo.** A real password-protected filing fixture, per §2.2.1's
  own requirement ("a real encrypted filing, captured as a fixture with its error string") — none
  was captured this session (no network fetch was run). Transcribing/capturing it is the first task
  of implementation, same discipline item 8's card used for its two RATIOS fixtures.
- Tier: unit, per `.claude/rules/scraper-test-layout.md` — these are network/byte-level rules, kept
  with the download path per §2.2.1's own closing line ("these are network rules, and they have to
  fail closed when the network misbehaves, not when a PDF parser does").

## Detection

**NEW check**, `docs/reviews/detection-checks/document-download-refusals.json` (NEW) (id
`document_download_refusals`): reads the per-cycle failure reading (per
`.claude/rules/signal-ownership.md` R1 — refusals resolved to identities, never a bare count) for
every refusal this item adds (`too_large`, `password_protected`, a resolved-private-address
refusal, an untrusted-host refusal) and asserts each carries URL, host and reason — a refusal
missing any of the three fails the check. This directly implements §2.2.1's own line: "every
refusal is logged with URL, host and reason ... a limit that refuses silently is indistinguishable
from a source that has no document." Per `.claude/rules/recurrence-detection-gate.md`, this PR
touches `scraper/src/services/**`, so a detection change is required — this is it.

## Staging proof

Per `.claude/rules/defect-fix-contract.md` item 5:

1. The exact log line: a refused download logs
   `document-download: refused url=<url> host=<host> reason=<reason>` (the new structured refusal
   log this item adds) for at least one real refusal on staging — trigger one deliberately by
   lowering `PROSPECTUS_MAX_DOCUMENT_MB` below the size of a document staging already discovers, so
   the `too_large` path fires within one cycle rather than waiting for a naturally huge filing.
   Healthy value: the line is present, and `url`/`host`/`reason` are all non-empty.
2. A real multi-part filing (the Skyways NSE zip fixture §2.2.1 already names,
   `document-discovery-runner.ts:200`, or an equivalent multi-volume filing found on staging) is
   extracted with both parts stored as separate `documents` rows, and the extraction's citation for
   a field taken from the second part records `partNumber: 2` in `field_sources.dataLineage` —
   confirmed by reading that row after the staging cycle.
3. This is not a data-repair item (no existing row is rewritten; new columns default null on
   existing rows and are populated only going forward), so `scripts/assert-repair-held.mjs` does
   not apply.

## Rollback

Code: revert the commit. `defaultFetcher`'s streaming rewrite sits behind
`ENABLE_DOWNLOAD_STREAMING_CAP`; turning the flag off restores the current buffer-then-check
behavior immediately, with no data implication (the flag only changes when a rejection is decided,
not what gets stored). The password check and multi-part loop are additive; disabling
`ENABLE_DOCUMENT_PASSWORD_CHECK` stops the new check without touching already-classified rows.

**Not cleanly reversible**: a document rejected under the lowered 100 MB cap that would have been
accepted at the old 150 MB ceiling is simply never stored — there is no "data to roll back," but a
revert of the cap does not retroactively fetch what a cycle skipped; the next due cycle picks it up
normally (the document-state machine already re-attempts undone work, per item 18's card on how
`document-cycle.ts` treats a document that has not reached a terminal state). The two new
`documents` columns (`partNumber`, `exchangeDocumentId`) are additive and nullable — reversible by
dropping them, though nothing in this design asks for that.

## Tier, budget and cost

**Tier A** — per the design's own item table (§7.1 row 22, line 2704: "**A** | medium — it is the
network boundary, and it fails closed"). This is the network boundary every document download
crosses; per `.claude/rules/engineering-roles.md`'s review-tier table, Tier A applies to
hook/scheduled work "every session/host" and to anything that must fail closed against untrusted
input — a fresh, adversarial Opus review with mutation tests on every new guard (the resolved-
address check, the size cap, the host allow-list extension) is the gate, not a diff-only pass.

`Budget: 60 min wall-clock, 120 tool calls` (Tier A per `.claude/rules/claude-behavior.md` R10's
budget table: A = 60/120).

Cost: medium — five files touched beyond tests, one new dependency to evaluate (`pdf-lib`, for the
password check only), two schema columns, one new detection check. Two review rounds expected
(Tier A default is one round, second only on CRITICAL/MAJOR — the resolved-address DNS-rebinding
check and the streaming-fetch rewrite are exactly the kind of guard a mutation test is likely to
find a gap in on the first pass).

## Rules implemented

<!-- generated by docs/design/apply-rule-ownership.mjs - edits inside this block are overwritten -->

5 rule(s) from `docs/design/rules.json`, generated by
`node docs/design/apply-rule-ownership.mjs --apply` from `rule-ownership.json`.

| Design section | Rule ids |
|---|---|
| §2.2.1 | R-021, R-023, R-025, R-159, R-160 |

## Known gaps

- **No real multi-part fixture was captured or transcribed this session.** §2.2.1 names the
  Skyways NSE archive (`document-discovery-runner.ts:200`) as the case that set the download
  budget, but that reference is to the budget comment, not a captured fixture file under
  `docs/design/probes/fixtures/`; the unit tests above use a synthetic two-member zip until a real
  one is captured. Finding id: none assigned yet — flag at implementation time if the real fixture
  cannot be reproduced from a live NSE URL.
- **No real password-protected fixture was captured this session** — same gap, for the
  `password_protected` case. §2.2.1 asks for one; none exists in the repo today (verified: no
  encrypted-PDF fixture under `docs/design/probes/fixtures/`).
- **The registrar-host allow-list extension does not validate registrar data quality beyond the
  URL parse this card adds.** A `registrars.website` row that is syntactically valid but points at
  a domain the registrar no longer controls (an expired domain later re-registered by someone
  else) would still be trusted — this item narrows the SSRF surface (private/loopback addresses)
  but does not add domain-reputation or expiry checking. Not asked for by the design; named here so
  it is not silently assumed covered.
- **`isResolvedAddressPrivate` only guards the download path this item touches.** `normalizeCompanyUrl`'s
  existing string-pattern check (`company-host-source.ts:216-233`) still runs first, unchanged, and
  still has the DNS-rebinding gap on paths this item does not touch (any other caller of
  `normalizeCompanyUrl` outside the document-download flow, if one exists — not audited this
  session). Closing that fully is a separate sweep, not this item's scope.
- **The exchange document id's uniqueness/format is not specified by NSE or BSE anywhere this
  session found.** `exchangeDocumentId` is stored as a free-text `varchar`, not validated against a
  known format, because the design does not say NSE and BSE share one id shape (they likely do
  not) — a format-specific validator is a fork for whoever reads the two exchanges' actual HTML/
  JSON payloads for the field.
