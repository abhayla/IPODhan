"""section_locator (OD-173 step 1) on REAL page texts of stored DRHPs.

Fixtures: scraper/tests/fixtures/offer-doc-financials/<doc>.json (see each .meta.json): the contents pages, the
located sections' pages and the pages the financial reader reads, as pdfplumber gave them; other pages are absent.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import offer_doc_financials as F  # noqa: E402
import section_locator as S  # noqa: E402

FIX = os.path.join(HERE, "..", "tests", "fixtures", "offer-doc-financials")


def pages(doc):
    with open(os.path.join(FIX, doc + ".json"), encoding="utf-8") as fh:
        return F.dense_pages(json.load(fh)["page_texts"])


def test_nse_drhp_contents_page_locates_every_section():
    loc = S.locate(pages("national-stock-exchange-of-india-ltd-DRHP"))
    assert loc["toc_pages"] == [5]
    assert loc["offset"] == 5
    assert S.restated_start(loc) == 272
    got = {k: (v["idx"], v["end"], v["verified"]) for k, v in loc["other"].items()}
    assert got == {"bop": (117, 135, True), "ofi": (361, 393, True), "cap": (393, 394, True),
                   "restated": (272, 361, True)}


def test_karamtara_offer_document_summary_is_located():
    loc = S.locate(pages("karamtara-engineering-ltd-DRHP"))
    assert loc["other"]["sod"][("idx")] == 19 and loc["other"]["sod"]["verified"] is True
    assert S.restated_start(loc) == 276


def test_located_page_must_open_with_the_section_title():
    """A contents entry whose computed page does not open with its title is never verified."""
    pt = pages("jindal-supreme-india-ltd-DRHP")
    loc = S.locate(pt)
    bop = loc["other"]["bop"]
    assert bop["verified"] is True
    by = dict(pt)
    assert by[bop["idx"] + 1].strip()
    # the located page carries the NEXT page's real text (as a wrong offset would give): not verified
    shifted = [(i, t) if i != bop["idx"] else (i, by[i + 1]) for i, t in pt]
    assert S.locate(shifted)["other"]["bop"]["verified"] is False


def test_printed_number_reads_the_footer():
    pt = dict(pages("national-stock-exchange-of-india-ltd-DRHP"))
    assert S.printed_number(pt[286]) == 286 - 5


def test_no_contents_page_means_no_section():
    loc = S.locate([(i, t) for i, t in pages("national-stock-exchange-of-india-ltd-DRHP") if i != 5])
    assert loc["sections"] == [] and S.restated_start(loc) is None and loc["other"] == {}
