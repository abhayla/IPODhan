# PROGRESS — BSE IPO enrichment (`/goal` run)

**Branch:** `feat/bse-ipo-enrichment` (off the PR #23 `feat/ipo-field-enrichment` tip — PR #23 is OPEN, not merged; enrichment stacks on it). **Owner:** this session (IPODhan141), taken over 2026-06-15 from a hung IPODhan126.

## §0.2 Preflight (done)
- **PR #23 (corporate-action classification) = OPEN**, 2 commits on `feat/ipo-field-enrichment` (`236d870f`, `73c32b81`). Do NOT redo.
- **BSE list JSON API VALIDATED** ✅ — `GET api.bseindia.com/BseIndiaAPI/api/IPO_HomePageDetail/w` (UA + Origin/Referer headers) → HTTP 200, 14 live rows. Keys: `Scrip_name, Start_Dt, End_Dt, Status, IR_flag, IR_FLAG_FULL, IPO_NO, Scrip_cd`. Susan Electricals = `IPO_NO:7770, Scrip_cd:4627, IR_flag:IPO`.
- **Baseline coverage (tunnel):** MAINBOARD total=178, issue_size>0=**60**, lot_size>0=**68** (~118 skeletons). Matches contract.
- **Dup problem (#16) confirmed:** Susan Electricals = **3 rows** (`Ltd. CT`, `Ltd. O`, all-caps `LIMITED`), 2 with issue_size 703.8M, all lot_size null.

## ✅ DETAIL ENDPOINT CRACKED (2026-06-15)
Found in the SPA bundle: for `type=='IPO'` the app calls
**`GET api.bseindia.com/BseIndiaAPI/api/GetMkt_ISSUE_BBS_IPO/w?IPO_NO=<IPO_NO>`** (headers: UA + Origin/Referer `https://www.bseindia.com`). Returns the full core detail. Susan (IPO_NO 7770) fields → DB mapping:
- `Issue_Size_No_of_shares` (4019000) × top-of-band price → **issue_size** (use `calculateIssueSize`, guard >0)
- `Price_Band` "120.00-127.00" → **priceRangeMin/Max**
- `Market_Lot` (1000) → **lot_size** · `Minimum_Bid_Quantity` → min bid · `Face_Value` (10) → **face_value**
- `Registrar` → **registrar** · `Book_Running_Lead_Manager`(+Co/Syndicate) → **lead_managers**
- `Issue_Period` "11 Jun 2026 to 15 Jun 2026" → **open/close dates** · `Symbol` (SUSAN) → symbol
- `Prospectus_GID`/`Anchor_Details`/`Price_Band_Advertisement` → documents (Stage C/DRHP)
- SPA detail page route (for G-UI ref): `/markets/publicIssues/DisplayIPO?id=<Scrip_cd>&type=<IR_flag>&idtype=1&status=<Status>&IPONo=<IPO_NO>`
- Bid/demand (subscription, Stage C): `GetBidDetBookBuilding/w`, `Pubissues_GetBkbldgCatdem_ng/w`.
- Playwright is BOT-BLOCKED on bseindia.com (Access Denied) → use `node`+`fetch` with headers (works).

## ~~OPEN BLOCKER — Stage A detail endpoint not yet cracked~~ (RESOLVED above)
- The list API gives only schedule + IR_flag, NOT issue_size/lot/registrar/price/lead-managers. Those need the **detail endpoint**, which must be discovered.
- Guessed endpoints (`Mkt_Pub_DisplayIPO__beta/w`, `ipoHomePageDetail/w`, `IPODetail/w` with `IPONo`/`scripcode`) all return a generic 1814-byte XHTML page → wrong path/param.
- The SPA main bundle (`/assets/includenew/js/main-CPK3PQBE.js`, 15MB) has only 3 `/api/X/w` endpoints, none IPO-related → the IPO-detail call is in a **lazy-loaded chunk**.
- **NEXT:** capture BSE's SPA XHR via Playwright (navigate an IPO detail page, read network requests) to get the real detail endpoint + exact params. Then TDD-rebuild `bse-scraper.ts`→`bse-api-scraper.ts` + `bse-detail-scraper.ts` on the API (flag `ENABLE_BSE_API`, default OFF), register fields in the priority matrix, backfill via tunnel.

## Stages (pending)
- A: rebuild BSE list+detail on JSON API + backfill ~118 skeletons.
- B: dedup status-code-suffix rows (extend normalizer + merge script).
- C: subscription capture for OPEN IPOs + DRHP best-effort.
- Ship: feature branch + DRAFT PR (no deploy/merge — gated). §GATE = enable `ENABLE_BSE_API` + deploy.
