# Review round — the pull-model design delta, 2026-09-09

Three independent adversarial reviews of the sections this run changed, all against commit
`fe53792a` on `docs/pull-model-delta`. Each reviewer was told that praise is worthless and that a
finding must cite the sentence it disproves.

| Review | Model | Budget | Findings | Verdict |
|---|---|---|---|---|
| **Domain** — is this design wrong about the Indian IPO market? | `opus` (Why Opus: adversarial domain review of a Tier A design with fuzzy, multi-file scope) | 20 min, 40 tool calls | 11 (1 CRITICAL, 6 MAJOR, 4 MINOR) | **NO — not safe to hand to an implementer**, blocked on finding 1 |
| **Verification** — do the gate's checks assert what their PASS lines claim? | `opus` (Why Opus: mutation-testing the checks that gate a Tier A design) | 20 min, 40 tool calls | 6 attacked, **5 unsound** (3 CRITICAL, 2 MAJOR, 1 MINOR) | 0 of 23 checks proved sound, 5 proved unsound, 18 untested |
| **Engineering** — is this design wrong about our own code? | `sonnet` | 20 min, 40 tool calls | 3 of 48 claims wrong (1 CRITICAL, 2 MINOR) | materially more accurate than the previous round, blocked on one claim |

Every CRITICAL and MAJOR below is fixed in this branch. Each fix names the commit that carries it.

---

## 1. Domain review — 11 findings

The reviewer's central point, and it is the right one: **a validation rule that cannot fail is not a
rule, and a validation rule that fails on correct data is worse than none.** Four of the eleven were
of exactly that shape.

| # | Sev | What was wrong | What it is now | Verified how |
|---|---|---|---|---|
| 1 | **CRITICAL** | §1.11 and §1.2 row 4 stated the SME minimum application as `lot_multiple × lot × floor ≥ ₹1,00,000`. With `lot_multiple = 2` that reduces to `lot × floor ≥ ₹50,000` — **the weak form the same paragraph names as F-66, re-adopted by accident**. And the real threshold moved: SEBI's March-2025 ICDR amendment, implemented by NSE and BSE circulars of 2025-06-18 **effective 2025-07-01**, requires a minimum of **2 lots with an application value above ₹2,00,000**, and replaces "Retail Individual Investor" with "Individual Investor" | Two invariants, stated separately so each can fail: `lot × floor ≥ ₹1,00,000` per lot, and `lot_multiple × lot × floor > ₹2,00,000` per application from 2025-07-01 | Independently searched and confirmed: the 2025-06-18 circulars, effective 2025-07-01, "minimum application size is two lots, valued over Rs 2 lakh" |
| 2 | MAJOR | §1.2 row 14 carried `cap ≤ 1.2 × floor` mainboard and **`≤ 1.4 ×` SME**. There is no 1.4× carve-out — ICDR Reg 30(2)'s 120% cap reaches SME through Chapter IX, and a 40% band would be illegal and would have passed this check. The Dec-2021 **minimum 5% spread** was missing entirely | `1.05 × floor ≤ cap ≤ 1.20 × floor` for **both** segments, fixed-price exempt | Independently searched: 120% cap, 105% minimum spread from December 2021, substantively identical for SME |
| 3 | MAJOR | §1.2 row 7 applied T+3 listing unconditionally. T+3 is mandatory only for issues **opening on or after 2023-12-01** (voluntary from 2023-09-01); before that, T+6. The 22:00 job walks backwards into roughly 200 legacy LISTED rows | Effective-dated, both eras stated | The design's own §5.3 already said so about the same class (F-65); the rule had simply not been scoped |
| 4 | MAJOR | §1.2 row 6 read `3 ≤ working_days(open, close) ≤ 10`. Reg 46 says an issue is **kept open for** at least three working days — an inclusive count. A Monday-open, Wednesday-close IPO is 3 by the regulation and 2 as a difference, so the check false-failed nearly every mainboard IPO. Reg 46 is also the wrong clause for an FPO | `3 ≤ working_days_inclusive(open, close) ≤ 10`, Reg 46 for a public issue and **Reg 140** for an FPO | The design's own saved ICDR fixture already quoted "44(1), 85 and 140" |
| 5 | MAJOR | §2.3.3.2's lapsed-draft rule measured twelve months from the **draft's filing date**. Reg 44(1) runs from the date SEBI **issues observations**, which routinely arrive 3–12 months later | Measured from the observation date, with an explicit "not lapsed, listed as unknown" arm when we do not hold it | The clause the design itself quotes says "from the date of issuance of observations" |
| 6 | MAJOR | §1.11's OFS conclusion leaned on "0 have any document", which is partly our own coverage gap (`filing_date` on 24 of 256 documents), and on "0 have a fresh issue", which is equally true of a 100%-OFS public issue | The inference now rests on the **company names** — Coal India, BHEL, NHPC, IRFC and three PSU banks, every one already listed — and names two decisive tests for the build: a prior listing date or ISIN, and `close = open + 1` for a T/T+1 auction | The reviewer's objection is sound; the counts alone were weaker than the sentence implied |
| 7 | MAJOR | §2.1 asserted that the free NSE/BSE quote endpoints may be republished because they are free to fetch. The licence trigger is **redistribution**, not origin | Withdrawn and recorded as owner fork **O-15**. §2.1 is PROVISIONAL on it | NSE's Data Sharing and Usage Policy and terms of use both address redistribution |
| 8 | MAJOR | §2.5.5's "the final prospectus is terminal" breaks for a fixed-price issue, which has **no RHP**: the prospectus is filed before the issue opens, so it is the FIRST document. Read literally the rule locks every later filing out of ~167 SME rows | Terminal for a **book-built** issue; the baseline for a fixed-price one | Structural, and OD-46's fixed-price walkthrough would have hit it |
| 9 | MINOR | The SME investor category was renamed on 2025-07-01 | Recorded with the rule in §1.11 | Same circulars as finding 1 |
| 10 | MINOR | GMP fetched every 30 minutes with no compliance note, on a site run by a Zerodha Authorised Person | **Not yet written.** Carried as an open item below | — |
| 11 | MINOR | The mainboard lot-value band was tested against the floor; issuers size the lot against the **cap** (Tata Technologies: 30 × ₹500 = ₹15,000 exactly) | Tested against the cap | Arithmetic |

## 2. Verification review — five checks that asserted less than they claimed

This is the most valuable review of the three, because it attacked the things that are supposed to
catch everything else. The reviewer's tally: **0 of 23 checks proved sound, 5 proved unsound, 18
untested.** That is the honest state, and it is worse than "23/23 consistent" sounds.

| # | Sev | Check | The mutation that stayed GREEN | The fix |
|---|---|---|---|---|
| 1 | **CRITICAL** | **D15** evidence ratchet | Set `EVIDENCE_FLOOR = 0` and empty `evidence.json` in the same change → `[PASS] D15  0 of 387 ... (floor 0)`. A floor the same commit may lower is not a floor | The committed floor is read back with `git show HEAD:...` and a **decrease fails on its own**. The PASS line now also names the 315 pairs that carry no evidence and are outside the check |
| 2 | **CRITICAL** | **D16** card paths | `/\bNEW\b/i` over the whole line excused **164 of 352** citations, because prose like "New method" shared the line. A path renamed to `NOT-A-REAL-FILE-xyz.ts` passed | The marker must sit **immediately after** the citation and is case-sensitive; the excused count is printed. 30 real citations gained a proper `(NEW)` |
| 3 | **CRITICAL** | `apply-rule-ownership.mjs` | Stray prose inserted inside the rules block was deleted silently and reported success; its `REFUSED` arm could not fail anything because `process.exit(0)` overrode `process.exitCode = 1` | The block declares itself machine-owned with a marker; the tool refuses to touch a block without it; the exit code is `process.exitCode \|\| 0` |
| 4 | MAJOR | **D18** check roster | Removing the backticks around one id — a pure formatting edit — dropped the roster 17 → 16 and still said PASS | Ids match with or without backticks, and the count is pinned at 17 |
| 5 | MAJOR | **D19** rule ownership | It reads the blocks that `apply-rule-ownership.mjs` writes, and the `R-\d{3}` scan would count "this item does NOT implement R-045" as a claim | Wording corrected; the generator-marker fix (3) is what makes the block trustworthy |
| 6 | MINOR | **D20** encoding | Three literal sequences; walked past `Â lakh`, the commonest mojibake of all | Matches a mojibake lead byte followed by any non-ASCII byte, plus a lone `Â` before whitespace |

**The standing proof.** `docs/design/check-mutations.test.mjs` now applies four of these mutations,
asserts the gate goes RED, restores every file byte-for-byte with an md5 check, and refuses to run
on a dirty tree. **4 caught, 0 missed.** A check that has never been red is not a check — and now
four of them have been, on purpose, and can be again with one command.

## 3. Engineering review — 48 claims checked, 45 held

| # | Sev | What was wrong | What it is now |
|---|---|---|---|
| 1 | **CRITICAL** | §0.5.1 said `decidePurge` "deletes at `close_date + 7 days` — a date that has nothing to do with whether we ever read the file". False: `decidePurge` has had a three-arm read-state rule since T-403 M7 and keeps an unread document until the 30-day hard cap. The section described `isPurgeDue` while citing `decidePurge`'s line | Rewritten. OD-32 now changes **two** things rather than four: the soft window's anchor moves to last-successful-extraction, and the hard cap stops destroying an unread document |
| 2 | MINOR | Item 22's card put `selectZipMemberForType` (line 241) under `document-classifier.ts`, which is 183 lines long | Cited as `document-download-verifier.ts:241`, explicitly not the classifier |
| 3 | MINOR | Item 21's card cited the slug computation at line 104; the statement is at 107 | Corrected |

**What held** is worth recording too, because it is the part that was rebuilt this morning: all six
§2.1 budget constants and the 3 × 30 = 90-minute arithmetic; `decideSupersession` genuinely unwired;
all 13 §2.2.1 document-handling citations; all 13 §2.11 reader-side citations including the
zero-match greps; and `job-cost.mjs`'s arithmetic against its own inputs.

---

## Still open after this round

| Item | Why it is not closed |
|---|---|
| Domain finding 10 — a compliance line beside the grey-market premium | Not written yet. It is one sentence, and it is the owner's wording to approve, not mine to invent |
| 18 of 23 checks untested by mutation | The reviewer had a 40-call budget and spent it on six. The remaining eighteen are **not** known good; they are unexamined, and this document says so rather than rounding up |
| O-14, O-15 | Two owner forks recorded today: what the 19 OFS rows should look like on the site, and whether a delayed exchange quote may be republished |
