---
name: offer-document-staging-test
description: >
  Runs the owner's offer-document extraction test on staging for one IPO: takes its offer documents one at a
  time in filing order (DRHP, RHP, price band advert, PROSPECTUS), lists every field the document actually
  prints, compares it with what staging SAVED from that document, classifies each field (correct / wrong /
  missed / not printed), finds the cause of each miss and fixes it generically for all IPOs, proven on staging.
  Use when the owner says "test the offer document", "what can you extract from the RHP/DRHP", "next round of
  document testing", "doc extraction test", or names an IPO and a document to check. Not for website or exchange
  scrapers (field-plan walk fetchers), and not for production.
type: workflow
allowed-tools: "Bash Read Write Edit Grep Glob Agent Skill Artifact AskUserQuestion"
argument-hint: "[ipo-slug] [--doc <document-id>] (default: resume the round in references/progress.md)"
version: "1.0.0"
lessons_folded: 2026-10-03
private: false
---

# Offer-document extraction test on staging

The owner set this process on 2026-10-03, one question at a time. It is fixed. Do not ask the owner these
questions again, and do not offer other ways to run the test. A change only comes from the owner and is
written into "The owner's contract" below in the same turn, with the date.

## The owner's contract (do not re-ask)

| # | Decision | Owner's words / choice (2026-10-03) |
|---|---|---|
| C1 | Subject: one IPO per round (first round: NSE's own IPO, `national-stock-exchange-of-india-ltd`). | "NSE's own IPO" |
| C2 | Fixes are GENERIC: they must fix the class for every IPO, never only this company. | "all the fixes should be done generically so that that applies ... for all the IPOs not only for this company" |
| C3 | Field scope: every field `scraper/config/field-manifest.json` lists DOC for (163 of 176 in 14 tables on 2026-10-03; recount each round, never hard-code). | "All 163 fields" |
| C4 | One document at a time, the one that came first first: DRHP, then RHP, then price band advert, then PROSPECTUS (addenda and corrigenda in their filing place). Finish one document before the next. | "one document at a time ... the document which came first should be scanned first" |
| C5 | Per document: what was expected, what is actually present in the document, what we extracted right. "Expected" is judged per document type: a field the document does not print is "not printed", never "missed". | owner's process, confirmed |
| C6 | "Extracted" means the value SAVED IN THE DATABASE from that document. Nothing from websites or exchanges counts. Read by the extractor but not saved = missed, cause "read but not saved". | "Actual data from the database that you extracted and saved there. No other source" |
| C7 | The database is STAGING ONLY (`ipodhan_staging`). Not the test DB, never production. | "Staging only" |
| C8 | Each fix is proven on the subject document plus at least two other real documents of the same type (one other mainboard, one SME). | assistant recommendation, owner accepted the process |
| C9 | Report: short summary in chat (counts plus top causes) and the full field table on one Artifact page, updated in place after each document. | assistant default, reversible |

Standing rules that also apply (read, not repeated here): `.claude/rules/defect-fix-contract.md` (six items per
fix), `.claude/rules/staging-is-the-release-gate.md` (OD-146: nothing to production), `.claude/rules/
spec-verified-recommendations.md` (spec first; every proven finding gets an F-id), the global "VPS is production"
rule (no ad-hoc runs on the VPS host; staging is read through the DB tunnel and its logs).

## Prerequisites

| Class | Item | Check |
|---|---|---|
| Tools | node, python (for `scraper/scripts/extract_filing.py`), gh, git | `node -v && python --version && gh auth status` |
| Connectivity | DB tunnel to the DB host on `localhost:15432` | `bash scripts/ops/db-tunnel.sh status` (start with `start`; never as a harness background task) |
| Credentials | `IPODHAN_APP_DB_PASSWORD` in `D:/Abhay/GLOBAL.env`, passed to scripts as env `DATABASE_PASSWORD` (with DATABASE_HOST/PORT/NAME/USER; the script uses the shared `createUtcPool` and refuses any DB but `ipodhan_staging`); never printed, never put in a URL that is printed | `grep -c "^IPODHAN_APP_DB_PASSWORD=" D:/Abhay/GLOBAL.env` = 1 |
| Files | the manifest; `references/progress.md` (round state); `references/lessons.md` | file exists |
| User inputs | none beyond C1's IPO slug. If the owner names no IPO, resume `references/progress.md`. | - |

## STEP 0: Preflight

Run every check in the table in one go. List ALL failures together, fix what can be fixed (start the tunnel),
and only then go on. Read `references/lessons.md` and `references/progress.md` in full: they hold what earlier
rounds learned and where the last round stopped.

## STEP 1: List the IPO's documents in test order

```bash
export DATABASE_HOST=localhost DATABASE_PORT=15432 DATABASE_NAME=ipodhan_staging DATABASE_USER=ipodhan_app
export DATABASE_PASSWORD=$(grep "^IPODHAN_APP_DB_PASSWORD=" D:/Abhay/GLOBAL.env | cut -d= -f2- | tr -d '"\r')
node .claude/skills/offer-document-staging-test/scripts/measure-doc-saved.mjs <ipo-slug>
```

Offer documents are marked `*`. Pick the first one not marked DONE in `references/progress.md`. If an
expected type is missing on staging (e.g. no PROSPECTUS row), that is a finding: record why (fetch blocked,
never discovered) and go on to the next document.

## STEP 2: Get the PDF once, and build the ground truth from the PDF itself

- Cache: `D:/Abhay/Ventures/IPODhan-doc-cache/<ipo-slug>/<TYPE>-<document-id>.pdf` (outside every repo). Download only
  if the file is not already there (owner: "you don't have to download it each time").
- For every C3 field, read the document and record: printed? (yes/no), page, exact value as printed. This list is
  the TRUTH and is never taken from the database or a website.
- Save it as a fixture in the repo: `scraper/tests/fixtures/offer-doc-truth/<ipo-slug>-<type>.json`. Every fix is
  tested against it, so the owner's check stays a permanent test.

## STEP 3: Measure what staging saved from this document

```bash
node .claude/skills/offer-document-staging-test/scripts/measure-doc-saved.mjs <ipo-slug> --doc <id> --json <scratch>/saved.json
```

It reads (read-only):
- **This document's own record**: `document_field_receipts` (OD-91: "each document's extraction writes a per-document
  record of the fields it produced"). This is the primary measure for C6. Today it covers only `ipos` and `ipo_details`.
- **Shown values it still owns**: `field_sources` rows whose `data_lineage.documentId` is this document. A later
  document replacing an earlier one's value is correct (OD-30), so an old DRHP owning few shown values is not a miss.
- **Unattributable values**: document-path rows with no document id. Never count them for any document.
NEVER match on `field_sources.source`: every filing type saves as `DRHP` (filing-persister.ts SOURCE ENUM NOTE).
A child-table field the document prints but that has no receipt is MISSED with cause "no per-document record" (OD-91 gap).

Then read the saved values themselves from the owning tables (e.g. `ipo_intermediaries` rows for the IPO) and
compare them with the truth from STEP 2.

## STEP 4: Classify every field

One row per C3 field, exactly one status:

| Status | Meaning |
|---|---|
| CORRECT | the document prints it, and staging saved the same value from this document |
| WRONG | the document prints it, and staging saved a different value from this document |
| MISSED | the document prints it, and nothing from this document was saved (cause says "not read" or "read but not saved") |
| NOT PRINTED | this document does not print it (e.g. a DRHP has no price band, lot size or dates) |

For each WRONG and MISSED field, find the cause in the code (extractor reader, persister, walk DOC fetcher,
mapping). Group the fields by cause. One cause usually explains many fields.

## STEP 5: Report to the owner

In chat: counts per status, the top causes (with the number of fields each one explains), and what is next.
On the Artifact page: the full table (field | printed? page | value in the document | value saved | status |
cause). Publish to the SAME URL every round (the URL is kept in `references/progress.md`).

## STEP 6: Fix each cause generically

For each cause, apply the defect-fix contract: RCA, Class, failing test first on the real function with the real
PDF text as fixture, a class-level fix, proof on 3 documents of the type (C8), and a detection line. Spec first:
grep `docs/design/data-sourcing-pull-model.md` by the field names. If a fix needs a behaviour the spec does not
state, that is an owner question (SPEC CHANGE label), not a builder's guess.
Builders work in a worktree (`wt-new.ps1`); route models per the global rules (`model` and `Budget:` on every
Agent brief). Bundle all fixes for ONE document into one merge batch, because staging rounds are scarce (C7).

## STEP 7: Prove on staging, then mark the document done

Merge the batch, then deploy staging (window 13:30 / 21:30 IST, or the manual button, max 2 per day).
Re-extract the document on staging with the productized tool (`scraper/scripts/reset-document.ts`, dry run
first; see `docs/ops/reset-document.md`), wait for the cycle, and re-run STEP 3 and STEP 4. The document is DONE
when every printed field is CORRECT, or each remaining miss has an issue number and a reason. Record the
before/after counts in `references/progress.md`, then go to the next document (C4).

## STEP 8: Record findings and learn

- Every proven finding gets an F-id in `docs/design/findings.json` and, for a defect class, a file under
  `docs/reviews/failure-classes/` (same turn it is proven).
- Reference Completeness Check: anything this round taught that a next round must know (a query trap, a
  layout, a cause) is FOLDED into the step it changes AND logged in `references/lessons.md` (with date and
  evidence) and `references/CHANGELOG.jsonl`. Bump `lessons_folded`. Read `references/self-update-protocol.md`.
  An owner correction of the process updates "The owner's contract" table first.

## MUST DO

- Treat the contract table as answered. Ask the owner only what it does not cover. — Why: the owner made this skill so as "not to repeat all this information".
- Count a field as extracted only when staging SAVED it from this document. — Why: C6; an extractor that reads a value which is never saved fixes nothing on the site.
- Build the truth from the PDF, with page numbers. — Why: comparing against the DB or a website hides fields the document prints but nobody saved.
- Prove every fix on 3 real documents of the type. — Why: C2/C8; a rule drawn from two samples has broken repeatedly in this repo.
- Recount the C3 field list from the manifest each round. — Why: the manifest changes; a hard-coded 163 goes stale.

## MUST NOT DO

- MUST NOT read or write production, and MUST NOT run anything on the VPS host. Read staging through the tunnel only. — Why: owner rules (OD-146, "VPS is production").
- MUST NOT hand-edit staging rows to make a field CORRECT. Fix the code and re-extract with the productized tool. — Why: a hand fix proves nothing for the next IPO.
- MUST NOT call a field MISSED when the document does not print it. Mark it NOT PRINTED. — Why: C5; chasing fields that were never in the file wastes rounds.
- MUST NOT move to the next document while the current one has unclassified fields or unexplained misses. — Why: C4.
- MUST NOT print the DB password or a connection URL. Pass it as env `DATABASE_PASSWORD`. — Why: a builder once printed a superuser password into a log.
