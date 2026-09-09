# Walkthrough: FPO — no real IPO reachable, rule untested — 2026-09-09

**This is the one walkthrough with no table**, and the reason is the finding. There is no follow-on
public offer on production, so there is no row to walk. Everything below is measured through the
read-only tunnel by `docs/design/probes/pick-walkthrough-ipos.mjs` (saved output:
`docs/design/probes/pick-walkthrough-ipos.out.json`, generated `2026-09-09T10:16:48.751Z`). Nothing
is typed from memory, and no row is invented to fill the gap.

## The query, and what it returned

> `offering_type = 'FPO'`, ranked by documents on disk

```
candidates_considered : 0
chosen                : null
result                : no real IPO reachable, rule untested
```

**Every offering type actually present on the 330 production rows**, so the zero is a reading of the
whole population rather than of an empty filter:

| `offering_type` | rows |
|---|---:|
| `IPO` | 274 |
| `OFS` | 19 |
| `TENDER` | 16 |
| `RIGHTS` | 8 |
| `NCD` | 7 |
| `INVITS` | 3 |
| `REITS` | 2 |
| `BUYBACK` | 1 |
| **`FPO`** | **0** |
| `IPP` · `QIP` · `PREFERENTIAL` · `BONDS` · `DELISTING` | 0 |

The enum has fourteen values. Eight are populated. `FPO` is one of six that never occur.

§1.11's FPO row already says so — *"**0 today** … The rule is written and not exercised … Because no
row exercises it, it carries a higher risk of being wrong than any other line in this table"* — and
this walk confirms the count rather than quoting it. **That part of the design is honest and holds.**

## What can still be walked without a row: the rules that would fire, and whether they could

A walkthrough that stopped at "no row" would prove nothing. The three rules an FPO would touch are
each checkable against the schema and the spec as they stand today, and two of them do not survive
that check.

### 1. §1.11's FPO rank: written, and unreachable through Appendix A

§1.11 says: *"no draft prospectus stage, so rank 1 is the RHP or prospectus directly; everything else
follows mainboard."*

Appendix A resolves ranks for **three** types — `MAINBOARD`, `SME_BSE`, `SME_NSE`. There is no FPO
column, and the walkthrough generator shows what that means in practice:
`docs/design/probes/walkthrough.mjs` derives the type from the segment alone —

```js
const type = ipo.segment === 'SME'
  ? ((ipo.listing_exchanges || []).includes('NSE') ? 'SME_NSE' : 'SME_BSE')
  : 'MAINBOARD';
```

— so an FPO row would be walked **silently as MAINBOARD**, including the mainboard document ladder
that begins with a `DRHP` the design has just said an FPO does not have. Nothing would report a
mis-resolution; the row would simply be given the wrong plan. This is finding **F-11** ("Appendix A
resolves only 3 of 11 offering types", status `TRIGGERED`) reaching its own trigger — *"any non-IPO
offering type enters the pull loop"* — under a walk rather than under a real row. It stays
`TRIGGERED`, and this walkthrough is the evidence that the trigger is one production row away.

### 2. THE STOP: §2.3.3.2 routes an IPO→FPO to "a new row, linked by `company_id`", and there is no such column

§2.3.3.2's "one row is one offering" table:

| Situation | Rule |
|---|---|
| Same identifier, offering type changes (IPO → FPO, IPO → rights) | **new row**, linked by `company_id` |

Measured against production's own schema on 2026-09-09:

```
company_id column exists anywhere in the database : false
companies / company table exists                  : false
```

`information_schema.columns` has **no `company_id` column on any table**, and
`information_schema.tables` has **no `companies` table**. The rule names a link that cannot be
written. There is no second reading available: `ipos` has no self-referencing column either (the
nearest thing, `ipo_slug_redirects`, records a *merge*, which is the opposite relationship — it says
two rows were one, where this rule needs to say two rows are deliberately separate).

**The question the design cannot answer:** what actually links the FPO row to the IPO row? A new
`companies` table with a CIN key, a nullable self-reference `ipos.related_ipo_id`, or nothing at all
(two unlinked rows and a page that never mentions the earlier issue) are three different products,
and the design picks one by naming a column that does not exist.

This is where the walk stops. **Rule and section named: §2.3.3.2, "One row is one offering (OD-35)",
the IPO→FPO row. Recorded as finding F-105.**

### 3. Continuing past the gap — what does hold

Everything below is provisional on F-105.

**§1.2 row 6 already scopes its window check to FPO correctly.** *"for IPO and FPO
`3 ≤ working_days(open, close) ≤ 10` (SEBI ICDR Reg 46)"* — an FPO is a public issue and the same
regulation governs it, so this is right, and it is right for the reason stated rather than by
inheritance.

**§1.2 row 24 would misfire.** The check on `offering_type` reads *"one of the 14 enum values; `IPO`
requires a DRHP or RHP to exist"*. That is scoped to `IPO`, so an FPO row is not required to have a
draft — consistent with §1.11. But nothing then requires an FPO to have **anything**, so a row typed
`FPO` with no document at all passes the check. On a type with no production instance and therefore no
observed shape, that is the check most likely to let a mis-typed corporate action through — the
Mopshop/Sarda class the same row warns about.

**The rest of §1.11's FPO sentence is untestable, honestly.** *"everything else follows mainboard"*
cannot be confirmed or refuted without a row: an FPO's issue-size components, anchor round, lot
arithmetic and listing-day behaviour are all mainboard-shaped in theory, and no production data
exists to check even one of them.

## What would close this

One production FPO row. Until then the honest status of §1.11's FPO line, of §2.3.3.2's IPO→FPO
route and of Appendix A's missing fourth type is **untested**, and the design should keep saying so —
which, for §1.11, it already does.

---

_Regenerate the selection: `node docs/design/probes/pick-walkthrough-ipos.mjs` (block 4, `fpo` and
`fpo_prerequisites`)._
