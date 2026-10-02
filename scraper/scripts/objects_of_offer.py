"""E5 / item 40: the objects-of-the-offer table of a DRHP / RHP / PROSPECTUS.

Spec data-sourcing-pull-model.md section 1.2 row 27 (`ipos.objectives`, unit -> Cr, check F4: "sum of
objects + GCP ~ net proceeds +-1%; GCP <= 25% of gross"; "Rights/OFS: no objects section; expect empty,
not a gap"), section 2.5.6 item 3 (OD-164(c)), F-225 (the old reader only knew one heading).

The reader answers one of four states, and never guesses:

    TABLE        a utilisation table was read: items in Cr, the F4 verdict attached
    STATED_NONE  the chapter states the company receives no proceeds (a pure offer for sale)
    UNREADABLE   a table with amounts was found but cannot be turned into rows safely
                 (no unit line, nested sub-objects): a miss, never a value
    NOT_FOUND    no utilisation table anywhere (a miss, never a stated absence)

Amounts are converted to crore exactly once, from the unit the document prints next to the table. A table
whose unit line cannot be read is UNREADABLE (a 10x error is worse than a gap).
"""

import re

import answer_states

# A heading that opens the utilisation table. Real headings seen (F-225): "Utilisation of Net Proceeds",
# "Utilization of Net Proceeds", "Requirements of funds and utilization of Net Proceeds",
# "Requirement of Funds and Utilization of Net Fresh Offer Proceeds:", "REQUIREMENT OF FUNDS AND UTILIZATION
# OF NET PROCEEDS", "Utilisation of Net Proceeds and Schedule of Implementation and Deployment".
_HEAD_RX = re.compile(
    r"^\s*(?:requirements?\s+of\s+funds\s+and\s+)?utili[sz]ation\s+of\s+(?:the\s+)?net\s+"
    r"(?:fresh\s+)?(?:offer\s+|issue\s+)?proceeds\b[^.\n]{0,90}$", re.I)
_OBJECTS_HEAD_RX = re.compile(r"^\s*OBJECTS OF THE (?:OFFER|ISSUE)\s*$")

_UNIT_WORD_RX = re.compile(r"\b(million|mn|lakhs?|lacs?|crores?)\b", re.I)
_UNIT_CONTEXT_RX = re.compile(r"(?:₹|\bRs\b|\bINR\b|\bin\b|\bis\b)", re.I)
_UNIT_TO_CR = {"million": 0.1, "mn": 0.1, "lakh": 0.01, "lakhs": 0.01, "lac": 0.01, "lacs": 0.01,
               "crore": 1.0, "crores": 1.0}

_NUM = r"\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?"
_TOK = r"(?:\[\s*\S{0,3}\s*\]|(?<![\d,.])(?:" + _NUM + r")(?![\d,]))"
_DEC_RX = re.compile(r"\d[\d,]*\.\d{2}")
_YEAR_RX = re.compile(r"^(?:19|20)\d{2}$")
_YEAR_CONTEXT_RX = re.compile(
    r"(?:\b(?:fy|fiscal|financial\s+year|year|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|"
    r"july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|in|by|before|until|"
    r"upto|up\s+to|from|since|for|of|to)\.?\s*[-:]?)$", re.I)
_TAIL_RX = re.compile(r"(?P<run>(?:\s+" + _TOK + r"[\^*#]*(?:\(\d\))?%?)+)\s*$")
_AMOUNT_RX = re.compile(_TOK)
_SERIAL_RX = re.compile(r"^(\d{1,2})[.)]?\s+(?=[A-Z(\[])")
_NESTED_RX = re.compile(r"^\(?(?:[ivx]{1,4}|[a-d])\)\s")
_TOTAL_RX = re.compile(r"^(?:total\b|net\s+(?:offer\s+|issue\s+|fresh\s+)?proceeds\b)", re.I)
_STOP_RX = re.compile(
    r"^(?:proposed\s+schedule|schedule\s+of\s+implementation|means\s+of\s+finance|details\s+of\s+"
    r"(?:the\s+)?objects|the\s+(?:above|funding|fund)\b|we\s+propose|our\s+company\b|appraisal)", re.I)
_HEADER_RX = re.compile(
    r"^(?:sr\.?|sl\.?|s\.?\s*no|particulars|estimated|amount|%|percent|\(?(?:in|amount)\b)", re.I)
_FOOTNOTE_RX = re.compile(r"^(?:\(\d\)|[*^#])")
_PAGE_NO_RX = re.compile(r"^\d{1,3}$")
_GCP_RX = re.compile(r"general\s+corporate", re.I)
_GROSS_RX = re.compile(r"^gross\s+proceeds\b.*?(" + r"\d[\d,]*(?:\.\d{1,2})?" + r")\s*$", re.I)
_NET_RX = re.compile(r"^net\s+(?:offer\s+|issue\s+|fresh\s+)?proceeds\b.*?(\d[\d,]*(?:\.\d{1,2})?)\s*$", re.I)
_PLACEHOLDER_END_RX = re.compile(r"^(?:gross|net)\s+(?:offer\s+|issue\s+|fresh\s+)?proceeds\b.*\[\s*\S{0,3}\s*\]\s*$", re.I)
_MARKS_RX = re.compile(r"\(\d\)|[#*^]")
_OFS_ONLY_RX = re.compile(
    r"(?:our\s+)?company\s+will\s+not\s+receive\s+(?:any\s+|the\s+)?(?:of\s+the\s+)?(?:offer\s+)?proceeds", re.I)

NO_FRESH_ISSUE_REASON = "no_fresh_issue_pure_offer_for_sale"
FRESH_ISSUE_ELSEWHERE_REASON = "fresh_issue_mentioned_outside_objects_page"
_FRESH_ISSUE_RX = re.compile(r"fresh\s+(?:issue|offer)", re.I)
GCP_MAX_SHARE_OF_GROSS = 0.25
F4_TOLERANCE = 0.01


def _num(tok):
    return float(tok.replace(",", ""))


def _unit_of(line):
    """The unit word a table-header line prints, e.g. '(Rs. in Lacs)' -> 'lacs', or None."""
    s = line.strip()
    if len(s) > 70 or _DEC_RX.search(s):
        return None
    m = _UNIT_WORD_RX.search(s)
    if m and _UNIT_CONTEXT_RX.search(s):
        return m.group(1).lower()
    return None


def _split_amount(line):
    """(label, first_amount_token or None). The first token of the trailing run is the amount; the
    other tokens are percentage columns. A bare year in the label ("FY 2027", "March 2027") is label
    text, never the amount."""
    m = _TAIL_RX.search(line)
    if not m:
        return line.strip(), None
    toks = [t.group(0) for t in _AMOUNT_RX.finditer(m.group("run"))]
    cut = m.start()
    head = line[:cut]
    while toks and _YEAR_RX.match(toks[0]) and (len(toks) > 1 or _YEAR_CONTEXT_RX.search(head.rstrip())):
        k = m.group("run").index(toks[0])
        cut = m.start() + k + len(toks[0])
        head = line[:cut]
        toks.pop(0)
    if not toks:
        return line.strip(), None
    return head.strip(), toks[0]


def _clean_label(parts):
    label = re.sub(r"\s+", " ", " ".join(p for p in parts if p)).strip()
    label = re.sub(r"\(\d\)", "", label)
    label = re.sub(r"\s*[#*^]+\s*$", "", label).strip()
    return re.sub(r"\s+", " ", label).strip(" ;:")


def _lines_from(page_texts, pos, line_no):
    """Lines of page `pos` from `line_no`, then the next page (a table can run over a page break)."""
    out = []
    for k in (pos, pos + 1):
        if k >= len(page_texts):
            break
        ls = (page_texts[k][1] or "").split("\n")
        if k == pos:
            ls = ls[line_no:]
        out.extend((page_texts[k][0], ln) for ln in ls)
    return out


def _parse_table(lines):
    """Rows of one utilisation table. Returns (rows, total, unit, page, problem)."""
    unit, rows, total, nested = None, [], None, False
    serial_mode = None
    first_page = None
    for page, raw in lines:
        s = raw.strip()
        if not s or _PAGE_NO_RX.match(s):
            continue
        if not rows and total is None:
            u = _unit_of(s)
            if u and unit is None:
                unit = u
                continue
        if rows or total is not None:
            if _STOP_RX.match(s) or _FOOTNOTE_RX.match(s):
                break
        if _TOTAL_RX.match(s):
            _label, tok = _split_amount(s)
            if tok is not None and (rows or serial_mode is not None or unit is not None):
                total = None if tok.startswith("[") else _num(tok)
                break
        if _NESTED_RX.match(s) and not _SERIAL_RX.match(s):
            nested = True
            break
        sm = _SERIAL_RX.match(s)
        if serial_mode is None and not rows and (sm or _split_amount(s)[1] is not None):
            serial_mode = bool(sm)
        if serial_mode is None:
            if _HEADER_RX.match(s):
                continue
            continue
        body = s[sm.end():] if sm else s
        label, tok = _split_amount(body)
        if serial_mode:
            if sm:
                rows.append({"serial": int(sm.group(1)), "parts": [label], "tok": tok})
                if first_page is None:
                    first_page = page
            elif rows:
                lab, t = _split_amount(s)
                rows[-1]["parts"].append(lab)
                if rows[-1]["tok"] is None and t is not None:
                    rows[-1]["tok"] = t
            continue
        # serial-less rows: a new row starts at an upper-case line once the previous row has its amount;
        # a lower-case or bracketed line wraps the previous row's label.
        if rows and (s[0].islower() or s[0] in "(&") and not _TOTAL_RX.match(s):
            rows[-1]["parts"].append(label)
            if rows[-1]["tok"] is None and tok is not None:
                rows[-1]["tok"] = tok
            continue
        if _HEADER_RX.match(s) and tok is None and not rows:
            continue
        rows.append({"serial": len(rows) + 1, "parts": [label], "tok": tok})
        if first_page is None:
            first_page = page
    return rows, total, unit, first_page, ("nested_objects_table" if nested else None)


def _items(rows, unit):
    factor = _UNIT_TO_CR[unit]
    out = []
    for r in rows:
        label = _clean_label(r["parts"])
        if not label:
            continue
        tok = r["tok"]
        if tok is None:
            out.append({"serial": r["serial"], "label": label, "printed_amount": None,
                        "printed_unit": unit, "amount_cr": None, "check": "no_amount_printed"})
        elif tok.startswith("["):
            out.append({"serial": r["serial"], "label": label, "printed_amount": None,
                        "printed_unit": unit, "amount_cr": None, "check": "not_priced_yet"})
        else:
            v = _num(tok)
            out.append({"serial": r["serial"], "label": label, "printed_amount": v,
                        "printed_unit": unit, "amount_cr": round(v * factor, 4), "check": "priced"})
    return out


def _proceeds_in_cr(page_texts, pos, head_line, unit):
    """(gross_cr, net_cr) printed in the proceeds table just above the utilisation heading, only when it
    prints the same unit as the utilisation table."""
    factor = _UNIT_TO_CR[unit]
    lines = []
    if pos > 0:
        lines.extend((page_texts[pos - 1][1] or "").split("\n"))
    lines.extend((page_texts[pos][1] or "").split("\n")[:head_line])
    gross = net = None
    unpriced = False
    for i, raw in enumerate(lines):
        s = re.sub(r"^\d{1,2}\.\s+", "", _MARKS_RX.sub("", raw).strip())
        for rx, which in ((_GROSS_RX, "g"), (_NET_RX, "n")):
            m = rx.match(s)
            ph = _PLACEHOLDER_END_RX.match(s) if rx is _GROSS_RX or rx is _NET_RX else None
            if not m and not ph:
                continue
            u = None
            for back in range(i - 1, max(-1, i - 9), -1):
                u = _unit_of(lines[back])
                if u:
                    break
            if u is None or _UNIT_TO_CR[u] != factor:
                continue
            if not m:
                unpriced = True
                continue
            v = round(_num(m.group(1)) * factor, 4)
            if which == "g":
                gross = v
            else:
                net = v
    return gross, net, unpriced


def check_f4(items, net_cr, gross_cr, total_cr, tol=F4_TOLERANCE, proceeds_unpriced=False):
    """Row 27's F4: objects + GCP ~ net proceeds within 1%; GCP <= 25% of gross.

    A red herring prospectus prints [bullet] for the general-corporate-purposes row and sometimes for the
    net proceeds (the price is not set), so an unpriced table is checked against the bound that IS
    verifiable (priced objects never exceed the net proceeds, or the gross when the net is unpriced)."""
    priced = [i["amount_cr"] for i in items if i["amount_cr"] is not None]
    unpriced = len(items) - len(priced)
    if not priced:
        return answer_states.missed("no object amount printed")
    total = sum(priced)
    ref = net_cr if net_cr is not None else total_cr
    ref_name = "net proceeds" if net_cr is not None else "printed total"
    gcp_notes = ""
    gcp = [i["amount_cr"] for i in items if _GCP_RX.search(i["label"]) and i["amount_cr"] is not None]
    if gcp and gross_cr:
        if gcp[0] > gross_cr * GCP_MAX_SHARE_OF_GROSS + 0.005:
            return answer_states.refused("general corporate purposes %.2f Cr exceeds 25%% of gross proceeds %.2f Cr"
                                         % (gcp[0], gross_cr))
        gcp_notes = "; GCP %.2f Cr <= 25%% of gross %.2f Cr" % (gcp[0], gross_cr)
    if unpriced == 0:
        if ref is None:
            return answer_states.missed("no net proceeds or printed total to reconcile against")
        if abs(total - ref) > ref * tol:
            return answer_states.refused("objects sum %.2f Cr != %s %.2f Cr" % (total, ref_name, ref))
        if total_cr is not None and net_cr is not None and abs(total - total_cr) > total_cr * tol:
            return answer_states.refused("objects sum %.2f Cr != printed total %.2f Cr" % (total, total_cr))
        return True, "objects sum %.2f Cr == %s %.2f Cr%s" % (total, ref_name, ref, gcp_notes)
    bound, bound_name = (net_cr, "net proceeds") if net_cr is not None else (gross_cr, "gross proceeds")
    if bound is None:
        if proceeds_unpriced:
            return True, ("priced objects %.2f Cr; gross and net proceeds are unpriced ([bullet]), %d object(s) "
                          "unpriced: F4 not verifiable before the price is set%s" % (total, unpriced, gcp_notes))
        return answer_states.missed("no net or gross proceeds printed to bound the priced objects")
    if total > bound * (1 + tol):
        return answer_states.refused("priced objects %.2f Cr exceed %s %.2f Cr" % (total, bound_name, bound))
    return True, ("priced objects %.2f Cr <= %s %.2f Cr; %d object(s) unpriced ([bullet]), exact sum not "
                  "verifiable before the price is set%s" % (total, bound_name, bound, unpriced, gcp_notes))


def read_objects_of_offer(page_texts):
    """The answer for the utilisation table of one document. `page_texts` = [(page_index, text), ...]."""
    unreadable = None
    for pos, (idx, text) in enumerate(page_texts):
        lines = (text or "").split("\n")
        for ln_no, ln in enumerate(lines):
            if not _HEAD_RX.match(ln):
                continue
            rows, total, unit, first_page, problem = _parse_table(_lines_from(page_texts, pos, ln_no + 1))
            with_amount = [r for r in rows if r["tok"] is not None]
            if problem:
                unreadable = unreadable or {"state": "UNREADABLE", "reason": problem, "page": idx}
                continue
            if not with_amount:
                continue
            if unit is None:
                unreadable = unreadable or {"state": "UNREADABLE", "reason": "objects_table_unit_unreadable",
                                            "page": idx}
                continue
            items = _items(rows, unit)
            if not items:
                continue
            gross_cr, net_cr, proceeds_unpriced = _proceeds_in_cr(page_texts, pos, ln_no, unit)
            total_cr = round(total * _UNIT_TO_CR[unit], 4) if total is not None else None
            return {"state": "TABLE", "items": items, "page": idx, "unit": unit, "gross_cr": gross_cr,
                    "net_cr": net_cr, "printed_total_cr": total_cr,
                    "f4": check_f4(items, net_cr, gross_cr, total_cr,
                                          proceeds_unpriced=proceeds_unpriced)}
    if unreadable:
        return unreadable
    # A stated absence clears a stored value (OD-160), so "no fresh issue" needs the whole offer, not one
    # page: any page that mentions a fresh issue (cover, "The Offer", the objects chapter) means the offer
    # may be mixed and the answer is a miss.
    fresh_anywhere = any(_FRESH_ISSUE_RX.search(t or "") for _i, t in page_texts)
    for pos, (idx, text) in enumerate(page_texts):
        if not any(_OBJECTS_HEAD_RX.match(ln) for ln in (text or "").split("\n")):
            continue
        if _OFS_ONLY_RX.search(re.sub(r"\s+", " ", text or "")):
            if fresh_anywhere:
                return {"state": "UNREADABLE", "reason": FRESH_ISSUE_ELSEWHERE_REASON, "page": idx}
            return {"state": "STATED_NONE", "reason": NO_FRESH_ISSUE_REASON, "page": idx}
    return {"state": "NOT_FOUND", "reason": "objects_table_not_found", "page": None}
