# Anchor-letter OCR fixtures (#437)

`<SYMBOL>-ocr-boxes.json` is the real output of
`ocr_pages.ocr_pdf_page_boxes(<pdf>, dpi=300)` for one anchor-allocation letter
published by NSE: one entry per page, each with the OCR `lines`, their box
geometry in PDF points, and the page confidence. Scores were dropped to keep
the files small; nothing else was edited.

The PDFs themselves are NOT committed (size, and they are NSE's to publish).
Each was downloaded from its public archive zip:

| Symbol | Zip | PDF inside |
|---|---|---|
| `LCCPROJECT` | https://nsearchives.nseindia.com/content/ipo/ANCHOR_LCCPROJECT.zip | `Anchor Intimation Letter.pdf` |
| `JSIPL` | https://nsearchives.nseindia.com/content/ipo/ANCHOR_JSIPL.zip | `Anchor Letter - Exchange.pdf` |
| `LUMINO` | https://nsearchives.nseindia.com/content/ipo/ANCHOR_LUMINO.zip | `Anchor Investor Allocation - Lumino Industries.pdf` |
| `HEROMOTORS` | https://nsearchives.nseindia.com/content/ipo/ANCHOR_HEROMOTORS.zip | `Anchor Allocation Intimation Letter.pdf` |
| `GLOTTIS` | https://nsearchives.nseindia.com/content/ipo/ANCHOR_GLOTTIS.zip | `Intimation.pdf` |

All five are **pure image scans**: `pdfplumber.extract_words()` returns zero
words on every page, which is the defining property of the #437 class. They
were chosen to span the shapes the rebuild has to survive:

* `LCCPROJECT` - two pages, a main table plus a one-investor Life Insurance
  sub-table (the "only 1 investor rows" shape), preamble total 87,76,869.
* `JSIPL` - a single page that is cover letter AND table at once.
* `LUMINO` - five pages, a table continuing across four of them with names
  wrapping three lines deep, preamble total 25,243,901.
* `HEROMOTORS` - four pages, a continuation table with no preamble total.
* `GLOTTIS` - **no bid-price column at all** (serial, name, shares, %, amount),
  which is why the share column is found by layout order and not by counting.

To refresh one: download the zip, unzip it outside the repo, and run
`python scraper/scripts/ocr_pages.py <pdf>` / the capture in
`test_anchor_report_text_437.py`'s docstring. Do not commit the PDFs.

## Text-layer letters (#347, #409)

`<SYMBOL>-sidecar-pages.json` is the exact stdout of
`python scraper/scripts/anchor_report_text.py <pdf>` (after the #409 fix) for
TEMPSENS, MANIKA, VARMORA (#347: sub-tables repeating the portion, a header
word in a percent cell) and KANOHAR, PRASOLCHEM, RENTOMOJO (#409: no serial
column learned). `<SYMBOL>-text-words.json` (KANOHAR, PRASOLCHEM) is
pdfplumber's `extract_words(y_tolerance=1, x_tolerance=1.5)` per page, the
sidecar's own input. All from `https://nsearchives.nseindia.com/content/ipo/ANCHOR_<SYMBOL>.zip`,
captured 2026-09-26. Tests: `scraper/tests/unit/scrapers/anchor-report-parser-347-409.test.ts`,
`scraper/scripts/test_anchor_serial_band_409.py`.
