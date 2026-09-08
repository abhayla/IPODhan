# Goal prompt — IPODhan data-sourcing redesign (DESIGN ONLY)

Copy everything between the lines into a fresh Claude Code session started in `D:\Abhay\Ventures\IPODhan`.

---

DESIGN-ONLY TASK. Write no implementation code and open no pull request that changes behaviour. The single
deliverable is a design document that Abhay reads and approves. Stop at that gate. If you find yourself editing a
file under `scraper/src`, `web/`, or `packages/shared/src`, you have gone out of scope.

## What you are designing

IPODhan publishes IPO data scraped from several places. Today the write path is a PUSH model: each scraper wakes on
its own schedule, scrapes whatever it can see, and calls
`DataConsolidationOrchestrator.consolidatedUpsertIPO(scrapedIPO, source, confidence)` with exactly ONE source at a
time. That function compares the arriving value against the stored one, looks both sources up in
`scraper/src/config/field-priority-matrix.ts`, and keeps the higher-ranked one
(`scraper/src/services/data-consolidation-service.ts`, around line 1909, reason `SOURCE_PRIORITY`).

The consequence, measured on production on 2026-09-08: the priority list is only a TIE-BREAKER between sources that
both happened to arrive. The offer document is already ranked first for issue size, and it still supplied that value
4 times against the websites' 277. The websites do not win an argument. They win by being the only source that
showed up.

Abhay's requirement, in his words: "almost ninety percent of our data should come from the offer documents. These
are the primary source. All those websites are only for verification. They are not the source of the data."

So you are designing a PULL model:

> For each IPO, walk every published field. Take that field from its rank-1 source. If rank 1 cannot supply it, fall
> back to rank 2, then rank 3. In every case, verify the resulting value against the other sources. When a
> verification source disagrees, go BACK to that IPO's own offer document and re-read that specific value, rather
> than adopting the other source's number or silently leaving the disagreement.

## Read these first, in this order

1. `docs/ops/work-tracker.md` — the living tracker. Part 0 holds Abhay's comments O-1 to O-8 with the evidence behind
   each. O-8 is this task's origin and states the push-versus-pull finding with file references.
2. `docs/reviews/wp-c-extraction-contract.md` — the existing extraction contract. Its table already names, per field
   group A to F, which document and which section the value lives in, how it is read, and the arithmetic check it
   must pass. This is your starting point for the field mapping; do not reinvent it.
3. `scraper/src/config/field-priority-matrix.ts` — today's per-field source list, including the changes merged on
   2026-09-08 (the offer document now outranks websites on the fields it prints, a newer document can heal an older
   one, and document types rank PRICE_BAND_AD/CORRIGENDUM > RHP > PROSPECTUS > DRHP).
4. `scraper/src/services/data-consolidation-service.ts` and `data-consolidation-orchestrator.ts` — the current write
   path you are replacing.
5. `.claude/rules/defect-fix-contract.md` and `.claude/rules/signal-ownership.md` — how this project defines proof.
6. `docs/walks/2026-09-02-deepa-pipeline-walk.md` — the running ledger; the 2026-09-08 lines carry today's findings.

## Facts established on 2026-09-08 — use these, do not re-derive them wrongly

- Offer documents supply **557 of 6,602** provenance records on production, **8.4%**, rising through the day to
  **9.0%** after SME extraction was switched on.
- Field by field: issue size 4 from documents against 277 from websites; price band 2 against 337; lot size 2
  against 209; lead managers 1 against 288; registrar 1 against 288. Every one of those is printed in the filing.
- **172 stored documents are unextracted**, for three distinct reasons: five document types have no extractor at all
  (78 documents — ratio/basis-for-offer-price, security parameters, sample forms, bidding centres, basis of
  allotment); the per-cycle budget is 3 filings plus 1 anchor, so 94 documents of types the extractor DOES
  understand never drain; and a 10-minute extraction cap that large scanned documents exceed.
- **173 SME IPOs on production had zero document-sourced fields** until the switch was enabled on 2026-09-08.
- The runtime PDF store is already one folder per IPO:
  `/var/www/ipodhan/shared/prospectus/<slot>/<ipoId>/<TYPE>-<sha8>.pdf`, purged 7 days after close with a 30-day and
  5 GB ceiling. Database rows and everything extracted are kept.
- Verification against other websites happens only in a nightly audit, over 3 fields, with no path back into the
  data. There is no re-read loop today.

## Step 1 — establish the type and field inventory yourself

Read-only, through the tunnel (start it if the port is down; recipe in `docs/ops/prod-ops-recipes.md` §1):

```
PW=$(grep "^IPODHAN_APP_DB_PASSWORD=" D:/Abhay/GLOBAL.env | cut -d= -f2- | tr -d '"\r')
DATABASE_URL="postgresql://ipodhan_app:${PW}@localhost:15432/ipodhan"
```

Establish, with real counts: every distinct `offering_type` and `segment` combination on production; how SME on NSE
is distinguished from SME on BSE in the data; and the complete list of fields the site actually publishes (start
from `packages/shared/src/db/schema.ts` and the API responses, not from the matrix, so a field the matrix forgot
still appears). Report the counts before designing anything.

## Deliverables — one design document at `docs/design/data-sourcing-pull-model.md`

**1. The field mapping.** Every published field, roughly 60 to 80 of them. One ranking per field, priorities **1, 2
and 3**, with per-IPO-type exceptions written as named exceptions against that field rather than a duplicated grid.
Per field, state:

- rank 1, rank 2, rank 3 sources, and why that order
- the unit the value is stored in, and whether it should change (see O-2 below)
- which document and which section supplies it, when a document does
- the arithmetic or plausibility check that must pass before it is written
- the verification source and what a disagreement means
- exceptions by type, and the reason for each

Cover **all IPO types**: mainboard, SME on NSE, SME on BSE, follow-on public offers, and anything else the step-1
inventory turns up. The known exceptions to capture: an NSE SME IPO has no BSE payload so BSE cannot be its rank 2;
a follow-on offer has no draft prospectus stage; SME minimum application is 2 lots since SEBI's 2025 rule, which is
what caused the Qualiance false alarm; and the timeline dates deliberately keep the exchanges above the document,
because a printed advertisement is never reissued when a bidding window is extended.

**2. The pull loop.** How the per-IPO, per-field walk actually runs: what triggers it, in what order, how it knows a
rank-1 source cannot supply a field, how it falls back, and what it does when all three fail. Include how it
interacts with the existing document state machine and extraction budgets rather than bypassing them.

**3. The re-read loop.** When a verification source disagrees, exactly what happens: which document is re-read,
which value is re-extracted, how many times, what stops it looping, and what is recorded when the document and the
verification source still disagree after a re-read. A disagreement that cannot be resolved must end somewhere
visible, not in silence.

**4. A verification model for every step.** For each step of the pull loop and the re-read loop, state how we will
know it worked: the check, where its result is recorded, what a healthy value looks like, and what alarms. Today's
lesson, which cost us hours: a check that counts all-time rows can never alarm on a collapse, and a green local test
run is not proof.

**5. The answers to the open comments**, folded into the design rather than left as separate decisions:

- **O-1 scrape cadence.** Abhay: documents should not be re-scraped every thirty minutes; we agreed to change the
  frequency and it looks unimplemented. Established: the process still wakes every 30 minutes; source DISCOVERY
  already runs only at 08:30, 11:00, 14:00 and 17:30 IST under `ENABLE_DUE_STEP_SCHEDULER`, which is on in both
  environments; document PROCESSING still walks the queue every wake, gated per document by a backoff of 15 minutes
  doubling to a 6-hour cap. The design must state when the pull runs and why.
- **O-2 store money in crore, not rupees.** Abhay wants amounts stored as 999.99 rather than 9,999,999,999.99, and
  every affected field identified. Note the schema ALREADY mixes units: `financial_data` stores crore and says so;
  `ipos.issue_size` stores rupees and says so. Two tables, two units, one mistake away from being wrong by a factor
  of ten million. The mapping's unit column is where this is answered, per field, including which fields must NOT
  change (per-share prices, percentages, subscription multiples, share counts).
- **O-3 a failed field must not fail the whole document, and must not retry in a loop.** Abhay: "Keep that field
  blank, and get that field from other sources. There is no need to keep trying for the same field again and again
  and going into a loop of errors." Today one over-wide value rejected an entire insert of more than forty fields
  for Rentomojo, discarding lead managers, dates, registrar and ISIN, and the same 1 MB PDF was re-extracted seven
  times. The pull model's fallback rule is the answer; design it explicitly.
- **O-4 the unextracted backlog** — the three causes above; say how the pull model drains it without starving a live
  IPO behind history.
- **O-5 the document outranks websites** — merged on 2026-09-08; the design inherits it and says what remains.
- **O-7 language model, last stretch only, strict conditions** — a constraint the design obeys, not work to plan
  here. The conditions Abhay set: the model never writes a value, it proposes one with the page number and the exact
  sentence it read; every existing arithmetic check must still pass; a website disagreement sends it back to the
  document rather than to the website's number; model-sourced values are marked in provenance so their accuracy can
  be measured separately and switched off; deterministic extraction is always tried first. State per field in the
  mapping whether deterministic extraction suffices or a model is genuinely needed, and why.

**6. A migration path.** Today's data is 91% website-sourced. Say how existing rows get re-sourced from their own
documents, in what order, proven on staging first, and what could go wrong. Note the precondition already
established: a re-extraction must pass a real document type, or the document-type ranking degrades to
newest-write-wins and an old draft could overwrite a final price band advertisement.

**7. Cost, risk and sequence.** What this takes, in what order, what breaks if each part is wrong, and what is
reversible. Be honest about the parts you are unsure of.

## How to work

- **Confidence gate.** Do not proceed below 95% confidence about what is being asked. Ask ONE question at a time,
  each with your recommendation and a one-line reason. This applies to design decisions too.
- **Every claim is measured, not assumed.** If you state a number, run the query or read the file first and say
  where it came from. Several conclusions today were wrong because a number was carried forward without checking:
  a percentage taken from a stale file, a test baseline measured in a worktree with an uncompiled package, a
  failure reported as ongoing that had stopped nine hours earlier.
- **Send Abhay a plain-language update every 30 minutes**, saying what moved, each item's previous versus current
  percentage, what is running, and what needs his decision. Keep it short and free of internal identifiers.
- **Keep `docs/ops/work-tracker.md` current** and append new comments from Abhay to its Part 0 list as they come.
  Append a dated line to `docs/walks/2026-09-02-deepa-pipeline-walk.md` for anything material, with the timestamp
  taken from `date` in the same command, never estimated.
- **Standing rules that still apply:** the VPS is production and read-only to you; database reads through the tunnel
  are SELECT only; never touch anything under any `node_modules` directory; work in a worktree created by
  `wt-new.ps1` and removed by `wt-rm.ps1`; no `git stash`; never pass `--delete-branch` in a merge command; kill
  processes by PID only; one production deploy per day in the 21:00 to 23:30 IST window and never without Abhay's
  explicit word.

## Definition of done

`docs/design/data-sourcing-pull-model.md` exists and contains: the complete field mapping with priorities 1 to 3 and
per-type exceptions; the pull loop; the re-read loop; a verification model for every step; the answers to O-1, O-2,
O-3 and O-4 folded in; the migration path; and the cost, risk and sequence. Abhay has read it and said it is right.

Then stop. Implementation is a separate decision he will make after reading it.

---
