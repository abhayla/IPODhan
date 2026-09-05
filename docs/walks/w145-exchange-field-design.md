# W-145 design: listing exchange as a first-class, source-ranked field (Fable, 2026-09-05 17:11 IST)

## Facts (prod, read-only, 2026-09-05)
- `ipos.listing_exchanges` (jsonb) is filled: SME 107 BSE / 60 NSE / 5 "both" (an SME issue lists on ONE board, so
  those 5 are wrong); mainboard 74 both / 63 BSE / 5 NSE.
- A stray varchar `ipos.exchange` exists in the live DB and NOT in schema.ts (W-145c, drift; `audit:schema-drift`
  must flag it; drop via a `_gated/` migration after owner sign-off).

## Root causes (W-143 addendum 0c8eb0f5)
1. `listingExchanges` is the one identity field with no `field-priority-matrix.ts` entry, so
   `extractListingExchanges` (data-consolidation-orchestrator.ts:440-450) is last-writer-wins.
2. Key mismatch: incoming record uses `listingExchange` (singular, :359); existing record uses
   `listingExchanges` (plural, :387) — the consolidator never compares like with like.
3. Three sources hard-code `'BOTH'` regardless of the real board: moneycontrol-scraper.ts:299,
   description-backfill.ts:53, historical-ipo-assembler.ts:91 — any of them can stomp a correct
   single-board value on the next cycle (the 5 wrong SME rows).

## Decision
1. **One canonical field**: `listingExchanges: ('NSE'|'BSE')[]` end to end. The incoming record maps
   `scrapedIPO.listingExchange` ('NSE'|'BSE'|'BOTH') to the array at the boundary (`mapScrapedIPOToRecord`),
   so the consolidator compares arrays; the singular key disappears from the record shape.
2. **Matrix entry** for `listingExchanges`: sources = NSE, BSE (each may assert only ITSELF: NSE says
   "NSE", BSE says "BSE"; the union of exchange self-assertions is the truth), then CHITTORGARH, then
   MONEYCONTROL/API_FALLBACK at the bottom; merge rule = **union of exchange self-assertions**, never
   overwrite with a lower source; a lower source may only ADD an exchange it can evidence (a listing
   record with that exchange's symbol), never assert BOTH by default.
3. **Kill the hard-coded 'BOTH'**: the three sources emit `undefined` (unknown) unless the page states
   the board; unknown never overwrites.
4. **SME invariant**: `segment === 'SME'` implies exactly one exchange; a second exchange for an SME row
   is a conflict row (conflicts repo), not a write. Guard in the consolidator + a plausibility audit line.
5. **Repairing the 5 wrong SME rows** (CORRECTED in round 2 — the original text was false):
   "the normal cycle recomputes" does NOT hold. `listingExchanges` is a SET field and the merge is a
   UNION, which never shrinks; the SME invariant only refuses to WIDEN, so a row already stored as
   `['NSE','BSE']` would keep both boards forever. The repair is therefore an **evidence-based
   collapse inside the consolidation path** (not a one-shot script), in `collapseSmeExchanges`
   (`scraper/src/services/listing-exchange-resolution.ts`), applied whenever a `segment === 'SME'`
   row is read with two exchanges:
   1. **Listing record** — `listing_performance.exchange` for that IPO, when it names NSE or BSE
      (a `BOTH` listing row is not evidence).
   2. **Provenance** — the exchange whose OWN scraper holds a `field_sources` row for `symbol` or
      `listingExchanges` on this IPO, when exactly ONE exchange qualifies (rows from both
      exchanges cancel out).
   3. **This run** — the self-asserting exchange (NSE/BSE) writing in the current cycle.
   With NO evidence the stored pair is kept AND a CRITICAL `data_conflicts` row
   (`SME_SINGLE_EXCHANGE_INVARIANT`) is written for admin review — a guessed board is worse than a
   tracked unknown. Every collapse logs one warn line naming the evidence tier used. The collapse
   runs when some source sends a value for the field, so in practice the 5 rows repair on the next
   NSE or BSE cycle (those sources always self-assert); a cycle from a source that reports nothing
   for the field leaves the row untouched, by design.
   The **74 mainboard "both" rows are presumed CORRECT and are untouched** — a mainboard issue may
   genuinely list on both boards, so no collapse ever applies to them.

   **Two read-side consequences of dropping the hard-coded 'BOTH' (accepted, not bugs):**
   - a mainboard IPO seen so far only by the NSE cycle shows "NSE" until the BSE cycle runs and the
     union adds BSE — the page is now under-stated rather than wrong;
   - an IPO first discovered by Moneycontrol (or another aggregator that cannot see the board)
     shows "-" for exchanges until an exchange cycle reaches it, instead of a fabricated "NSE, BSE".
6. **W-145c**: schema-drift gate first (fails when the live DB has a column schema.ts lacks), then the gated
   drop.

## Size and order
Opus-sized (consolidation + matrix + 3 scrapers + invariant + tests): after W-147/W-151, in the
2026-09-07 bundle. Acceptance: unit tests for the union rule, the SME invariant, the boundary mapping;
staging: zero SME rows with two exchanges after one full rotation; `audit:substance` gains the SME
one-exchange check.
