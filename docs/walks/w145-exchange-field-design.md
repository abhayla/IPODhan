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
5. **Backfill**: recompute the 5 wrong SME rows and the "both" mainboard rows from NSE/BSE list scrapers'
   self-assertions via the normal cycle (PRIMARY_SOURCE_DISCOVERY), no direct SQL.
6. **W-145c**: schema-drift gate first (fails when the live DB has a column schema.ts lacks), then the gated
   drop.

## Size and order
Opus-sized (consolidation + matrix + 3 scrapers + invariant + tests): after W-147/W-151, in the
2026-09-07 bundle. Acceptance: unit tests for the union rule, the SME invariant, the boundary mapping;
staging: zero SME rows with two exchanges after one full rotation; `audit:substance` gains the SME
one-exchange check.
