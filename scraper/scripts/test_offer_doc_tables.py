"""Offer-document readers for spec rows 148-151 (BRLM track record), 158 (BRLM grievance e-mail)
and 161-165 (WACA period table).

Fixtures: scraper/tests/fixtures/offer-doc-tables/*.json are pdfplumber page texts (and, for the
BRLM contact grid, pdfplumber word boxes) copied from the National Stock Exchange of India DRHP
(d88fad44) and the Bajaj Housing Finance DRHP. Values asserted below were read off the PDF pages.
"""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import offer_doc_tables as odt  # noqa: E402
import extract_filing as ef  # noqa: E402

FIX = os.path.join(HERE, "..", "tests", "fixtures", "offer-doc-tables")


def _pages(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as fh:
        return [(int(i), t) for i, t in json.load(fh)["pages"]]


NSE_BRLMS = [
    "Kotak Mahindra Capital Company Limited", "JM Financial Limited",
    "Morgan Stanley India Company Private Limited", "Citigroup Global Markets India Private Limited",
    "HSBC Securities and Capital Markets (India) Private Limited", "J.P. Morgan India Private Limited",
    "SBI Capital Markets Limited", "Anand Rathi Advisors Limited", "Avendus Capital Private Limited",
    "Axis Capital Limited", "DAM Capital Advisors Limited", "Equirus Capital Limited",
    "HDFC Bank Limited", "ICICI Securities Limited", "IDBI Capital Markets & Securities Limited",
    "IIFL Capital Services Limited", "Motilal Oswal Investment Advisors Limited",
    "Nuvama Wealth Management Limited", "Pantomath Capital Advisors Private Limited",
    "360 ONE WAM Limited",
]


class BrlmTrackRecord(unittest.TestCase):
    def setUp(self):
        self.rows, self.page, self.problems = odt.read_brlm_track_record(
            _pages("nse-drhp-pages.json"), NSE_BRLMS)
        self.by = {r["brlm"]: r for r in self.rows}

    def test_short_caption_resolves_to_the_numbered_firm_heading(self):
        # p433 "handled by Kotak:" under "I. Kotak Mahindra Capital Company Limited" (p432):
        # 2026-27 -, 2025-26 19, 2024-25 18.
        self.assertEqual(self.by["Kotak Mahindra Capital Company Limited"]["issues_3y"], 37)
        # p435 "handled by JM:" 2026-2027 1, 2025-2026 27, 2024-2025 13.
        self.assertEqual(self.by["JM Financial Limited"]["issues_3y"], 41)

    def test_full_caption_name_and_formerly_known_as_heading(self):
        self.assertEqual(self.by["DAM Capital Advisors Limited"]["issues_3y"], 16)
        # p460 "handled by IIFL:" under "XVI. IIFL Capital Services Limited (formerly known as ...)".
        self.assertIn("IIFL Capital Services Limited", self.by)

    def test_closed_below_is_never_the_30th_day_discount_count(self):
        # The table counts IPOs trading at a discount on the 30th day (Kotak 6 + 3 = 9); the column
        # means closed below the issue price on the LISTING day, which the table does not print.
        for r in self.rows:
            self.assertIsNone(r["closed_below"])

    def test_broken_tables_fail_closed_with_a_reason(self):
        # p448 Axis prints "2025- 25 ..." (FY label broken); p451-452 Equirus wraps "2026-\n2027*".
        self.assertNotIn("Axis Capital Limited", self.by)
        self.assertNotIn("Equirus Capital Limited", self.by)
        self.assertTrue(any("Axis" in p for p in self.problems))
        self.assertTrue(any("Equirus" in p for p in self.problems))

    def test_alias_without_document_brlm_list_is_not_guessed(self):
        rows, _p, problems = odt.read_brlm_track_record(_pages("nse-drhp-pages.json"), None)
        names = {r["brlm"] for r in rows}
        self.assertNotIn("Kotak Mahindra Capital Company Limited", names)
        self.assertTrue(any("short_name_and_no_document_brlm_list" in p for p in problems))
        # A caption that prints the firm's full name stands on its own.
        self.assertIn("DAM Capital Advisors Limited", names)

    def test_repeated_fiscal_year_fails_closed(self):
        # Bajaj Housing p410: the BofA table prints 2023-24 twice; p409 Kotak is clean (2+11+10).
        rows, _p, problems = odt.read_brlm_track_record(_pages("bajaj-drhp-brlm-pages.json"), None)
        self.assertEqual([(r["brlm"], r["issues_3y"]) for r in rows],
                         [("Kotak Mahindra Capital Company Limited", 23)])
        self.assertTrue(any("BofA" in p and "not_three_consecutive" in p for p in problems))


class AcquisitionRanges(unittest.TestCase):
    def test_nse_selling_shareholder_table(self):
        got = odt.read_acquisition_ranges(_pages("nse-drhp-pages.json"))
        rows = got["rows"]
        self.assertEqual((rows["1Y"]["waca"], rows["1Y"]["low"], rows["1Y"]["high"]),
                         (1909.02, 1350.0, 2260.0))
        self.assertEqual((rows["18M"]["waca"], rows["18M"]["low"], rows["18M"]["high"]),
                         (1747.54, 800.0, 2260.0))
        # "Last three years 229.23 [*] Nil^ to 5,150.00": a Nil end is a stated absence, never 0.
        self.assertEqual(rows["3Y"]["waca"], 229.23)
        self.assertIsNone(rows["3Y"]["low"])
        self.assertEqual(rows["3Y"]["range_why"], "range_end_printed_nil")
        for p in ("1Y", "18M", "3Y"):
            self.assertIsNone(rows[p]["cap"])
            self.assertEqual(rows[p]["cap_why"], "cap_multiple_placeholder_not_priced")
        self.assertIn("Selling Shareholders", got["group"])

    def test_period_row_cells(self):
        self.assertEqual(odt._parse_period_row(" preceding the date of 18.1 [●] 13.7 – 18.1")[0]["low"], 13.7)
        self.assertEqual(odt._parse_period_row(" 46.79 [●]* Nil**-129.90")[0]["high"], 129.9)
        # Studds prints "0-Nil": a priced low with a Nil high is not a range.
        self.assertEqual(odt._parse_period_row(" Nil [●] 0-Nil"), (None, "range_high_nil_low_priced"))
        self.assertEqual(odt._parse_period_row(" Nil [] N.A.***")[0]["range_why"],
                         "range_printed_not_applicable")


class GrievanceEmails(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(FIX, "nse-drhp-brlm-contacts-p89.json"), encoding="utf-8") as fh:
            self.fx = json.load(fh)
        self.pages = [(89, self.fx["page_text"])]

    def _read(self, words):
        return odt.read_grievance_emails(self.pages, lambda i: words, NSE_BRLMS)

    def test_each_address_goes_to_the_firm_heading_in_its_own_column(self):
        got, _problems = self._read(self.fx["words"])
        # The text layer prints JM's address on Kotak's line ("E-mail: nse.ipo@kotak.com Investor
        # grievance e-mail: grievance.ibd@jmfl.com"); positions put each in its own column.
        self.assertEqual(got["Kotak Mahindra Capital Company Limited"], "kmccredressal@kotak.com")
        self.assertEqual(got["JM Financial Limited"], "grievance.ibd@jmfl.com")
        self.assertEqual(got["Citigroup Global Markets India Private Limited"], "investors.cgmib@citi.com")
        # The address wraps onto the next line, same column.
        self.assertEqual(got["J.P. Morgan India Private Limited"], "investorsmb.jpmipl@jpmorgan.com")
        self.assertEqual(got["Axis Capital Limited"], "complaints@axiscap.in")

    def test_block_continuing_onto_the_next_page_is_not_guessed(self):
        got, problems = self._read(self.fx["words"])
        # Avendus's label ends p89; its address is on the next page.
        self.assertNotIn("Avendus Capital Private Limited", got)
        self.assertTrue(any("not_an_email" in p for p in problems))

    def test_unreadable_heading_drops_the_page(self):
        # Without the Morgan Stanley heading, its label would land under Kotak: the page is refused.
        words = [w for w in self.fx["words"] if not (w["text"] == "Morgan" and w["x0"] < 100)]
        got, problems = self._read(words)
        self.assertEqual(got, {})
        self.assertIn("p89 layout_not_one_label_per_firm_block", problems)

    def test_no_positions_no_answer(self):
        self.assertEqual(odt.read_grievance_emails(self.pages, None, NSE_BRLMS),
                         (None, ["no_word_positions_available"]))


class RunWiring(unittest.TestCase):
    def test_drhp_run_emits_the_waca_period_fields(self):
        out = ef.run(_pages("nse-drhp-pages.json"), "DRHP", "nse.pdf")
        f = out["fields"]
        self.assertEqual(f["waca_last_1y"]["value"], 1909.02)
        self.assertEqual(f["acquisition_price_range_18m"]["value"], {"low": 800.0, "high": 2260.0})
        self.assertIsNone(f["acquisition_price_range_3y"]["value"])
        self.assertEqual(f["cap_multiple_last_1y"]["check"]["detail"],
                         "cap_multiple_placeholder_not_priced")
        # No cover BRLM list in these pages: the short-name tables are not guessed, the
        # full-name ones are read.
        names = [r["brlm"] for r in f["brlm_track_record"]["value"]]
        self.assertIn("DAM Capital Advisors Limited", names)
        self.assertNotIn("Kotak Mahindra Capital Company Limited", names)
        self.assertEqual(f["brlm_grievance_emails"]["check"]["detail"],
                         "brlm_grievance_emails_unread: ['no_document_brlm_list']")


# ------------------------------------------------- step-3b review fixes (B1-B4)
# Edits below are MINIMAL EDITS of the real NSE DRHP page text for shapes this document does not
# print; each says which line it changes.
def _nse_pages(edit=None):
    out = []
    for i, t in _pages("nse-drhp-pages.json"):
        out.append((i, edit(i, t) if edit else t))
    return out


_NO_PROMOTER = "Our Company does not have an identifiable promoter"


class WacaGroupGate(unittest.TestCase):
    def test_selling_shareholder_table_needs_the_no_promoter_statement(self):
        # Minimal edit: p105's "does not have an identifiable promoter" sentence removed.
        p = _nse_pages(lambda i, t: t.replace(_NO_PROMOTER, "Our Company has a promoter") if i == 105 else t)
        got = odt.read_acquisition_ranges(p)
        self.assertIsNone(got["rows"])
        self.assertTrue(got["reason"].startswith("group_not_promoter"), got["reason"])
        self.assertEqual(got["page"], 105)

    def test_a_promoter_caption_is_read(self):
        # Minimal edits: no no-promoter sentence, and the caption names the Promoters only.
        def edit(i, t):
            if i != 105:
                return t
            return (t.replace(_NO_PROMOTER, "Our Company has a promoter")
                    .replace("transacted by the Selling Shareholders and",
                             "transacted by our Promoters in three years and"))
        got = odt.read_acquisition_ranges(_nse_pages(edit))
        self.assertEqual(got["rows"]["1Y"]["waca"], 1909.02)
        self.assertIn("Promoters", got["group"])

    def test_od174_promoters_with_special_rights_holders_is_not_the_promoters_table(self):
        # OD-174 (owner, 2026-10-07): the caption names the Promoters TOGETHER with the shareholders
        # entitled to special rights -> rows 161-165 null, caption_mixes_groups. (Before OD-174 this
        # caption was read as the promoters' table.)
        def edit(i, t):
            if i != 105:
                return t
            return (t.replace(_NO_PROMOTER, "Our Company has a promoter")
                    .replace("transacted by the Selling Shareholders and", "transacted by our Promoters and"))
        got = odt.read_acquisition_ranges(_nse_pages(edit))
        self.assertIsNone(got["rows"])
        self.assertTrue(got["reason"].startswith("caption_mixes_groups"), got["reason"])

    def test_never_the_first_caption_a_later_promoter_caption_wins(self):
        # Minimal edits: no no-promoter sentence; a promoter table (p107, 1Y WACA 1,111.11) after
        # the selling-shareholder one.
        base = _nse_pages(lambda i, t: t.replace(_NO_PROMOTER, "Our Company has a promoter") if i == 105 else t)
        p106 = dict(base)[106]
        promoter = ("10. Weighted average cost of acquisition of all Equity Shares transacted by our Promoters in\n"
                    "one year, 18 months and three years preceding this Draft Red Herring Prospectus\n"
                    + p106.replace("Last one year 1,909.02", "Last one year 1,111.11"))
        got = odt.read_acquisition_ranges(base + [(107, promoter)])
        self.assertEqual(got["page"], 107)
        self.assertEqual(got["rows"]["1Y"]["waca"], 1111.11)


class TrackRecordAliases(unittest.TestCase):
    def test_short_caption_must_name_the_heading_firm(self):
        # Minimal edit: p435's "handled by JM:" caption reads "handled by Citi:" under the JM heading.
        p = _nse_pages(lambda i, t: t.replace("handled by JM", "handled by Citi") if i == 435 else t)
        rows, _p, problems = odt.read_brlm_track_record(p, NSE_BRLMS)
        self.assertNotIn("JM Financial Limited", {r["brlm"] for r in rows})
        self.assertTrue(any("caption_alias_does_not_name_heading_firm" in x for x in problems), problems)

    def test_alias_matching(self):
        self.assertTrue(odt.alias_names_firm("Kotak", "Kotak Mahindra Capital Company Limited"))
        self.assertTrue(odt.alias_names_firm("JM", "JM Financial Limited"))
        self.assertTrue(odt.alias_names_firm("JPM", "J.P. Morgan India Private Limited"))
        self.assertTrue(odt.alias_names_firm("MS", "Morgan Stanley India Company Private Limited"))
        self.assertTrue(odt.alias_names_firm("I-Sec", "ICICI Securities Limited"))
        self.assertTrue(odt.alias_names_firm("SBICAPS", "SBI Capital Markets Limited"))
        self.assertFalse(odt.alias_names_firm("JM", "J.P. Morgan India Private Limited"))
        self.assertFalse(odt.alias_names_firm("Citi", "JM Financial Limited"))
        self.assertFalse(odt.alias_names_firm("Axis", "IIFL Capital Services Limited"))

    def test_ltd_and_limited_are_one_firm(self):
        # B4: a full caption printing "Ltd" takes the document list's "Limited" spelling.
        self.assertEqual(odt._match_firm("DAM Capital Advisors Ltd", NSE_BRLMS), "DAM Capital Advisors Limited")
        p = _nse_pages(lambda i, t: t.replace("DAM Capital Advisors Limited", "DAM Capital Advisors Ltd"))
        rows, _p, _pr = odt.read_brlm_track_record(p, NSE_BRLMS)
        self.assertIn("DAM Capital Advisors Limited", {r["brlm"] for r in rows})
        self.assertEqual(odt.name_key("X Pvt Ltd"), odt.name_key("X Private Limited"))


class GrievanceStopHeadings(unittest.TestCase):
    def test_label_below_a_registrar_heading_is_never_a_brlms(self):
        with open(os.path.join(FIX, "nse-drhp-brlm-contacts-p89.json"), encoding="utf-8") as fh:
            fx = json.load(fh)
        words = fx["words"]
        ms_top = min(w["top"] for w in words if w["text"] == "Morgan" and w["x0"] < 100)
        kotak_label_top = min(w["top"] for w in words if w["text"] == "kmccredressal@kotak.com")
        # Minimal edit of the real word boxes: the Kotak/JM row only, Kotak's own grievance line
        # removed, then a "Registrar to the Offer" block in Kotak's column below it.
        top_part = [w for w in words if w["top"] < ms_top - 2 and abs(w["top"] - kotak_label_top) > 1]
        base = max(w["top"] for w in top_part) + 14
        add = []
        for k, line in enumerate(["Registrar to the Offer", "KFin Technologies Limited",
                                  "Investor grievance e-mail: einward.ris@kfintech.com"]):
            x = 54.0
            for word in line.split():
                add.append({"text": word, "x0": x, "x1": x + 6 * len(word), "top": base + 12 * k})
                x += 6 * len(word) + 3
        got, problems = odt.read_grievance_emails([(89, fx["page_text"])], lambda i: top_part + add, NSE_BRLMS)
        self.assertNotIn("Kotak Mahindra Capital Company Limited", got or {})
        self.assertEqual((got or {}).get("JM Financial Limited"), "grievance.ibd@jmfl.com")
        self.assertTrue(any("label_under_a_non_brlm_heading" in x for x in problems), problems)


if __name__ == "__main__":
    unittest.main()
