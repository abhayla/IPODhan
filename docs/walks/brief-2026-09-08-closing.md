# Closing brief — session 10, 2026-09-08

Written at session end. The pull-model design continues in a separate session from
`docs/ops/goal-pull-model-design.md`. Live tracker: `docs/ops/work-tracker.md`.

## What changed for users today

- **Steamhouse India shows its lead manager** (Equirus Capital) on the live site. Written through the reviewed
  repair tool with provenance, proven across two real scraper cycles.
- **85 IPOs on production carry correct source records for their price band.** Nothing visible changes for readers;
  the nightly audit stops flagging those rows falsely. Also proven across two cycles.
- **173 SME IPOs can now read their own offer documents.** Enabled on production at 13:3x. Within 90 minutes, three
  SME IPOs had document-sourced fields where the count had been zero, and the overall share of data coming from
  offer documents moved 8.4% to 9.0% with no further intervention.

## What was merged

| Item | What it does |
|---|---|
| #423 | Rentomojo's price-band filing can save. Seven rupee columns widened past Rs 999.99 Cr; a guard refuses an oversized value with a clear message instead of crashing the row. |
| #424 | Qualiance lot-size false alarm fixed. Minimum application is now its own check. The stored lot was not touched. |
| #427 | Lead-manager changes appear immediately instead of up to 15 minutes later. |
| #428 | A scanned advertisement whose rupee symbol was misread by OCR now parses. |
| #420 | Nightly audit findings open GitHub issues automatically, for NEW findings only; the first live night records a baseline and files nothing. |
| #421 | Main branch is re-tested on every code push; documentation commits are skipped. |
| #430 | A saved test page must record where it came from, and a page saved under the wrong company fails the PR. Cause C1. |
| #431 | The offer document outranks every website on the fields it prints. A newer document heals an older one; document types rank PRICE_BAND_AD/CORRIGENDUM > RHP > PROSPECTUS > DRHP. Owner comment O-5. |

## What was caught before it did damage

- **A repair tool would have erased Priority Jewels' real open and close dates** using a note from weeks earlier. The
  IPO has since listed with exactly those dates. Skipped, filed as #422, contract written.
- **The sector feature would have written wrong industries permanently.** Chittorgarh serves pages by numeric id and
  ignores the URL name, so a name collision fetches a different company. Its test also passed against a file saved
  under the wrong company's name. PR #425 is paused by the owner with three findings open.
- **Making the document primary would have made a wrong document value uncorrectable.** Caught in review of #431 and
  fixed before merge: exchanges would have sent the right lot size every cycle forever and lost.

## Honest failures of my own, recorded

1. **I reported T-518 as verified when I had only run it locally.** The pipeline was red, and the new gate had never
   executed there at all. Local green is not proof. Second occurrence of this class in one day.
2. **I told the owner the source priority was why documents supply only 8.4%.** For issue size and lead managers the
   document was ALREADY ranked first. The real cause is throughput: the document path barely runs.
3. **I ran three builders against the owner's cap of two**, because I counted a worker idling on a poll loop as
   finished.
4. **I chose the wrong reading of the owner's money-storage instruction.** I flagged both readings, chose rupees and
   shipped it; he meant crore. Recorded as O-2, unresolved, now folded into the design session.

## Owner comments captured (tracker Part 0)

| # | Subject | Status |
|---|---|---|
| O-1 | Documents should not be re-scraped every 30 minutes | Open, folded into the design |
| O-2 | Store money in crore, not rupees; identify every field | Open, folded into the design |
| O-3 | A failed field must not fail the whole document, and must not retry in a loop | Open, folded into the design |
| O-4 | Why most documents are never extracted | Answered with measurements; fix contracted, not started |
| O-5 | The offer document outranks every website | DONE, merged as #431 |
| O-6 | Switch SME document extraction on for production | DONE, live and producing |
| O-7 | A language model only for the last stretch, strict conditions | Standing constraint |
| O-8 | The write path is push, not pull | Design session created |

## The five root causes

| # | Cause | Status |
|---|---|---|
| C1 | Tests validate data the author invented | Gate merged; 53 existing fixtures unprotected until backfilled (T-523) |
| C2 | Checks compare our data to itself, never to the market | Discussed, not decided |
| C3 | Gates check shape, not substance | Awaiting decision |
| C4 | Signals existed but nobody read them | Fixed yesterday and today |
| C5 | Coverage is counted, not proven | Awaiting decision |

## State at close

- **Production** serves f0c66b6b. **Staging** serves 9db4529d. **35 fixes are on main but not on production.**
- **`release/prod-2026-09-08` is cut at 95b329cc**, has not drifted, and its hosted gate passed. It carries **14 live
  IPOs production cannot currently show**, including two open issues and the National Stock Exchange listing. It
  does NOT carry today's five merges, which were made after the cut was frozen.
- **Tonight's deploy did not run.** The 18:32 staging read, the 20:02 brief and the 20:32 launcher were scheduled
  inside this session and end with it. Nothing is lost; the branch is ready. Rollback reference f9b67d0a.
- Both price-band documents sit at 7 attempts of 10 on staging, due for their own next attempt. The Rentomojo
  document on PRODUCTION will keep failing until the release that carries the column widening ships.
- **176 documents remain unread.** Draining them is the single biggest lever on the 90% target and is contracted
  (T-521) but not started.

## Queued and contracted, none started

T-511 done. Open: T-519 nightly live-parser check · T-521 drain the document backlog · T-523 backfill 53 fixtures ·
T-512 NSE lead-manager detection · T-513 done · T-514 PR-claims-versus-checks CI gate · T-515 stale correction table ·
T-516 shared-package ESM bug · T-517 repair-tool batches · T-508 glyph repair · T-510 integration seed fixture.

Open issues filed today: #422 stale correction table · #426 numeric-guard refusals misclassified · #429 the failure
tracker over-reports.
