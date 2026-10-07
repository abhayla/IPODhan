"""D11 (spec "RHP read, step-0 round 5"): a restated statement whose column header WRAPS each
column's period end over several lines, and whose stub column's lines interleave with the fiscal
year columns' lines, so no single text line pairs a column with its period:

    Particulars For the six- For the year For the year For the year
    month period ended March ended March ended March
    ended 31, 2024 31, 2023 31, 2022
    September 30,
    2024
    I Revenue from Operations 2,705.17 6,621.93 2,294.86 613.60

The text layer cannot say which column "September 30, 2024" heads. The page's word boxes can: each
column is anchored on its figure in the revenue row, and every header phrase above it falls under
exactly one column. Only tried when every text-only reading reads nothing from the page.

Fixture: real pages, text by pdfplumber page.extract_text() and word boxes by page.extract_words()
(the calls the extractor makes), from three mainboard DRHPs that read no fiscal years before:
Runwal Enterprises DRHP-301a334f p77, Rentomojo DRHP-5fb628d5 p259 (note column, split digits),
Deepa Jewellers DRHP-db239fe9 p80 (stub and fiscal lines fully interleaved), Jindal Supreme
DRHP-284a9a8e p64 ("Ended December" / "31, 2025" stub beside "Fiscal 2025" columns) with its p111
peer comparison table.

Run:  cd scraper && python -m pytest scripts/test_extract_financials_wrapped_period_header.py -q
"""
import copy
import io
import json
import os

import pytest

from extract_financials_pdf import _geometry_period_columns, extract_from_texts

HERE = os.path.dirname(__file__)
FIXTURE = os.path.join(HERE, "..", "tests", "fixtures", "financial-statements",
                       "drhp-wrapped-period-header-pages.json")
NSE_STACKED = os.path.join(HERE, "..", "tests", "fixtures", "financial-statements",
                           "nse-rhp-restated-summary-stacked-header.txt")
NSE_CONTINUATION = os.path.join(HERE, "..", "tests", "fixtures", "financial-statements",
                                "nse-drhp-restated-pnl-eps-continuation.txt")

with io.open(FIXTURE, encoding="utf-8") as _fh:
    PAGES = json.load(_fh)

EXPECTED = {
    "runwal-enterprises-ltd": {
        "columns": [None, 2024, 2023, 2022],
        "revenue": {2024: 6621.93, 2023: 2294.86, 2022: 613.60},
        "stub": {2705.17},
    },
    "rentomojo-ltd": {
        "columns": [None, 2025, 2024, 2023],
        "revenue": {2025: 2659.59, 2024: 1927.01, 2023: 1201.02},
        "stub": {1766.09},
    },
    "jindal-supreme-india-ltd": {
        "columns": [None, 2025, 2024, 2023],
        "revenue": {2025: 58639.93, 2024: 64543.98, 2023: 50612.00},
        "stub": {48965.12},
    },
    "deepa-jewellers-ltd": {
        "columns": [None, 2025, 2024, 2023],
        "revenue": {2025: 13970.10, 2024: 10245.68, 2023: 9212.55},
        "stub": {8121.92},
    },
}


def _page(slug):
    entry = PAGES[slug]
    return entry["page"], entry["text"], entry["words"]


def _read(slug, words=None):
    page, text, real_words = _page(slug)
    words = real_words if words is None else words
    return extract_from_texts([(page, text)], words_for_page=lambda i: words if i == page else [])


@pytest.mark.parametrize("slug", sorted(EXPECTED))
def test_text_only_reading_reads_nothing_from_the_page(slug):
    page, text, _w = _page(slug)
    out = extract_from_texts([(page, text)])
    assert out["annualYears"] == []
    assert out["metrics"] == {}


@pytest.mark.parametrize("slug", sorted(EXPECTED))
def test_word_boxes_pair_each_column_with_its_own_period_end(slug):
    _p, text, words = _page(slug)
    assert _geometry_period_columns(text, words) == EXPECTED[slug]["columns"]


@pytest.mark.parametrize("slug", sorted(EXPECTED))
def test_fiscal_years_and_revenue_are_read_with_the_stub_dropped(slug):
    out = _read(slug)
    want = EXPECTED[slug]
    assert out["pnlPage"] == PAGES[slug]["page"]
    assert out["annualYears"] == [y for y in want["columns"] if y is not None]
    assert out["metrics"]["revenue"] == want["revenue"]
    for key, series in out["metrics"].items():
        assert not want["stub"] & set(series.values()), key


def test_rows_with_split_digits_and_a_note_column_equal_what_page_259_prints():
    m = _read("rentomojo-ltd")["metrics"]
    assert m["totalIncome"] == {2025: 2719.61, 2024: 1957.97, 2023: 1238.68}
    assert not {1787.93} & set(m["totalIncome"].values())


def test_rows_elsewhere_are_not_read_on_a_word_box_column_map():
    # p111 is a peer comparison: "EBITDA 3,030.22 2,811.57 18,424.80 12,724.01" is Jindal's stub
    # figure followed by three OTHER companies'. Same cell count, different header: never read.
    entry = PAGES["jindal-supreme-india-ltd"]
    pages = [(entry["page"], entry["text"])] + [(int(i), t) for i, t in entry["other_pages"].items()]
    assert "EBITDA 3,030.22 2,811.57 18,424.80 12,724.01" in entry["other_pages"]["111"]
    out = extract_from_texts(pages, words_for_page=lambda i: entry["words"] if i == entry["page"] else [])
    assert out["metrics"]["revenue"] == EXPECTED["jindal-supreme-india-ltd"]["revenue"]
    assert "ebitda" not in out["metrics"] and "ebitda" not in out["rejected"]
    for series in out["metrics"].values():
        assert not {2811.57, 18424.80, 12724.01} & set(series.values())


def _deepa_pages(p266=None):
    entry = PAGES["deepa-jewellers-ltd"]
    text266 = entry["other_pages"]["266"] if p266 is None else p266
    return entry, [(266, text266), (entry["page"], entry["text"])]


def test_a_page_read_from_its_text_stays_chosen_and_word_box_page_fills_only_its_gaps():
    # Deepa p266 is read today from its text (EPS, total income, PAT; no revenue row it can map).
    # p80 is read on its word boxes. p266 stays the chosen page; p80 adds revenue because the two
    # agree on total income and name the same fiscal years.
    entry, pages = _deepa_pages()
    before = extract_from_texts(pages)
    assert before["pnlPage"] == 266 and "revenue" not in before["metrics"]
    out = extract_from_texts(pages, words_for_page=lambda i: entry["words"] if i == entry["page"] else [])
    assert out["pnlPage"] == 266
    assert out["annualYears"] == before["annualYears"]
    assert out["metrics"]["revenue"] == EXPECTED["deepa-jewellers-ltd"]["revenue"]
    assert out["metrics"]["totalIncome"] == before["metrics"]["totalIncome"]
    for key in before["metrics"]:
        assert out["metrics"][key] == before["metrics"][key]


def test_a_word_box_page_that_disagrees_with_the_chosen_page_fills_nothing():
    entry, _p = _deepa_pages()
    original = entry["other_pages"]["266"]
    changed = original.replace("Total income 8 ,122.51 14,001.00 10,257.29 9,217.13",
                               "Total income 8 ,122.51 14,901.00 10,257.29 9,217.13")
    assert changed != original, "mutation did not apply"
    _e, pages = _deepa_pages(changed)
    out = extract_from_texts(pages, words_for_page=lambda i: entry["words"] if i == entry["page"] else [])
    assert out["pnlPage"] == 266
    assert "revenue" not in out["metrics"]


# Fail closed: a header the word boxes cannot pair column for column resolves nothing.
def _drop(words, text, top_near=None):
    out = [w for w in words if not (w["text"] == text and (top_near is None or abs(w["top"] - top_near) < 2))]
    assert len(out) == len(words) - 1, "mutation did not apply"
    return out


def test_a_column_with_no_period_end_resolves_nothing():
    _p, text, words = _page("runwal-enterprises-ltd")
    mutated = _drop(words, "2022")
    assert _geometry_period_columns(text, mutated) == "UNRESOLVED"
    assert _read("runwal-enterprises-ltd", mutated)["annualYears"] == []


def test_a_column_with_two_period_ends_resolves_nothing():
    _p, text, words = _page("runwal-enterprises-ltd")
    mutated = copy.deepcopy(words)
    # Move the stub's "September 30," under the first fiscal column: that column now names two.
    moved = 0
    for w in mutated:
        if w["text"] in ("September", "30,") and 120 < w["top"] < 126:
            w["x0"] += 80
            w["x1"] += 80
            moved += 1
    assert moved == 2, "mutation did not apply"
    assert _geometry_period_columns(text, mutated) == "UNRESOLVED"


def test_a_fiscal_year_named_twice_resolves_nothing():
    _p, text, words = _page("rentomojo-ltd")
    mutated = copy.deepcopy(words)
    hit = [w for w in mutated if w["text"] == "2024" and 100 < w["top"] < 104]
    assert len(hit) == 1, "mutation did not apply"
    hit[0]["text"] = "2025"
    assert _geometry_period_columns(text, mutated) == "UNRESOLVED"


def test_more_figures_than_columns_in_the_text_row_resolves_nothing():
    _p, text, words = _page("runwal-enterprises-ltd")
    mutated = _drop(words, "613.60")
    assert _geometry_period_columns(text, mutated) == "UNRESOLVED"


def test_no_word_boxes_reads_nothing():
    assert _read("runwal-enterprises-ltd", [])["annualYears"] == []
    page, text, _w = _page("runwal-enterprises-ltd")

    def broken(_i):
        raise RuntimeError("pdf gone")

    out = extract_from_texts([(page, text)], words_for_page=broken)
    assert out["annualYears"] == []


# Pages read today are read exactly as before, and their word boxes are never asked for.
def _txt_pages(path):
    with io.open(path, encoding="utf-8") as handle:
        raw = handle.read().replace("\r\n", "\n")
    out = []
    for chunk in raw.split("<<<PAGE "):
        if not chunk.strip():
            continue
        head, _, body = chunk.partition(">>>")
        out.append((int(head.strip()), body.lstrip("\n")))
    return out


def _comparable(out):
    return json.dumps({k: v for k, v in out.items() if k != "align"}, sort_keys=True, default=str)


@pytest.mark.parametrize("path", [NSE_STACKED, NSE_CONTINUATION])
def test_nse_pages_read_identically_with_word_boxes_available(path):
    pages = _txt_pages(path)
    asked = []

    def provider(i):
        asked.append(i)
        return []

    before = extract_from_texts(pages)
    after = extract_from_texts(pages, words_for_page=provider)
    assert before["annualYears"], "fixture no longer reads; the comparison would prove nothing"
    assert _comparable(after) == _comparable(before)
    read_pages = {before.get("pnlPage")}
    assert not read_pages & set(asked)


def test_a_word_box_page_sharing_no_row_with_the_chosen_page_fills_nothing():
    # Fix A3 reviewer note: agreement is checked on at least one row both pages carry. A word-box
    # page with no row in common with the chosen page is unconfirmed and fills nothing.
    from extract_financials_pdf import _fill_from_word_pages
    years = [2025, 2024, 2023]
    best = {"years": years, "unit": "millions", "unitStated": True}
    word_page = {"years": years, "unit": "millions", "unitStated": True, "score": 2,
                 "metrics": {"revenue": {2025: 13970.10, 2024: 10245.68, 2023: 9212.55},
                             "profit": {2025: 300.0, 2024: 200.0, 2023: 100.0}}}
    eps_only = {"eps": {2025: 1.0, 2024: 0.8, 2023: 0.5}}
    assert _fill_from_word_pages(eps_only, best, [word_page]) == eps_only
    agreeing = {"profit": {2025: 300.0, 2024: 200.0, 2023: 100.0}}
    assert _fill_from_word_pages(agreeing, best, [word_page])["revenue"] == word_page["metrics"]["revenue"]
