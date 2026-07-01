# Oracle fixtures — frozen oracle responses for offline audit tests

These fixtures let the Stage-0 oracle cross-check (`../oracle-crosscheck.ts`) and its
extractors (`../oracle-field-extractors.ts`) be exercised **offline and
deterministically** — no live network, no re-hammering chittorgarh.com /
moneycontrol.com. A fixture is a *frozen real oracle response* plus the *expected
parsed field set* the extractors should produce from it.

> HONESTY RULE: a fixture's `expected` values MUST come from a **real** frozen
> oracle response — never hand-typed guesses. If you have not fetched the live
> page, leave `expected` as `null` and mark the fixture `"__status": "SCHEMA_ONLY"`
> (see `_schema.example.json`). Fabricated oracle numbers would poison every audit
> that trusts them.

## Why this exists as SCHEMA-ONLY right now

As of 2026-07-01 the build environment that generated these files could **not reach
chittorgarh.com** (both `www.chittorgarh.com` and `webnodejs.chittorgarh.com`
connect-timeout) — so no real Chittorgarh sample could be frozen here.
`moneycontrol.com` was reachable but has no deterministic name→detail-URL resolver
(the subscription API path 404s), so no real Moneycontrol sample was frozen either.
The files below are therefore the **schema + documented placeholders**, not live
data. See the run report for the reachability notes.

## Fixture format

Each fixture is one JSON file per IPO, named `<slug>.<oracle>.json`:

```
fixtures/
  ather-energy-ltd-ipo.chittorgarh.json    # one mainboard sample
  <sme-slug>.chittorgarh.json              # one SME sample
  <slug>.moneycontrol.json                 # one moneycontrol sample
  moneycontrol-url-map.json                # slug -> moneycontrol detail URL map (optional input)
  _schema.example.json                     # the schema + a documented placeholder
```

A fixture file:

```jsonc
{
  "__status": "FROZEN",             // FROZEN = real response captured | SCHEMA_ONLY = placeholder
  "oracle": "chittorgarh",          // "chittorgarh" | "moneycontrol"
  "slug": "ather-energy-ltd-ipo",
  "companyName": "Ather Energy Ltd",
  "ipoType": "MAINBOARD",           // MAINBOARD | SME
  "sourceUrl": "https://www.chittorgarh.com/ipo/ather-energy-ltd-ipo/1801/",
  "fetchedAt": "2026-07-01T00:00:00.000Z",
  "rawHtmlFile": "ather-energy-ltd-ipo.chittorgarh.html",  // the frozen response body (kept beside the json)
  "expected": {                     // what extractOracleFields() should return from rawHtml
    "companyName": "Ather Energy Ltd",
    "issueSizeCr": 2980.76,
    "priceMin": 304,
    "priceMax": 321,
    "lotSize": 46,
    "faceValue": 1,
    "openDate": "2025-04-28",
    "closeDate": "2025-04-30",
    "allotmentDate": null,
    "listingDate": "2025-05-06",
    "subscriptionTotal": null,
    "subscriptionQIB": null,
    "subscriptionNII": null,
    "subscriptionRetail": null,
    "gmp": null,
    "listingPrice": null,
    "listingGainPct": null,
    "registrar": "Link Intime India Pvt. Ltd.",
    "sector": null
  }
}
```

`null` in `expected` means **the oracle does not publish that field on this page**
(SOURCE-UNAVAILABLE), which is a legitimate, non-fabricated outcome.

## How to freeze a REAL fixture (on a network that reaches the oracles)

1. Run the CLI once with the cache enabled (default):

   ```bash
   cd scraper
   npx tsx scripts/audit/oracle-crosscheck.ts --slug ather-energy-ltd-ipo \
     --company "Ather Energy Ltd" --out /tmp/ather.report.json
   ```

   This populates `scripts/audit/.oracle-cache/<md5>.json` with the raw responses.

2. Copy the relevant `.oracle-cache/*.json` body into
   `fixtures/<slug>.<oracle>.html` and author the matching `<slug>.<oracle>.json`
   metadata, filling `expected` from the report's per-field values (which came from
   the real response — not typed by hand).

3. Set `"__status": "FROZEN"`. Commit the fixture (the `.oracle-cache/` dir itself
   is gitignored; fixtures are the durable, reviewed copy).

## moneycontrol-url-map.json

Optional INPUT (not a frozen response). Because Moneycontrol has no deterministic
name→URL resolver, the cross-check reads a per-slug detail URL from this map when
present:

```json
{
  "ather-energy-ltd-ipo": "https://www.moneycontrol.com/ipo/ather-energy/AE01"
}
```

Populate it once for the run's IPO set to unlock Moneycontrol coverage; without an
entry, Moneycontrol fields stay SOURCE-UNAVAILABLE (never fabricated).

## Target coverage (freeze ≥1 real sample per type when reachable)

- [ ] 1 × MAINBOARD Chittorgarh fixture
- [ ] 1 × SME Chittorgarh fixture
- [ ] 1 × Moneycontrol fixture (needs a URL-map entry)
