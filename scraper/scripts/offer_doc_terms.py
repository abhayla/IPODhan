"""Offer terms the price band advert reader prints, read from the offer document itself (F-242).

Spec: data-sourcing-pull-model.md section 2.5.6 (OD-164) and OD-96. The fields below carry the
manifest documentType PRICE_BAND_AD, whose family (scraper/config/document-families.json) is
PRICE_BAND_AD, RHP, PROSPECTUS and DRHP, so an offer document may answer them. Until this module
they were read only by `extract_price_band_ad`, which `run()` calls for adverts alone.

The advert reader is NOT reused for offer documents. Measured on the NSE DRHP (d88fad44) and 12
other real DRHPs: its patterns match the advert's newspaper wording, not the SEBI ICDR prose of an
offer document, and run over 600 pages its first-match readers return wrong values (the business
description became a US securities-law paragraph; issue_structure read FRESH_AND_OFS for a pure
offer for sale). These readers match the offer document's own mandated sentences instead.

Fail closed. Every reader collects EVERY occurrence in the document; it answers only when all of
them agree. Answer states (answer_states.py):
    printed      -> VALUE
    not found    -> MISSED (reason `<field>_sentence_not_found`)
    unfilled     -> MISSED (the sentence prints "[*]", as a DRHP does before the RHP)
    ambiguous    -> MISSED (reason names both readings)
    check failed -> MISSED (allocation that does not add up)
A miss never clears a stored value (OD-153), and these readers never count as a failed check, so
they cannot turn a document's extraction status PARTIAL. No reader here emits STATED_NOT_PRINTED
or REFUSED: an offer document's silence on an advert field is not a statement that it is absent.
"""

import re

PLACEHOLDER = re.compile(r"\[\s*[●•*]?\s*\]")

DESIGNATED_RX = re.compile(
    r"Designated\s+Stock\s+Exchange\s+(?:shall\s+be|will\s+be|is)\s+(?:the\s+)?"
    r"(\[\s*[●•*]?\s*\]|(?:National\s+Stock\s+Exchange\s+of\s+India\s+Limited|BSE\s+Limited"
    r"|NSE|BSE)\b)", re.I)

# "This Offer is being made through the Book Building Process in compliance with Regulations 6(1)
# and 32(1)". Only a sentence that names the Book Building Process is read: the persister turns this
# citation into issue_type BOOK_BUILDING, and "made in terms of Regulation 6(1)" alone does not say
# the offer is book built.
REGULATION_RX = re.compile(
    r"Book\s+Building\s+Process,?\s+(?:in\s+compliance\s+with|in\s+accordance\s+with|in\s+terms\s+of"
    r"|pursuant\s+to|under)\s+Regulations?\s+(\d+\s*\(\s*\d+\s*\))", re.I)

UPI_RX = re.compile(
    r"UPI\s+mandate\s+end\s+time(?:\s+and\s+date)?\s+shall\s+be\s+(?:at\s+)?"
    r"(\d{1,2})[.:](\d{2})\s*(a\.?\s?m|p\.?\s?m)\.?", re.I)

_PORTION = (r"(?:not\s+(?:more|less)\s+than|at\s+least)\s+(\d+(?:\.\d+)?)\s*%\s+of\s+the\s+"
            r"(?:Net\s+)?(?:Offer|Issue)\s+"
            r"shall\s+be\s+(?:available\s+for\s+allocation|allocated|allotted)\s+"
            r"(?:on\s+a\s+proportionate\s+basis\s+)?to\s+")
# The SME layout (Chapter IX) names the retail category "Individual Bidders/Investors" (R K Fashion
# DRHP); "Non-Institutional" cannot match it because the category word must follow "to ".
ALLOCATION_RX = {
    "qib_pct": re.compile(_PORTION + r"(?:QIBs?|Qualified\s+Institutional\s+Buyers)\b", re.I),
    "nii_pct": re.compile(_PORTION + r"(?:NIBs?|NIIs?|Non[-\s]?Institutional\s+(?:Bidders|Investors))\b",
                          re.I),
    "retail_pct": re.compile(_PORTION + r"(?:RIBs?|RIIs?|(?:Retail\s+)?Individual\s+(?:Bidders|Investors))\b",
                             re.I),
}


def _joined(page_texts):
    """(text, offsets): every page joined with spaces, so a sentence wrapped over lines matches, and
    the start offset of each page so a match can name its page."""
    parts, offsets, pos = [], [], 0
    for i, t in page_texts:
        flat = re.sub(r"\s+", " ", t or "")
        offsets.append((pos, i))
        parts.append(flat)
        pos += len(flat) + 1
    return " ".join(parts), offsets


def _page_at(offsets, pos):
    page = None
    for start, i in offsets:
        if start > pos:
            break
        page = i
    return page


def _consensus(readings):
    """readings: [(value, page)]. -> (value, first page, None) when all agree, else
    (None, None, reason)."""
    if not readings:
        return None, None, "not_found"
    values = []
    for v, _p in readings:
        if v not in values:
            values.append(v)
    if len(values) > 1:
        return None, None, "ambiguous: %s" % " vs ".join(str(v) for v in values)
    return values[0], readings[0][1], None


def _exchange(token):
    t = re.sub(r"\s+", " ", token).strip().upper()
    if PLACEHOLDER.fullmatch(token.strip()):
        return None
    if t in ("NSE", "NATIONAL STOCK EXCHANGE OF INDIA LIMITED"):
        return "NSE"
    if t in ("BSE", "BSE LIMITED"):
        return "BSE"
    return None


def _emit(emit, name, value, page, reason, check_name):
    if reason is None:
        emit.put(name, value, page, check_name, (True, "%s" % value))
    else:
        emit.null(name, "%s_%s" % (name, reason) if reason == "not_found" else reason, page)


def read_designated_exchange(text, offsets, emit):
    readings, unfilled = [], False
    for m in DESIGNATED_RX.finditer(text):
        ex = _exchange(m.group(1))
        if ex is None:
            unfilled = True
            continue
        readings.append((ex, _page_at(offsets, m.start())))
    value, page, reason = _consensus(readings)
    if reason == "not_found" and unfilled:
        reason = "designated_exchange_not_yet_filled"
    _emit(emit, "designated_stock_exchange", value, page, reason, "designated_exchange_consensus")


def read_book_building_regulation(text, offsets, emit):
    readings = [(re.sub(r"\s+", "", m.group(1)), _page_at(offsets, m.start()))
                for m in REGULATION_RX.finditer(text)]
    value, page, reason = _consensus(readings)
    _emit(emit, "book_building_regulation", value, page, reason, "regulation_consensus")


def read_upi_cutoff(text, offsets, emit):
    readings = []
    for m in UPI_RX.finditer(text):
        hh, mm = int(m.group(1)), int(m.group(2))
        if not (1 <= hh <= 12 and 0 <= mm <= 59):
            continue
        if m.group(3).lower().startswith("p") and hh != 12:
            hh += 12
        readings.append(("%02d:%02d" % (hh, mm), _page_at(offsets, m.start())))
    value, page, reason = _consensus(readings)
    _emit(emit, "upi_cutoff_time", value, page, reason, "upi_cutoff_consensus")


def read_allocation(text, offsets, emit, check_allocation):
    """QIB / NII / retail portions of the Net Offer. Written only as a set of three that passes the
    advert's own allocation check (sum <= 100, QIB >= 50); any category missing, ambiguous or a set
    that fails the check leaves all three MISSED."""
    found, page, reason = {}, None, None
    for name, rx in ALLOCATION_RX.items():
        readings = [(float(m.group(1)), _page_at(offsets, m.start())) for m in rx.finditer(text)]
        value, p, r = _consensus(readings)
        if r is not None:
            reason = reason or "%s_%s" % (name, r)
            continue
        found[name] = value
        page = page if page is not None else p
    if reason is None:
        passed, detail = check_allocation(found["qib_pct"], found["nii_pct"], found["retail_pct"])
        if not passed:
            reason = "allocation_check_failed: %s" % detail
        elif abs(found["qib_pct"] + found["nii_pct"] + found["retail_pct"] - 100) > 0.5:
            # The three portions are the whole Net Offer; a set that does not add to 100 is a
            # mis-read (a sentence about another portion), never a value.
            reason = "allocation_not_whole_net_offer: sum %s" % (
                found["qib_pct"] + found["nii_pct"] + found["retail_pct"])
    for name in ALLOCATION_RX:
        if reason is None:
            emit.put(name, found[name], page, "allocation_sums_and_qib_floor",
                     (True, "QIB %s + NII %s + Retail %s" % (
                         found["qib_pct"], found["nii_pct"], found["retail_pct"])))
        else:
            emit.null(name, reason, page)


def read_offer_terms(page_texts, emit, check_allocation):
    """Run every reader; a field another reader of this document already emitted is left alone."""
    text, offsets = _joined(page_texts)
    shadow = type(emit)(emit.source_doc)
    read_designated_exchange(text, offsets, shadow)
    read_book_building_regulation(text, offsets, shadow)
    read_upi_cutoff(text, offsets, shadow)
    read_allocation(text, offsets, shadow, check_allocation)
    for name, field in shadow.fields.items():
        if name not in emit.fields:
            emit.fields[name] = field
