"""#1477 / F-231: a price band advert's band read with its leading digit(s) lost.

Fixtures under scraper/tests/fixtures/price-band-ad/ are the stored page texts
(document_pages) of real adverts on staging; the source URL of each is in its
.meta.json. Glass Wall's real band is Rs 172-182 (stored 72-82 on staging).
"""

import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import ocr_pages  # noqa: E402
from extract_filing import run  # noqa: E402

FIX = os.path.join(HERE, "..", "tests", "fixtures", "price-band-ad")


def load(name):
    with open(os.path.join(FIX, name + ".json"), encoding="utf-8") as fh:
        return [(int(i), t) for i, t in json.load(fh)["pages"]]


def read(name, segment="MAINBOARD"):
    pages = load(name)
    return run(pages, "PRICE_BAND_AD", name, segment, ocr_confidence={p: 95 for p, _ in pages})["fields"]


def ocr_band(floor, cap, page=1):
    f = {"value": floor, "page": page, "state": "VALUE", "source_text": "OCR",
         "check": {"name": "price_band_ordering", "passed": True, "detail": ""}}
    c = dict(f, value=cap)
    return {"price_band_floor": f, "price_band_cap": copy.deepcopy(c)}


def test_glass_wall_reads_the_printed_band_not_the_digit_lost_one():
    f = read("glass-wall-ocr-price-band-ad")
    assert (f["price_band_floor"]["value"], f["price_band_cap"]["value"]) == (172.0, 182.0)
    assert f["price_band_floor"]["state"] == "VALUE"
    assert f["face_value"]["value"] == 2.0


def test_face_value_of_ten_is_not_read_as_zero():
    # "FACE VALUE OF 10 EACH" with no rupee glyph: the old `\S?` slot ate the "1".
    f = read("veegaland-price-band-ad")
    assert f["face_value"]["value"] == 10.0
    assert (f["price_band_floor"]["value"], f["price_band_cap"]["value"]) == (130.0, 140.0)


def _ambiguous(field, reason):
    # The non-clearing outcome: MISSED (reread-answer-clear KEEPs a stored value), never REFUSED.
    assert field["state"] == "MISSED", field
    assert field["value"] is None
    assert "refused_value" not in field
    assert field["check"]["name"] == "not_extractable" and field["check"]["passed"] is True
    assert field["check"]["detail"].startswith(reason)


def test_guard_misses_glass_walls_digit_lost_band_without_clearing():
    texts = dict(load("glass-wall-ocr-price-band-ad"))
    fields = ocr_pages.guard_price_band_lost_digit(ocr_band(72.0, 82.0), texts)
    _ambiguous(fields["price_band_floor"], ocr_pages.OCR_PRICE_LOST_DIGIT_REASON)
    _ambiguous(fields["price_band_cap"], ocr_pages.OCR_PRICE_LOST_DIGIT_REASON)
    assert "172" in fields["price_band_floor"]["check"]["detail"]
    assert "182" in fields["price_band_cap"]["check"]["detail"]


def test_guard_keeps_glass_walls_correct_band():
    texts = dict(load("glass-wall-ocr-price-band-ad"))
    fields = ocr_pages.guard_price_band_lost_digit(ocr_band(172.0, 182.0), texts)
    assert fields["price_band_floor"]["value"] == 172.0 and fields["price_band_cap"]["value"] == 182.0
    assert fields["price_band_floor"]["state"] == "VALUE"


def test_guard_misses_both_ends_when_one_end_lost_a_digit():
    texts = dict(load("glass-wall-ocr-price-band-ad"))
    fields = ocr_pages.guard_price_band_lost_digit(ocr_band(172.0, 82.0), texts)
    _ambiguous(fields["price_band_cap"], ocr_pages.OCR_PRICE_LOST_DIGIT_REASON)
    _ambiguous(fields["price_band_floor"], ocr_pages.OCR_PRICE_SIBLING_REASON)


def test_guard_keeps_a_band_whose_rupee_glyph_was_ocrd_as_a_digit():
    # ESDS prints Rs 408 / Rs 429 elsewhere with the glyph read as a digit ("2408", "8429"):
    # no valid alternative band, so the correct read stays.
    f = read("esds-ocr-price-band-ad")
    assert (f["price_band_floor"]["value"], f["price_band_cap"]["value"]) == (408.0, 429.0)
    texts = dict(load("esds-ocr-price-band-ad"))
    assert "8429" in ocr_pages.band_mentions("price_band_cap", list(texts.values()))


def test_guard_judges_only_ocr_reads():
    texts = dict(load("glass-wall-ocr-price-band-ad"))
    band = ocr_band(72.0, 82.0)
    for f in band.values():
        f["source_text"] = "TEXT"
    fields = ocr_pages.guard_price_band_lost_digit(band, texts)
    assert fields["price_band_floor"]["value"] == 72.0


def test_guard_keeps_a_band_the_advert_never_mentions_again():
    fields = ocr_pages.guard_price_band_lost_digit(ocr_band(72.0, 82.0), {1: "PRICE BAND: 72.00 TO 82.00"})
    assert fields["price_band_floor"]["state"] == "VALUE"


def test_advert_carries_the_cover_readers_website_without_replacing_its_own_answers():
    # Item 39 round 2: Adroit's advert prints the issuer's website and contact block; the cover
    # reader adds them (page 0 = printed page 1), and the band reads 126-134 (it was REFUSED as
    # 26 / 34 before the glyph-slot fix - a refusal clears a stored value).
    f = read("adroit-price-band-ad")
    assert (f["price_band_floor"]["value"], f["price_band_cap"]["value"]) == (126.0, 134.0)
    assert f["company_website"]["value"] == "www.adroitindustries.com"
    assert f["compliance_officer_email"]["value"] == "cs@adroitindustries.com"
    g = read("glass-wall-ocr-price-band-ad")
    # the advert's own compliance-officer reader keeps its answer
    assert g["compliance_officer"]["value"] == "Shanti Gopalkrishnan account"


# ---- PR #1483 review round 1 -------------------------------------------------------------- #
def test_review_probe_glyph_read_as_7_on_both_ends_keeps_the_true_band():
    # MAJOR-1 probe: the market-cap row prints the glyph as a 7 on both ends.
    texts = {1: "PRICE BAND: 408.00 TO 429.00 PER EQUITY SHARE\n"
                "At Floor Price of 7408.00 per equity share At Cap Price of 7429.00 per equity share"}
    fields = ocr_pages.guard_price_band_lost_digit(ocr_band(408.0, 429.0), texts)
    assert fields["price_band_floor"]["value"] == 408.0 and fields["price_band_cap"]["value"] == 429.0


def test_review_probe_pe_line_is_not_evidence():
    # MAJOR-1 probe: a P/E line's floor / cap prices never contradict a true 72-82 band.
    texts = {1: "PRICE BAND: 72.00 TO 82.00 PER EQUITY SHARE\n"
                "P/E at Floor Price 172 / Cap Price 182"}
    fields = ocr_pages.guard_price_band_lost_digit(ocr_band(72.0, 82.0), texts)
    assert fields["price_band_floor"]["state"] == "VALUE" and fields["price_band_cap"]["value"] == 82.0


def test_non_integer_mentions_are_not_evidence():
    assert ocr_pages.band_mentions("price_band_floor", ["FLOOR PRICE 16.54"]) == []


def test_glyph_read_as_extra_digit_on_the_band_and_face_value_is_never_a_value():
    # MAJOR-2: the rupee glyph OCR'd as a leading 7 - "Rs 172.00" -> "7172.00", "Rs 2" -> "72" -
    # on glass-wall's own text, through the real reader.
    pages = [(i, t.replace("PRICE BAND: 172.00 TO 182.00 PER EQUITY SHARE OF FACE VALUE OF 2 EACH",
                           "PRICE BAND: 7172.00 TO 7182.00 PER EQUITY SHARE OF FACE VALUE OF 72 EACH"))
             for i, t in load("glass-wall-ocr-price-band-ad")]
    assert any("7172.00 TO 7182.00" in t for _, t in pages)
    f = run(pages, "PRICE_BAND_AD", "g", "MAINBOARD", ocr_confidence={p: 95 for p, _ in pages})["fields"]
    _ambiguous(f["price_band_floor"], ocr_pages.OCR_PRICE_EXTRA_DIGIT_REASON)
    _ambiguous(f["price_band_cap"], ocr_pages.OCR_PRICE_EXTRA_DIGIT_REASON)
    _ambiguous(f["face_value"], ocr_pages.OCR_FACE_EXTRA_DIGIT_REASON)


def test_a_true_face_value_of_two_is_kept():
    f = read("glass-wall-ocr-price-band-ad")
    assert f["face_value"]["value"] == 2.0 and f["face_value"]["state"] == "VALUE"


def test_glass_wall_digit_lost_read_through_the_real_reader_is_missed_not_refused():
    # The pre-fix read (72 / 82) produced by the reader itself, then the guard: never REFUSED.
    pages = [(i, t.replace("PRICE BAND: 172.00 TO 182.00", "PRICE BAND: 72.00 TO 82.00"))
             for i, t in load("glass-wall-ocr-price-band-ad")]
    f = run(pages, "PRICE_BAND_AD", "g", "MAINBOARD", ocr_confidence={p: 95 for p, _ in pages})["fields"]
    for name in ("price_band_floor", "price_band_cap", "face_value", "lot_size"):
        assert f[name]["state"] != "REFUSED", (name, f[name])
    _ambiguous(f["price_band_floor"], ocr_pages.OCR_PRICE_LOST_DIGIT_REASON)


def test_an_ocr_band_its_ordering_check_refused_is_kept_not_cleared():
    # omara-ventures' advert: "PRICE BAND: 296.00 to 31 1.00" (OCR split 311). A text read refuses;
    # an OCR read is MISSED, so a stored 296-311 survives the re-read.
    pages = [(1, "PRICE BAND: 296.00 to 31 1.00 PER EQUITY SHARE OF FACE VALUE OF 10.00 EACH")]
    f = run(pages, "PRICE_BAND_AD", "o", "MAINBOARD", ocr_confidence={1: 95})["fields"]
    _ambiguous(f["price_band_floor"], ocr_pages.OCR_PRICE_UNORDERED_REASON)
    _ambiguous(f["price_band_cap"], ocr_pages.OCR_PRICE_UNORDERED_REASON)
    t = run(pages, "PRICE_BAND_AD", "o", "MAINBOARD")["fields"]
    assert t["price_band_floor"]["state"] == "REFUSED"
