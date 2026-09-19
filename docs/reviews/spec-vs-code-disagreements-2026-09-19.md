# Where the spec and the code disagree — verified 2026-09-19

An audit of the 22 items in `docs/design/data-sourcing-pull-model.md` §7.1 reported four
places where the spec and the implementation disagreed. Each was then verified individually
against `origin/main` (`b12c9d2`), the live staging database, and the running VPS.

**Three of the four audit claims were wrong.** One disagreement is real, and it is worse than
the audit described. Verifying the other three produced findings the audit did not have.

This document is in two parts:

- **Part A** — the four findings, what is actually true, and what to do about each.
- **Part B** — spec lines that were true when written and now read as current. They are what
  caused two of the three false findings, and they will cause the next reader the same trouble.

---

## Part A — the four findings

### 1. Item 19, the merge tool — AUDIT WRONG; the spec is stale, and the real debt is elsewhere

**The claim.** The spec names `scripts/merge-duplicate-ipo.mjs`, that file does not exist, the
real tool is `scraper/scripts/merge-duplicate-ipos.ts`, and anyone working from the spec would
be misled by the name.

**What is true.** The spec did not misname anything. §8.3 explicitly documents both tools and
the difference between them:

> *"**And there are TWO merge tools, which the item-19 card found by reading rather than by
> assuming.** `scripts/merge-duplicate-ipo.mjs` is the singular, owner-run one that item 19
> targets… `scraper/scripts/merge-duplicate-ipos.ts` (plural) is an older automatic clustering
> tool which **also** writes raw SQL to `ipos` and is **already in the ratchet baseline** —
> grandfathered before that rule existed. It is out of item 19's scope."*

The singular file is absent because it was **deleted**, and the work item 19 describes was
**already done**:

- `e13cf37a` — *"chore(design): drop the superseded raw-SQL merge script; main carries the routed tool (#433)"*
- `5d25974b` — *"fix(scripts): route the duplicate-IPO merge tool through the shared repository"*
- PR #432 — state **MERGED**

So §8.3's "pr-gate is red on PR #432, item 19 is the unblocker, and the merge order is yours to
choose" describes a situation resolved weeks ago.

**The real debt, which the spec itself predicted.** The surviving plural tool still writes raw
SQL against the core table:

```
scraper/scripts/merge-duplicate-ipos.ts:234   UPDATE ipos SET ${col} = dup.${col} FROM ipos dup
scraper/scripts/merge-duplicate-ipos.ts:260   DELETE FROM ipos WHERE id = '${id}'
scraper/scripts/merge-duplicate-ipos.ts:243   DELETE FROM gmp_records d WHERE ...
```

and is still grandfathered at `config/write-ratchet-baseline.json:97`. The spec's own words:
*"the honest reading is that the project owes a second routing job, not that the second tool is
fine."*

**Plan.**

| Step | What |
|---|---|
| A1 | Mark item 19 **DONE** in §7.1 and replace §8.3's merge-order passage with the outcome (see Part B). |
| A2 | Open the follow-on the spec named: route `merge-duplicate-ipos.ts` through `consolidatedUpsertIPO`, then remove its entry from the ratchet baseline. The baseline is shrink-only, so removal is the proof. |
| A3 | `unmerge` does not exist in either tool. **A merge is currently irreversible.** Scope it as its own item; §2.3.3.3 already specifies the behaviour (restore both rows from the log, re-point the slug redirect). |

Tier A for A2 (core-table write path). A3 is Tier A and larger — it needs the merge log first.

---

### 2. Item 22, the download cap — NO DISAGREEMENT; a built feature is switched off

**The claim.** There is no per-download 100 MB cap, only a store-wide `PROSPECTUS_STORE_MAX_GB`,
so a single 400 MB file on a near-empty store would not be refused.

**What is true.** The per-download cap exists, is the number the spec asks for, and is
single-sourced:

```ts
// scraper/src/services/document-download-verifier.ts:40
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

// :50 — one function, env-overridable without a redeploy
export function getMaxDocumentBytes(env = process.env): number {
  const n = Number(env.PROSPECTUS_MAX_DOCUMENT_MB);
  return (Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_DOCUMENT_MB) * 1024 * 1024;
}
```

Its own comment states the discipline: *"Read by **both** `verifyDownload`'s post-hoc size check
**and** `defaultFetcher`'s streaming cap **so the two never disagree**."* The audit looked in
`document-store.ts`, found the store-wide budget, and concluded the per-download cap was absent.

**The real issue.** Both code paths exist in `document-discovery-runner.ts` — a streaming reader
at `:701` and a buffer-then-check at `:738` — split by `ENABLE_DOWNLOAD_STREAMING_CAP`
(`feature-flags.ts:445`, plain `=== 'true'`).

Measured on the box, both slots:

```
staging: ENABLE_DOWNLOAD_STREAMING_CAP  NOT SET
prod:    ENABLE_DOWNLOAD_STREAMING_CAP  NOT SET
```

So the buffering path runs everywhere. The cap is correct and enforced — but only **after** the
whole body is in memory. A 2 GB response is fully buffered on an 8 GB box that also serves
production, and only then refused as `too_large`.

**Plan.** No code. Flip `ENABLE_DOWNLOAD_STREAMING_CAP=true` in staging, prove it against a real
large fixture (the item-22 card names this proof), then prod in a deploy window. Correct the
spec's stale 150 MB line (Part B).

---

### 3. Item 7, `cron_restart` — REAL, and the two environments already differ

**The claim.** The spec says remove the `cron_restart` force-kill; the project rule
`.claude/rules/pm2-scheduled-one-shot-scraper.md` says it MUST be kept. One is stale and neither
says which.

**What is true.** Both documents say what the audit reported. Neither describes what is running:

| Source | Says |
|---|---|
| Spec, OD-55 (2026-09-11), item 7 | *"The `cron_restart` force-kill is removed"* |
| `.claude/rules/pm2-scheduled-one-shot-scraper.md:67` | *"MUST keep `cron_restart: '*/30 * * * *'` — the scheduled-one-shot contract behind GitHub #2"* |
| **The VPS** | **Split** |

```
ipodhan-scraper          | cron_restart: */30 * * * *  | autorestart: false | fork | stopped
ipodhan-scraper-staging  | cron_restart: (none)        | autorestart: false | fork | stopped
```

Staging has already migrated to an OS-cron wake (`scraper-wake.sh`, the `15,45` crontab line,
with a 7200s hung-process ceiling). Prod still runs the PM2 force-kill.

**The two documents are not really in conflict.** They solve different problems and want the same
invariant:

- The **rule** exists because of GitHub #2: `autorestart: true` on a self-exiting process caused a
  ~4-second infinite restart loop. Its real content is *"never auto-restart, never cluster."*
  `cron_restart` is named only because that was the waking mechanism at the time.
- **OD-55** removes `cron_restart` for a different reason: it force-kills a running extraction
  mid-flight. A 10-minute extraction dies at the 30-minute boundary and the next wake loses its
  slot. It is replaced by an external wake plus a budget ceiling — which cannot kill work in
  progress.

**The risk that matters more than the doc conflict.** Production can still force-kill a long
extraction today; staging cannot. **The two environments schedule the scraper differently, and no
document says so.** Any cadence or timing behaviour proven on staging does not transfer to prod.

**Plan.**

| Step | What |
|---|---|
| B1 | Rewrite the rule to state the invariant (`autorestart: false`, `exec_mode: fork`, one-shot) and record that the *waking mechanism* moved to OS cron per OD-55. Keep the GitHub #2 warning — still true, still load-bearing. |
| B2 | Migrate prod to the staging mechanism: remove `cron_restart` from the prod PM2 entry, add the OS-cron wake. **Tier A** — it changes how production is scheduled. |
| B3 | Until B2 lands, both documents and the staging board must state that prod and staging schedule differently. |

---

### 4. Item 1, child-table scope — AUDIT WRONG; six of eight routed, and one real gap

**The claim.** The design lists 8 child tables; only 4 are routed through
`consolidatedUpsertChildRows`, inferred from `detection-checks/q_field_sources_row_key_coverage.json:8`.

**What is true.** Measured against the staging database, where a `field_sources` row is the proof
that the consolidated writer actually ran:

| Table (the 8 item 1 names) | Provenance rows |
|---|---|
| `ipo_risk_factors` | 2,234 |
| `ipo_intermediaries` | 592 |
| `ipo_details` | 443 |
| `financial_statements` | 156 |
| `ipo_valuation` | 99 |
| `promoters` | 26 |
| **`anchor_investors`** | **0** |
| **`peer_companies`** | **0** |

**Six of eight**, not four. Five further tables outside item 1's list also carry provenance
(`ipos` 6,398, `ipo_financials` 686, `financial_data` 229, `documents` 39,
`promoter_acquisition_ranges` 1) — eleven tables in total.

**The two gaps are not the same gap:**

- **`peer_companies` — 321 rows of data, zero provenance.** This is the one that matters. Peer
  comparison figures are on the live page, written by a path that records no source. If a peer
  P/E is wrong, nothing can say which source produced it.
- **`anchor_investors` — 4 rows, zero provenance.** `anchor-persister.ts:637` does call the
  writer, so the path exists; it has simply not produced rows yet. Low impact today, and a
  different condition from `peer_companies`.

**Plan.**

| Step | What |
|---|---|
| C1 | Route `peer_companies` through `consolidatedUpsertChildRows`. 321 live rows currently have no source recorded. Tier A (write path). |
| C2 | Establish whether `anchor_investors` is genuinely unrouted or merely unexercised — the caller exists at `:637`. One staging cycle with an anchor filing settles it. Do not build before measuring. |
| C3 | Correct item 1's status: it reads as one unit and the code has split it. Six routed, one outstanding, one unproven. |

---

## Part B — spec lines that are historically true and read as current

Two of the three false findings came from reading a spec line that was accurate when written.
The spec is a living document with historical passages in it; nothing marks them as past.

| Line | Current text (abridged) | Why it misleads | Suggested correction |
|---|---|---|---|
| `§2.2.1`, line 1244 | *"A cap already exists — `MAX_DOCUMENT_BYTES = 150 MB`… Whether the number stays 150 MB or drops to 100 MB is a configuration value"* | The drop already happened: the constant is **100 MB**, with the reason in its own comment. A reader concludes there is a 100-vs-150 mismatch; there is none. | State the cap as 100 MB, single-sourced through `getMaxDocumentBytes()`, env-overridable via `PROSPECTUS_MAX_DOCUMENT_MB`. Keep the streaming-vs-buffering distinction, which **is** still current, and name the flag. |
| `§8.3`, lines 3325–3345 | *"`pr-gate` is red on PR #432… the order in which they merge is yours to choose… Either way item 19 is the unblocker"* | PR #432 is **merged**; the raw-SQL script was **deleted** (`e13cf37a`); the routing work is **done** (`5d25974b`). A reader concludes item 19 is an open blocker. | Replace with the outcome, and keep the two-merge-tools paragraph — it is still accurate and is the only place the second tool's debt is recorded. |
| `§7.1`, item 19 row | *"small code, high blast radius: it is the gate blocking PR #432"* | Same staleness; the dependency no longer exists. | Mark DONE; open the follow-on (A2) and `unmerge` (A3) as their own rows. |
| `§7.1`, item 7 row | *"the removal of the `cron_restart` force-kill"* | True as an intent, and done on staging only. Reads as pending everywhere or done everywhere; it is neither. | State it per slot: done on staging, outstanding on prod. |

**A general note for the next reader, human or agent.** Every one of the false findings in this
round came from trusting a document — the audit, or a spec line — over the running system. The
code settled two of them; the **live VPS and the staging database** settled the other two, and
neither could have been settled by reading alone. When a spec sentence and a system disagree,
the system is the fact and the sentence is a claim about the past.

---

## What is actually actionable, ordered

1. **`peer_companies` provenance (C1)** — 321 live rows on a reader-facing page with no recorded
   source. The only item here a user is exposed to today.
2. **Prod scheduling migration (B2)** — production can force-kill a mid-flight extraction, and
   staging is not a valid proving ground for cadence while the two differ.
3. **Streaming download cap flag (item 22)** — no code; a flag flip and a staging proof. A 2 GB
   response is currently buffered whole on an 8 GB box that serves production.
4. **Route the second merge tool (A2)**, then **`unmerge` (A3)** — operator-facing; merges are
   irreversible today.
5. **Spec corrections (Part B)** — cheap, and they stop the next reader repeating this round.
6. **`anchor_investors` (C2)** — measure before building.
