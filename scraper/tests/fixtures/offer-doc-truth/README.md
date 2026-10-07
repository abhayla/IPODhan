# Offer-document answer keys and the gate that scores the reader against them (OD-173)

The gate runs the REAL reader (`extract_filing.run`) in cache mode over every document that has an answer key and
fails when a keyed value is wrong or when "found" (right values) drops below `baseline.json`.

    python scraper/scripts/offer_doc_gate.py                    # run the gate (exit 0 pass, 1 fail, 2 NOT RUN)
    python scraper/scripts/offer_doc_gate.py --update-baseline  # after an intended improvement; refused if any gate family has a wrong value
    python scraper/scripts/offer_doc_gate.py --code-dir <dir>   # score a copy of scraper/scripts (mutation tests)
    pytest scraper/scripts/test_offer_doc_gate.py               # same gate; skips with a reason when the cache is absent

Cache: `OFFER_DOC_CACHE` or `D:/Abhay/Ventures/IPODhan-doc-cache/reader-cache/` (outside the repo, about 120 MB, one
`<slug>-<TYPE>.cache.json` per document: page texts, tables, word boxes, grid words). Cache absent -> `NOT RUN: <reason>`,
exit 2. A page the reader asks for that the cache lacks (a cache miss) is also `NOT RUN`: the reader would otherwise be
scored on input it never had. Rebuild the cache with the scratch builder (`session-2026-10-07/cache/cache-build.py`).

Rules the gate enforces: wrong in a gate family must be 0 (never stored as a baseline); found per section / key set /
family may not fall; a family listed as "known, F-249" (KEEP-TODAY, PARKED, or PENDING-BUILD, see `KNOWN_FAMILIES` in the
gate) may be wrong today, is reported separately, may not drop its found count, and may not gain a NEW wrong cell.
Part-year (stub) periods are not scored (D11). A key that says "not printed" while the reader saved a value is counted as
"unkeyed", listed, not scored (financial, general information); in promoters it is a wrong value.
When a PENDING-BUILD family is built into the product reader, delete it from `KNOWN_FAMILIES`: from then on wrong must be 0.

## Key sets (folder = one set; only `*-<type>-truth.json`, no page dumps)

| Folder | Documents | Built | Covers |
|---|---|---|---|
| `keys/` | AceVector, ARC, Hero Motors, Jindal Supreme, LCC, Orient Cables (DRHP + RHP), Panchatv, R K Fashion | tuning set: the reader was tuned against these | financial, promoter and general-information keys (full key sets) |
| `nse/` | NSE DRHP and RHP | tuning set | all three families |
| `keys-cap/` | the seven tuning DRHPs (6 above + NSE DRHP) | the CORRECTED promoter key set (fixes key errors the spike found: Orient total promoter holding p20, ARC per-promoter one-year table p35); use this, not `keys/`, for promoters | promoter fields |
| `keys-holdout/` | Elevate, Karamtara, Tempsens, Varmora | blind hold-out 1 (keys built from the PDF by a worker that never saw reader output); now USED, a tuning set | financial |
| `keys-holdout2/` | German Green, Rentomojo, SRIT, Symbiotec | blind hold-out 2, scored with no tuning; German Green nulls = "conflict" keys | financial |
| `keys-gi-holdout/` | German Green, Rentomojo, SRIT, Symbiotec | blind GI set 1 (used) | general information |
| `keys-gi-holdout2/` | Elevate, Karamtara, Tempsens, Varmora | blind GI set 2 (used) | general information |
| `keys-gi-holdout3/` | A-One, Deepa, Jio, Runwal | blind GI set 3 (used, cold run) | general information |
| `keys-gi-holdout4/` | Annu, Lumino, Manika, Steamhouse | blind GI set 4 (scored cold) | general information |

Blind sets are only blind until scored once; after that they are tuning data. A new class of failure needs a NEW blind set.
Keys without a cache document (Panchatv, R K Fashion, the RHPs of the six tuning IPOs) are listed as "no cache document"
and skipped; a document that is in `baseline.json` but missing from the cache is a NOT RUN, not a skip.
