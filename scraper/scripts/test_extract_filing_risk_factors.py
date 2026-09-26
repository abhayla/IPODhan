"""#502 / #503 — E8 risk factors carry their body; tables and repeats never become headings.

The two real fixtures are the RISK FACTORS chapters of the Prasol Chemicals and
Hy-Tech Engineers RHPs (SEBI archive copies, see the sibling .meta.json), read
page by page exactly as extract_filing.py reads them. Before the fix, a table
inside a risk factor (a list of MPCB notices, a properties table, a top-ten
customers table) restarts its row numbers at "1." and its row "2." was taken as
risk factor 2: staging holds "Factory Raigad, Survey Owned Manuf - - - Not Yes
plot Maharas No." x5 and "Cu stomer No." x5 as headings, and every one of the
4751 staging rows has an empty body because the extractor never emitted one.
"""

import json
import os
import re

import pytest

from extract_filing import extract_risk_factors

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "extractor")


def load(name):
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as handle:
        return [tuple(page) for page in json.load(handle)]


@pytest.fixture(scope="module")
def prasol():
    return extract_risk_factors(load("prasol-chemicals-rhp-risk-factors.json"))


@pytest.fixture(scope="module")
def hytech():
    return extract_risk_factors(load("hy-tech-engineers-rhp-risk-factors.json"))


PRASOL_SAMPLE = [
    (1, "Our business is dependent on our manufacturing facilities and we are subject to certain related risks.",
     "For instance, MPCB, in the past had directed us to shut-down"),
    (2, "Some of the raw materials that we use, certain byproducts that are generated, as well as our finished "
        "products are hazardous, corrosive and flammable and require expert handling and storage, as applicable.",
     "Any accidents may result in loss of life or property and dis"),
    (3, "There are outstanding litigations involving our Company, Promoters and Directors, and any adverse outcome "
        "in any of these proceedings may adversely affect our results of operations and financial condition.",
     "Our Company, Promoters and our Directors are involved in cer"),
    (4, "Our net cash from operating activities has significantly moved in the past.",
     "Any significant fluctuation in our cash flow from operating "),
    (5, "The Deputy Director, Industrial Safety & Health, Raigad District has issued show cause notices against "
        "Gaurang Natwarlal Parikh (in his capacity as occupant of our Company), one of the Promoters of our Company "
        "alleging violation of provisions of the Factories Act, 1948.",
     "While we cannot assess any definitive financial or operation"),
    # 14 sits right after the properties table whose rows 14..23 were published as headings.
    (14, "Our operations are labour intensive, and our manufacturing operations may be materially adversely affected "
         "by strikes, work stoppages or increased wage demands by our employees or those of our suppliers.",
     "Our attrition rate was 27.96%, 18.07% and 36.82% during Fisc"),
]

HYTECH_SAMPLE = [
    (1, "We are dependent on a few customers for a major portion of our revenues with our top 10 customers "
        "contributing to 45.32%, 42.02% and 48.72% of our revenue from operations in the Fiscals 2026, 2025 and "
        "2024, respectively.",
     "Further, we do not enter into long-term arrangements with ou"),
    (2, "We derive a significant portion of revenue from operations from exports, which accounted for 29.37%, "
        "28.30% and 33.14% of our total revenues in Fiscal 2026, 2025 and 2024, respectively.",
     "Out of which a substantial portion was generated from the Un"),
    (3, "In the Fiscal 2024, we have experienced negative year on year growth in our profit after tax.",
     "We may be unable to manage our growth and expansion operatio"),
    (4, "Four out of our six Manufacturing Facilities are located in Maharashtra, India and the balance two in "
        "Madhya Pradesh.",
     "We derived 77.64%, 77.27% and 77.43% of our revenue from ope"),
    (5, "Under-utilization of our manufacturing capacities and an inability to effectively utilize our expanded "
        "manufacturing capacities could have an adverse effect on our business, future prospects and future "
        "financial performance.",
     "As on date of this Red Herring Prospectus, we have six manuf"),
]


def by_n(result):
    return {r["n"]: r for r in result[0]}


@pytest.mark.parametrize("n,heading,body_prefix", PRASOL_SAMPLE)
def test_prasol_sampled_factor_heading_and_body(prasol, n, heading, body_prefix):
    row = by_n(prasol)[n]
    assert row["heading"] == heading
    assert row["body"].startswith(body_prefix)


@pytest.mark.parametrize("n,heading,body_prefix", HYTECH_SAMPLE)
def test_hytech_sampled_factor_heading_and_body(hytech, n, heading, body_prefix):
    row = by_n(hytech)[n]
    assert row["heading"] == heading
    assert row["body"].startswith(body_prefix)


@pytest.mark.parametrize("which,count,first_page", [("prasol", 91, 26), ("hytech", 77, 22)])
def test_every_factor_once_in_order_with_a_body(request, which, count, first_page):
    rows, page = request.getfixturevalue(which)
    assert page == first_page
    # F2: >= 20 headings for a mainboard IPO; the RHP's own last number is the count.
    assert len(rows) == count >= 20
    assert [r["n"] for r in rows] == list(range(1, count + 1))
    headings = [r["heading"] for r in rows]
    assert len(set(headings)) == len(headings)
    assert all(r["body"] for r in rows), "spec field 159: every risk factor carries its body"


@pytest.mark.parametrize("which,cells", [
    ("prasol", ["Factory Raigad", "Survey Owned", "MPCB Company", "N.A. On"]),
    ("hytech", ["Cu stomer No", "Si sa Hydropneumatics", "Hy -Tech USA", "To mpkins"]),
])
def test_no_table_cell_is_a_heading(request, which, cells):
    rows, _ = request.getfixturevalue(which)
    for r in rows:
        for cell in cells:
            assert cell not in r["heading"], (r["n"], r["heading"])


# ---- synthetic: one case per rule, so each rule can be mutated on its own ----

HEAD = "SECTION II - RISK FACTORS"


def run(lines):
    return extract_risk_factors([(0, "\n".join([HEAD] + lines)), (1, "SECTION III - INTRODUCTION")])[0]


def test_table_restarting_at_one_is_not_a_risk_factor():
    rows = run([
        "1. First risk heading. First body.",
        "1. Row one cell", "2. Row two cell", "3. Row three cell",
        "Prose after the table.",
        "2. Second risk heading. Second body.",
        "3. Third risk heading. Third body.",
    ])
    assert [(r["n"], r["heading"]) for r in rows] == [
        (1, "First risk heading."), (2, "Second risk heading."), (3, "Third risk heading.")]
    assert rows[0]["body"].startswith("First body. 1. Row one cell")


def test_ambiguous_row_is_the_risk_factor_when_no_later_orphan_exists():
    # A 2-row list inside risk factor 2: "3." continues both; nothing later prints "3." again.
    rows = run([
        "1. First risk heading. Body.",
        "2. Second risk heading. Body.",
        "1. Item a", "2. Item b",
        "3. Third risk heading. Body.",
        "4. Fourth risk heading. Body.",
    ])
    assert [r["heading"] for r in rows] == [
        "First risk heading.", "Second risk heading.", "Third risk heading.", "Fourth risk heading."]


def test_accepting_a_factor_closes_the_nested_run():
    # A 3-row list in factor 1 leaves nested at 4; real 2, 3 follow; real "4." must not be eaten.
    rows = run([
        "1. First risk heading. Body.",
        "1. Item a", "2. Item b", "3. Item c",
        "2. Second risk heading. Body.",
        "3. Third risk heading. Body.",
        "4. Fourth risk heading. Body.",
        "1. Later list", "2. Later list b", "4. Stray row.",
    ])
    assert [(r["n"], r["heading"]) for r in rows][-1] == (4, "Fourth risk heading.")


def test_repeated_heading_is_kept_once():
    rows = run([
        "1. Same risk heading. Body one.",
        "2. Same risk heading. Body two.",
        "3. Other risk heading. Body three.",
    ])
    assert [r["heading"] for r in rows] == ["Same risk heading.", "Other risk heading."]


def test_body_drops_page_numbers_and_category_banners():
    rows = run([
        "1. First risk heading. Body starts",
        "27",
        "and continues.",
        "EXTERNAL RISKS",
        "2. Second risk heading. Body.",
    ])
    assert rows[0]["body"] == "Body starts and continues."
    assert rows[1]["body"] == "Body."
