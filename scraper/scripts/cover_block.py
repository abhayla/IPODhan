"""Item 39 (OD-164(b), OD-162): the offer document's cover-block reader.

Reads, deterministically (spec section 5.6 group E, "labelled lines with strict
formats"; no model), the intermediaries and the issuer's contact block that SEBI
ICDR makes every DRHP / RHP / PROSPECTUS print on its cover and in "General
Information":

    lead_managers            the book running lead managers (names, in order)
    lead_manager_sebi_reg    the BRLM's INM number, ONLY when there is exactly one BRLM
    registrar_name           the registrar to the offer
    registrar_email / registrar_phone / registrar_contact_person
    registrar_website / registrar_sebi_reg
    company_website
    compliance_officer / compliance_officer_email / compliance_officer_phone

Every field is read from more than one SEBI-mandated place where the document
has them (the cover table, the "Definitions" row, the single-column "General
Information" block, the second-cover prose line). The candidates must AGREE;
two different readings are not resolved by picking one (B4(c), fail closed).

Answer states (answer_states.py, OD-153 / OD-158 / OD-160):

    printed value       every candidate agrees and passes its format check -> VALUE
    stated not printed  NEVER emitted here: no document read for item 39 states
                        one of these fields is absent, and an "NA" cell in the
                        cover table cannot be attributed to a column in text
                        order, so it is not a statement about any one field
    not found           no candidate in the text -> MISSED (a stored value stays)
    unresolved          candidates disagree / a block is two columns run
                        together -> MISSED with the cause, never a guess
    refused             a value was read and failed its format (SEBI reg form,
                        email, Indian phone, website host) -> REFUSED
    unreadable          the page came from OCR below the floor ->
                        LOW_CONFIDENCE_OCR, set by ocr_pages.annotate_fields
                        from the page this reader reports (OD-97)

A miss is never written as a stated absence: every reason below is a
`*_not_found` / `*_unresolved` / `*_disagree` cause, none is on the shared
stated-absence allow-list (scraper/src/config/stated-absence-reasons.json).
"""

import re

import answer_states

COVER_PAGES = 4
DEFINITIONS_PAGES = 40

_FIRM_END = r"(?:Private\s+Limited|Pvt\.?\s+Ltd\.?|Limited|LIMITED|Ltd\.?|LLP)"
# A firm name at the START of a line: 2+ words, no label colon, ending in a
# company suffix. Lazy, so "X Limited Y Limited" yields X first.
# A footnote / role marker printed on a firm name is not part of the name: "ICICI Securities
# Limited*", "SBI Capital Markets Limited#", "$SBI Capital Markets Limited ...", "SBI Capital
# Markets Limited (SS)" (NSE RHP). Leading markers are skipped; trailing ones are consumed
# outside the captured name.
_MARK = r"[*#$\u2020\u2021]"
_TRAIL_MARK = r"(?:" + _MARK + r"|\s?\((?:SS|ss)\))*"
FIRM_AT_START = re.compile(r"^\s*" + _MARK + r"*\s*(?!(?:Private|Limited|LIMITED|Ltd|LLP|Pvt)\b)([A-Z0-9][A-Za-z0-9&.,'()\-/ ]{2,}?\b" + _FIRM_END + r")" + _TRAIL_MARK + r"(?=[\s;,.)]|$)")
FIRM_ANYWHERE = re.compile(r"(?<![A-Za-z])(?!(?:Private|Limited|LIMITED|Ltd|LLP|Pvt)\b)([A-Z0-9][A-Za-z0-9&.'()\-/ ]{2,}?\b" + _FIRM_END + r")" + _TRAIL_MARK + r"(?=[\s;,.)]|$)")

SEBI_INM = re.compile(r"\bINM\s?\d{9}\b")
SEBI_INR = re.compile(r"\bINR\s?\d{9}\b")
EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+")
WEBSITE = re.compile(r"\b((?:https?://)?(?:www\.)[a-z0-9\-]+(?:\.[a-z0-9\-]+)+(?:/[^\s;,]*)?)", re.I)
PHONE_LABEL = re.compile(r"(?:Tel(?:ephone)?\.?(?:\s*No\.?)?|Mobile\s*No\.?|Phone)\s*[:.]?\s*([+0-9][0-9 ()+\-–/]{7,30}\d)", re.I)

BRLM_HEADING = re.compile(r"^\s*(?:BOOK\s+RUNNING\s+)?LEAD\s+MANAGERS?\b(?!.*REGISTRAR)", re.I)
BRLM_COVER_HEADING = re.compile(r"^\s*BOOK\s+RUNNING\s+LEAD\s+MANAGERS?\b", re.I)
REGISTRAR_COVER_HEADING = re.compile(r"^\s*(?:REGISTRAR\s+TO\s+THE\s+(?:OFFER|ISSUE)\b|Name\s+of\s+(?:the\s+)?Registrar\b)", re.I)
COVER_SECTION_END = re.compile(r"^\s*(?:BID\s*/\s*(?:OFFER|ISSUE)|ANCHOR|ISSUE\s+PROGRAMME|OFFER\s+PROGRAMME|BID/\s*OFFER)", re.I)
TWO_COLUMN_HEADING = re.compile(r"LEAD\s+MANAGER.*REGISTRAR", re.I)

GI_REGISTRAR_HEADING = re.compile(r"^\s*Registrar\s+to\s+the\s+(?:Offer|Issue)\s*$")
GI_BLOCK_END = re.compile(r"^\s*(?:Statutory|Legal|Banker|Syndicate|Self|Sponsor|Escrow|Public\s+Offer|Refund|"
                          r"Monitoring|Designated|Market\s+Maker|Underwrit|Changes\s+in|Credit\s+Rating|Experts?|"
                          r"Peer\s+Review|Inter|Filing|Book\s+Running|Collecting|Registrar\s+and\s+Share)\b", re.I)
# The marketing BRLM (SEBI Merchant Bankers Regulation 21A: a BRLM that is also a selling
# shareholder or its associate) has its own Definitions row, quoted or not: NSE RHP p.13
# "M-BRLM SBI Capital Markets Limited acting as a book running lead manager to the Offer*".
# It IS a book running lead manager and joins the BRLM row's list; the row must say so.
DEF_MBRLM_ROW = re.compile(r"^\s*[“\"]?(?:M-BRLMs?|Marketing\s+(?:Book\s+Running\s+)?Lead\s+Managers?)[”\"]?\s+(.*\bbook\s+running\s+lead\s+manager\b.*)$", re.I)
DEF_ROW = re.compile(r"^\s*[“\"](Registrar\s+to\s+the\s+(?:Offer|Issue)|Book\s+Running\s+Lead\s+Managers?|BRLMs?)[”\"]", re.I)
DEF_NEXT_ROW = re.compile(r"^\s*[“\"][A-Z]")
# A footnote under a Definitions row starts its line with the marker the row's names carry
# ("*Morgan Stanley India Company Private Limited and ICICI Securities Limited are associates of
# MS Strategic (Mauritius) Limited ..." on the NSE RHP p.11): the row has ended.
DEF_FOOTNOTE_LINE = re.compile(r"^\s*[*#$†‡]")
# The row's sentence ends at a firm suffix in ANY case and style ("Limited." / "Ltd." / "Pvt. Ltd." /
# "LLP." / "Limited)." / "Limited*."), followed by the end of the text or by what starts a new
# sentence (a capital, a marker, a quote) - never by "," or a lower-case word ("Ltd., SBI ..." and
# "Pvt. Ltd. and ..." are inside the list).
_SUFFIX_WORD = r"\b(?:limited|ltd|llp)"
DEF_ROW_END = re.compile(r"(?i:" + _SUFFIX_WORD + r")" + _MARK + r"*\)?\s*\.(?=\s*(?:$|[*#$†‡A-Z(“\"]))")
DEF_ROW_END_AT_EOT = re.compile(r"(?i:" + _SUFFIX_WORD + r")\.?" + _MARK + r"*\)?\s*$")
DEF_TAIL_OK = re.compile(r"^[\s*#$†‡.,;)]*$")
DEF_TERM_TAIL = re.compile(r"^\s*(?:or\s+)?[“\"][^”\"]{1,40}[”\"]\s*")

CO_PROSE = re.compile(r"Contact\s+person\s*:\s*((?:(?:Mr|Ms|Mrs|Smt|Shri|Dr)\.?\s+)?[A-Z][A-Za-z.'\- ]{2,60}?)\s*[,(]\s*(?:the\s+)?Company\s+Secretary", re.I)
CO_IS_THE = re.compile(r"((?:(?:Mr|Ms|Mrs|Smt|Shri|Dr)\.?\s+)?[A-Z][A-Za-z.'\-]+(?:\s+[A-Z][A-Za-z.'\-]+){1,4})\s+is\s+(?:the|our)\s+Company\s+Secretary\s+(?:and|&)\s+Compliance\s+Officer")
CO_HEADING = re.compile(r"^\s*Company\s+Secretary\s+(?:and|&)\s+Compliance\s+Officer\b(.*)$", re.I)
PERSON_LINE = re.compile(r"^\s*((?:(?:Mr|Ms|Mrs|Smt|Shri|Dr)\.?\s+)?[A-Z][A-Za-z.'\-]+(?:\s+[A-Z][A-Za-z.'\-]+){1,4})\s*$")
HONORIFIC = re.compile(r"^(?:Mr|Ms|Mrs|Smt|Shri|Dr)\.?\s+", re.I)

CO_COVER_HEADER = re.compile(r"CONTACT\s+PERSON", re.I)
CO_COVER_END = re.compile(r"(?:PROMOTER|DETAILS\s+OF|THE\s+OFFER|THE\s+ISSUE|OUR\s+COMPANY\s+DOES)", re.I)


# --------------------------------------------------------------------------- #
# format checks (row 44-46, rows 21/114, registrar rows)
# --------------------------------------------------------------------------- #
def check_sebi_reg(reg, prefix):
    if reg is None:
        return answer_states.missed("no %s registration number" % prefix)
    if re.fullmatch(prefix + r"\d{9}", reg):
        return (True, reg)
    return answer_states.refused("%r is not the SEBI %s+9-digit form" % (reg, prefix))


def check_email(email):
    if email is None:
        return answer_states.missed("no email")
    if len(email) <= 255 and re.fullmatch(EMAIL.pattern, email):
        return (True, email)
    return answer_states.refused("%r is not an email address" % email)


def normalise_phone(raw):
    return " ".join(raw.replace("–", "-").split()).strip(" -/")


def check_indian_phone(phone):
    """Indian phone form: 10 national digits, optionally +91 / 91 / 0 prefixed
    (a landline with STD code is also 10 national digits)."""
    if phone is None:
        return answer_states.missed("no phone")
    first = re.split(r"\s*/\s*", phone)[0]
    digits = re.sub(r"\D", "", first)
    if re.match(r"^\s*\+?\s*91(?:[\s\-–(]|$)", first) or (
            re.match(r"^\s*\+\s*91", first) and len(digits) == 12):
        digits = digits[2:]          # a printed country code (+91, separated or not): the national part must follow
    if re.fullmatch(r"1800\d{6,7}", digits) and len(phone) <= 50:
        return (True, phone)         # a toll-free number: 1800 then 6-7 digits (1800 309 4001)
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]          # trunk prefix
    if len(digits) == 10 and len(phone) <= 50:
        return (True, phone)
    return answer_states.refused("%r is not an Indian phone number" % phone)


def check_website(site):
    if site is None:
        return answer_states.missed("no website")
    host = re.sub(r"^https?://", "", site, flags=re.I).split("/")[0].lower()
    if re.fullmatch(r"(?:[a-z0-9\-]+\.)+[a-z]{2,}", host) and len(site) <= 255:
        return (True, site)
    return answer_states.refused("%r has no valid host" % site)


def check_firm_names(names):
    if not names:
        return answer_states.missed("no firm name")
    bad = [n for n in names if not re.search(_FIRM_END + r"$", n) or len(n.split()) < 2]
    if bad:
        return answer_states.refused("not a company name: %r" % bad)
    return (True, "%d name(s)" % len(names))


def check_person(name):
    if name is None:
        return answer_states.missed("no person name")
    if re.fullmatch(r"[A-Za-z.'\- ]{3,100}", name) and len(name.split()) >= 2:
        return (True, name)
    return answer_states.refused("%r is not a person name" % name)


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _canon_firm(name):
    n = re.sub(r"\s+", " ", name or "").strip(" *.,;").lower()
    n = re.sub(r"\bpvt\.?\b", "private", n)
    n = re.sub(r"\bltd\.?$", "limited", n)
    return n


def _canon_person(name):
    return re.sub(r"\s+", " ", HONORIFIC.sub("", (name or "").strip())).strip(" .,").lower()


def _clean_firm(raw):
    name = re.sub(r"\s+", " ", raw)
    name = re.sub(r"\s?\((?:SS|ss)\)$", "", name)
    return name.strip(" *#$†‡;,")


def _firm_line(line):
    """The single firm name a whole line starts with, or None. A line naming
    TWO firms (two cover columns run together) is not a clean name line."""
    m = FIRM_AT_START.match(line)
    if not m:
        return None, False
    name = m.group(1)
    if re.search(r":", name) or re.search(r"\b(?:Tel|E-?mail|Website|Contact|Address|Registered|Office)\b", name, re.I):
        return None, False
    rest = line[m.end():]
    two = bool(FIRM_AT_START.match(rest.lstrip("* ")))
    return _clean_firm(name), two


def _record_pages(emit, name, cands):
    """OD-97: every place a kept value was read from, so its TEXT / OCR / MIXED mark covers each
    agreeing page (ocr_pages.annotate_fields, ocr-value-mark.ts), not only the first."""
    rec = emit.fields.get(name)
    if rec is not None and rec.get("value") is not None:
        rec["pages"] = sorted({p for _v, p in cands if p is not None})


def _agree(cands, canon):
    """cands: [(value, page), ...]. -> (value, page, None) when every candidate
    agrees, (None, None, reason) otherwise."""
    if not cands:
        return None, None, "not_found"
    keys = {canon(v) if not isinstance(v, list) else tuple(canon(x) for x in v) for v, _p in cands}
    if len(keys) > 1:
        return None, None, "sources_disagree"
    return cands[0][0], cands[0][1], None


# --------------------------------------------------------------------------- #
# readers, one per SEBI-mandated place
# --------------------------------------------------------------------------- #
def _cover_tables(page_texts):
    """The cover's BRLM table and registrar table (single-column layouts)."""
    brlm = {"names": None, "page": None, "unresolved": False, "lines": []}
    reg = {"name": None, "page": None, "unresolved": False, "lines": []}
    for idx, text in page_texts[:COVER_PAGES]:
        lines = (text or "").splitlines()
        b = next((k for k, l in enumerate(lines) if BRLM_COVER_HEADING.match(l)), -1)
        if b < 0:
            continue
        if TWO_COLUMN_HEADING.search(lines[b]):
            brlm["unresolved"] = reg["unresolved"] = True
            brlm["page"] = reg["page"] = idx
            return brlm, reg
        r = next((k for k in range(b + 1, len(lines)) if REGISTRAR_COVER_HEADING.match(lines[k])), -1)
        end = next((k for k in range(max(b, r) + 1, len(lines)) if COVER_SECTION_END.match(lines[k])), len(lines))
        if r < 0:
            brlm["unresolved"] = True
            brlm["page"] = idx
            return brlm, reg
        names, unresolved = [], False
        for line in lines[b + 1:r]:
            n, two = _firm_line(line)
            unresolved |= two
            if n:
                names.append(n)
        # A cover table naming 2+ BRLMs is printed in columns that text order
        # runs together (NSE RHP p.2: "Limited JM Financial Limited"); only a
        # single-firm table is read here, the Definitions row reads the rest.
        brlm.update(names=names or None, page=idx, lines=lines[b + 1:r],
                    unresolved=unresolved or len(names) > 1)
        rnames, runresolved = [], False
        for line in lines[r + 1:end]:
            n, two = _firm_line(line)
            runresolved |= two
            if n:
                rnames.append(n)
        reg.update(page=idx, lines=lines[r + 1:end],
                   unresolved=runresolved or len(rnames) > 1,
                   name=rnames[0] if len(rnames) == 1 else None)
        return brlm, reg
    return brlm, reg


def _definition_rows(page_texts):
    """'Definitions and Abbreviations': {"registrar": (name, page), "brlm": ([names], page)}."""
    out = {}
    marketing = []
    for idx, text in page_texts[:DEFINITIONS_PAGES]:
        lines = (text or "").splitlines()
        for k, line in enumerate(lines):
            mb = DEF_MBRLM_ROW.match(line)
            if mb:
                head = re.split(r"\b(?:acting|in\s+its\s+capacity|appointed|as\s+a\s+book)\b", mb.group(1), flags=re.I)[0]
                marketing += [_clean_firm(f) for f in FIRM_ANYWHERE.findall(head)]
                continue
            m = DEF_ROW.match(line)
            if not m:
                continue
            body = [line[m.end():]]
            for nxt in lines[k + 1:k + 14]:
                if DEF_NEXT_ROW.match(nxt) or DEF_FOOTNOTE_LINE.match(nxt):
                    break
                body.append(nxt)
            blob = " ".join(DEF_TERM_TAIL.sub("", b) for b in body)
            blob = DEF_TERM_TAIL.sub("", blob)
            blob = re.sub(r"\s+", " ", blob)
            blob = re.sub(r"\((?:formerly|earlier)[^)]*\)", " ", blob, flags=re.I)
            # the row ends at its sentence: a firm suffix in any case and style, then a full stop
            # (or the end of the row's text, when a footnote line or the next row closed it)
            end = DEF_ROW_END.search(blob)
            ended = end is not None or DEF_ROW_END_AT_EOT.search(blob.strip()) is not None
            if end is not None:
                blob = blob[:end.end()]
            term = m.group(1).lower()
            listed = re.sub(r"^.*?(?:namely|being|viz\.?|i\.e\.?)\s*,?\s*", "", blob, flags=re.I)
            found = list(FIRM_ANYWHERE.finditer(listed))
            names = [re.sub(r"^(?:and|&)\s+", "", _clean_firm(f.group(1))) for f in found]
            if not names:
                continue
            if term.startswith("registrar") and "registrar" not in out:
                out["registrar"] = (names[0], idx)
            elif not term.startswith("registrar") and "brlm" not in out and "brlm_fail" not in out:
                # B4(c) fail closed: a row whose sentence never ended ran into whatever follows it;
                # words after the last firm are a name the pattern could not read; a name twice is
                # the row reading text that is not the list (the NSE footnote repeats two BRLMs).
                if not ended:
                    out["brlm_fail"] = ("lead_managers_row_overrun", idx)
                elif not DEF_TAIL_OK.match(listed[found[-1].end():]):
                    out["brlm_fail"] = ("lead_managers_row_unparsed_tail", idx)
                elif len({_canon_firm(n) for n in names}) != len(names):
                    out["brlm_fail"] = ("lead_managers_duplicate_in_row", idx)
                else:
                    out["brlm"] = (names, idx)
    # An M-BRLM row extends the BRLM row's list; alone it is not the whole list (fail closed).
    if "brlm" in out and marketing:
        names, idx = out["brlm"]
        seen = {_canon_firm(n) for n in names}
        out["brlm"] = (names + [n for n in dict.fromkeys(marketing) if _canon_firm(n) not in seen], idx)
    return out


def _gi_registrar(page_texts):
    """The single-column 'Registrar to the Offer' block of General Information."""
    for idx, text in page_texts[COVER_PAGES:]:
        lines = (text or "").splitlines()
        for k, line in enumerate(lines):
            if not GI_REGISTRAR_HEADING.match(line) or k + 1 >= len(lines):
                continue
            name, two = _firm_line(lines[k + 1])
            if not name or two:
                continue
            block = []
            for nxt in lines[k + 2:k + 16]:
                if GI_BLOCK_END.match(nxt):
                    break
                block.append(nxt)
            return {"name": name, "page": idx, "lines": block}
    return None


def _labelled(lines, label_rx):
    vals = []
    for line in lines:
        m = re.search(label_rx + r"\s*[:.]?\s*(\S+)", line, re.I)
        if m:
            vals.append(m.group(1).rstrip(";,."))
    return vals


def _one(values):
    distinct = list(dict.fromkeys(v for v in values if v))
    if len(distinct) == 1:
        return distinct[0], None
    return None, ("not_found" if not distinct else "two_candidates")


# --------------------------------------------------------------------------- #
# entry point
# --------------------------------------------------------------------------- #
def read_cover_block(page_texts, emit):
    page_texts = list(page_texts)
    cover_brlm, cover_reg = _cover_tables(page_texts)
    defs = _definition_rows(page_texts)
    gi_reg = _gi_registrar(page_texts)

    # ---- lead managers (row 21, OD-162) ----------------------------------- #
    cands = []
    if cover_brlm["names"] and not cover_brlm["unresolved"]:
        cands.append((cover_brlm["names"], cover_brlm["page"]))
    if "brlm" in defs:
        cands.append(defs["brlm"])
    value, page, why = _agree(cands, _canon_firm)
    # A second count: the cover's BRLM block prints one SEBI INM number per BRLM where it prints
    # them at all. A list whose length disagrees with it read something that is not the list.
    cover_inms = set(r.replace(" ", "") for r in SEBI_INM.findall(" ".join(cover_brlm["lines"] or [])))
    if "brlm_fail" in defs:
        value = None
        emit.null("lead_managers", defs["brlm_fail"][0], page=defs["brlm_fail"][1])
    elif value is not None and cover_inms and len(cover_inms) != len(value):
        value = None
        emit.null("lead_managers", "lead_managers_count_disagrees", page=cover_brlm["page"])
    elif value is None:
        reason = ("lead_managers_sources_disagree" if why == "sources_disagree" else
                  "lead_managers_block_unresolved" if cover_brlm["unresolved"] else
                  "lead_managers_not_found")
        emit.null("lead_managers", reason, page=cover_brlm["page"] if why != "sources_disagree" else None)
    else:
        emit.put("lead_managers", value, page, "lead_manager_names_are_companies", check_firm_names(value))
        _record_pages(emit, "lead_managers", cands)

    # One BRLM: its INM number is unambiguous (two or more cannot be paired in
    # text order, measured on the NSE RHP's two-column block).
    if value and len(value) == 1 and cover_brlm["lines"] is not None:
        regs = SEBI_INM.findall(" ".join(cover_brlm["lines"]))
        reg, _w = _one([r.replace(" ", "") for r in regs])
        if reg is None:
            emit.null("lead_manager_sebi_reg", "lead_manager_sebi_reg_not_found")
        else:
            emit.put("lead_manager_sebi_reg", reg, cover_brlm["page"], "sebi_reg_inm_form",
                     check_sebi_reg(reg, "INM"))

    # ---- registrar ---------------------------------------------------------- #
    cands = []
    if cover_reg["name"] and not cover_reg["unresolved"]:
        cands.append((cover_reg["name"], cover_reg["page"]))
    if "registrar" in defs:
        cands.append(defs["registrar"])
    if gi_reg:
        cands.append((gi_reg["name"], gi_reg["page"]))
    rname, rpage, why = _agree(cands, _canon_firm)
    if rname is None:
        emit.null("registrar_name", "registrar_sources_disagree" if why == "sources_disagree"
                  else "registrar_block_unresolved" if cover_reg["unresolved"] else "registrar_not_found")
    else:
        emit.put("registrar_name", rname, rpage, "registrar_name_is_a_company", check_firm_names([rname]))
        _record_pages(emit, "registrar_name", cands)

    # Contact lines: from the block whose name agreed (GI first, then the cover).
    contact_src = None
    if rname and gi_reg and _canon_firm(gi_reg["name"]) == _canon_firm(rname):
        contact_src = (gi_reg["lines"], gi_reg["page"])
    elif rname and cover_reg["name"] and not cover_reg["unresolved"]:
        contact_src = (cover_reg["lines"], cover_reg["page"])
    _registrar_contacts(emit, contact_src)

    # ---- issuer contact block: website + compliance officer ---------------- #
    _issuer_contacts(page_texts, emit)
    return {"lead_managers": value, "registrar_name": rname}


def _registrar_contacts(emit, src):
    names = ("registrar_email", "registrar_phone", "registrar_website", "registrar_contact_person",
             "registrar_sebi_reg")
    if src is None:
        for n in names:
            emit.null(n, "registrar_block_not_found")
        return
    lines, page = src
    blob = " ".join(lines)
    emails = [e for line in lines if not re.search(r"griev|graiv", EMAIL.sub("", line), re.I) for e in EMAIL.findall(line)]
    email, w = _one([e.rstrip(".") for e in emails])
    _emit_checked(emit, "registrar_email", email, page, w, "email_form", check_email)
    phones = [normalise_phone(m.group(1)) for line in lines for m in PHONE_LABEL.finditer(line)]
    phone, w = _one(phones)
    _emit_checked(emit, "registrar_phone", phone, page, w, "indian_phone_form", check_indian_phone)
    sites = [m.group(1).rstrip(".") for line in lines if re.search(r"Website", line, re.I)
             for m in WEBSITE.finditer(line)]
    site, w = _one(sites)
    _emit_checked(emit, "registrar_website", site, page, w, "website_has_host", check_website)
    persons = [m.group(1).strip() for line in lines
               for m in [re.search(r"Contact\s+Person\s*:\s*([A-Za-z.'\- ]{3,60}?)\s*;?\s*$", line, re.I)] if m]
    person, w = _one(persons)
    _emit_checked(emit, "registrar_contact_person", person, page, w, "person_name", check_person)
    regs = [r.replace(" ", "") for r in SEBI_INR.findall(blob)]
    reg, w = _one(regs)
    _emit_checked(emit, "registrar_sebi_reg", reg, page, w, "sebi_reg_inr_form",
                  lambda r: check_sebi_reg(r, "INR"))


def _emit_checked(emit, name, value, page, why, check_name, check):
    if value is None:
        emit.null(name, "%s_%s" % (name, why or "not_found"))
    else:
        emit.put(name, value, page, check_name, check(value))


def _issuer_contacts(page_texts, emit):
    """company_website, compliance_officer(+email, phone): the second-cover prose
    line, the cover contact table and the General Information block must agree."""
    sites, emails, phones, persons = [], [], [], []
    seen_table = False
    for idx, text in page_texts[:COVER_PAGES]:
        lines = (text or "").splitlines()
        # second-cover prose: "...; Website: www.x.com; Contact person: NAME (Company Secretary ...); E-mail: ..."
        for k, line in enumerate(lines):
            m = CO_PROSE.search(line)
            if not m:
                continue
            persons.append((m.group(1).strip(), idx))
            window = " ".join(lines[max(0, k - 1):k + 2])
            for s in re.finditer(r"Website\s*:\s*" + WEBSITE.pattern, window, re.I):
                sites.append((s.group(1).rstrip("."), idx))
            for e in re.finditer(r"E-?mail\s*:\s*(" + EMAIL.pattern + ")", window, re.I):
                emails.append((e.group(1).rstrip("."), idx))
            for p in PHONE_LABEL.finditer(window):
                phones.append((normalise_phone(p.group(1)), idx))
        # the cover contact table: the region between its CONTACT PERSON header
        # and the promoter / offer line holds exactly one website, one email
        h = next((k for k, l in enumerate(lines) if CO_COVER_HEADER.search(l) and re.search(r"WEBSITE", l, re.I)), -1)
        if h >= 0 and not seen_table:
            # only the FIRST contact table is the issuer's (later ones are selling shareholders')
            seen_table = True
            end = next((k for k in range(h + 1, len(lines)) if CO_COVER_END.search(lines[k])), min(len(lines), h + 14))
            region = lines[h + 1:end]
            rs = list(dict.fromkeys(m.group(1).rstrip(".") for l in region for m in WEBSITE.finditer(l)))
            re_ = list(dict.fromkeys(e.rstrip(".") for l in region for e in EMAIL.findall(l)))
            if len(rs) == 1:
                sites.append((rs[0], idx))
            elif len(rs) > 1:
                sites.append(("<two websites in the cover table>", idx))
            if len(re_) == 1:
                emails.append((re_[0], idx))
            elif len(re_) > 1:
                emails.append(("<two emails in the cover table>", idx))
    for idx, text in page_texts:
        lines = (text or "").splitlines()
        for k, line in enumerate(lines):
            m = CO_IS_THE.search(line)
            if m:
                persons.append((m.group(1).strip(), idx))
                continue
            h = CO_HEADING.match(line)
            if h:
                tail = h.group(1).strip()
                pm = PERSON_LINE.match(tail) if tail else None
                if pm is None and not tail and k + 1 < len(lines):
                    pm = PERSON_LINE.match(lines[k + 1])
                if pm:
                    persons.append((pm.group(1).strip(), idx))
    site, spage, why = _agree(sites, lambda s: re.sub(r"^https?://", "", s.lower()).rstrip("/"))
    _emit_or_null(emit, "company_website", site, spage, why, "website_has_host", check_website, sites)
    co, cpage, why = _agree(persons, _canon_person)
    if co is not None:
        co = HONORIFIC.sub("", co).strip()
    _emit_or_null(emit, "compliance_officer", co, cpage, why, "person_name", check_person, persons)
    email, epage, why = _agree(emails, str.lower)
    _emit_or_null(emit, "compliance_officer_email", email, epage, why, "email_form", check_email, emails)
    if email and site:
        # Row 46 asks for the email domain to match the website. Measured on the
        # NSE RHP: nse_ipo@nse.co.in vs www.nseindia.com - a true value fails it,
        # so it is recorded, not enforced (open for owner decision).
        dom = email.split("@")[-1].lower()
        host = re.sub(r"^(?:https?://)?(?:www\.)?", "", site.lower()).split("/")[0]
        emit.fields["compliance_officer_email"]["cross_check"] = {
            "name": "email_domain_matches_website", "passed": dom == host or dom.endswith("." + host) or host.endswith("." + dom)}
    phone, ppage, why = _agree(phones, lambda p: re.sub(r"\D", "", p)[-10:])
    _emit_or_null(emit, "compliance_officer_phone", phone, ppage, why, "indian_phone_form", check_indian_phone, phones)


def _emit_or_null(emit, name, value, page, why, check_name, check, cands=()):
    if value is None:
        emit.null(name, "%s_%s" % (name, why))
    else:
        emit.put(name, value, page, check_name, check(value))
        _record_pages(emit, name, cands)
