# Fixture provenance (T-518)

A test fixture is a saved copy of a real web page/document, committed into the
repo, that tests read instead of the live site. Every fixture data file under
`scraper/tests/fixtures/**` and `scraper/tests/unit/pipeline-stages/fixtures/**`
must carry a sibling `<file>.<ext>.meta.json` recording where it came from and
when — enforced by `scripts/ci/require-fixture-provenance.mjs` (wired into
`pr-gate.yml`).

## Why a sibling `.meta.json` and not a leading comment

Either a leading HTML/JS comment or a sibling meta file would work in
principle. This repo uses the sibling file because it applies uniformly to
every fixture type actually in use here (HTML, JSON, TXT, PNG) without
touching a single byte of the fixture itself — several fixtures are read with
exact-content assertions (`JSON.parse`, raw string compares, a PNG decoded by
an OCR pipeline) that a leading comment token would silently break.

## Shape

```json
{
  "sourceUrl": "https://www.chittorgarh.com/ipo/modern-diagnostic-ipo/2276/",
  "capturedAt": "2026-08-01",
  "ipoId": "modern-diagnostic",
  "company": "Modern Diagnostic"
}
```

- `sourceUrl` (required) — the live URL the fixture was captured from, or the
  `document-store` path it was copied from
  (`/var/www/ipodhan/shared/prospectus/<slot>/<ipoId>/<TYPE>-<sha8>.pdf`), or
  `"n/a — hand-authored TDD fixture, no live capture (<reason>)"` for a
  fixture that was never a real page (e.g. a synthetic edge-case JSON blob).
- `capturedAt` (required) — `YYYY-MM-DD`, the date the page was captured (or
  the date the fixture was authored, for a synthetic fixture).
- `ipoId` (optional) — the IPO this fixture belongs to, when one applies.
- `company` (required unless `pageType: true`) — the company this fixture is
  *about*. For an HTML fixture this is cross-checked against the page's own
  `<title>`/`<h1>` (see below) — this is the check that would have caught
  PR #425's `vikran-engineering-cg-detail.html`, whose own `<title>` read
  "Neochem Bio IPO...".
- `pageType: true` — set this INSTEAD of `company` when the fixture is a
  generic page-type sample with no single company (e.g.
  `sebi-drhp-listing.html`, `sebi-rhp-listing.html`,
  `sebi-drhp-search-match.html`, `bse-debt-issue-detail.html`). The identity
  check below does not apply to these.

## The identity check (HTML fixtures only)

The gate derives what company the **filename** claims by stripping a
whitelist of known source/page-type tokens (`bse`, `nse`, `sebi`,
`chittorgarh`, `drhp`, `rhp`, `detail`, `listing`, `search`, `match`, `debt`,
`issue`, `rights`, `mainboard`, `report`, `page`, `form`, `cover`, …) from the
FRONT and BACK of the hyphen-split basename — never from the middle, so a
company name that happens to contain one of those words stays intact (e.g.
`chittorgarh-modern-diagnostic-detail.html` → `modern diagnostic`, not
`modern`). An unrecognized token is always assumed to be part of the company
name — the rule is a whitelist, not a blacklist, so it fails toward checking
more fixtures rather than silently skipping one that does name a company.

If that leaves no tokens (`sebi-drhp-listing` → `sebi`, `drhp`, `listing` all
stripped → nothing left), the filename is judged to name a page type, not a
company, and the identity check is skipped — this must line up with
`pageType: true` in the meta file.

If the filename DOES claim a company, and the HTML has an extractable
`<title>` or `<h1>` (a partial-page snippet fixture with neither is left
unchecked here — it still needs `sourceUrl`/`capturedAt`), the gate extracts
the embedded company name and compares it against the filename's claim using
`normalizeCompanyNameForMatching` (ported at
`scripts/lib/normalize-company-name.mjs`, parity-tested against the real
`packages/shared/src/utils/company-name-normalizer.ts`). A match is exact OR
either name containing the other (filenames are often abbreviated — `esds` vs
`ESDS Software Solution Limited`). A mismatch fails the gate and prints BOTH
names.

## Backfill (day 1)

The 52 fixtures that predate this gate are listed in
`config/fixture-provenance-baseline.json` — a **shrink-only** allowlist,
exactly like `config/write-ratchet-baseline.json` (T-316): an entry may be
REMOVED once that fixture gains a real `.meta.json` (and passes the identity
check, if HTML); a NEW entry can never be added. Regenerate only when
removing entries: `node scripts/ci/require-fixture-provenance.mjs --update`.

Three of the backfilled fixtures (`bse-debt-issue-detail.html`,
`bse-mainboard-acqdisp.html`, `bse-rights-issue-detail.html`) are hand-typed
1.8–2.2 KB snippets last touched 2025-10-18. Re-capturing them from the live
BSE site is **out of scope for T-518** — sized as a follow-up (see the PR
body).

## Scope of the identity check (round 2 review, MAJOR 5)

The identity check (filename/meta.company vs page content) runs for **HTML
fixtures only**. JSON/TXT fixtures get NO identity check — explicitly, not
silently: the shapes vary too much (raw scraper API payloads, extracted-text
snippets, PDF page dumps) for a generic "does this contain the claimed
company name" rule to be reliable without a real per-shape parser for each
one, which is out of scope for T-518. `checkFixture()` still requires
`sourceUrl`/`capturedAt`/`company` for these and reports the skip (with
reason) in the gate's summary, same as it does for PNG (genuinely out of
reach — no text to read at all). A future task that wants identity checking
for a specific JSON shape (e.g. the NSE `ipo-detail-*.json` fixtures, which
do carry a `companyName` field) should add a shape-specific check, not widen
this generic one.

## Creating a new fixture

Never hand-save a page again. Use
`node scripts/create-fixture-from-capture.mjs` (see its `--help`) — it writes
the fixture AND its `.meta.json` in one step, from either a local file (e.g.
a path copied out of the scraper's `document-store`) or a live URL fetch.
