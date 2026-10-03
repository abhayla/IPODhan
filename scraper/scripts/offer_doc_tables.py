"""Offer-document (DRHP / RHP / PROSPECTUS) readers for three printed tables the price band
advertisement readers cannot see: the per-BRLM "Summary statement of price information of past
issues" (spec rows 148-151), the "weighted average cost of acquisition of all shares transacted"
period table (rows 161-165), and each BRLM's investor grievance e-mail (row 158).

Every reader returns a value or a named reason; nothing is attributed to a BRLM, a period or a
firm unless the page itself ties it there (fail closed)."""
import re

# --------------------------------------------------------------------------- shared
_FIRM_END_RX = re.compile(r"(?:limited|ltd\.?|llp|private limited)\)?\.?$", re.I)


_FORMERLY_RX = re.compile(r"\(\s*formerly\b[^)]*\)?", re.I)


def canon_firm(name):
    s = _FORMERLY_RX.sub(" ", (name or "")).lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return " ".join(s.split())


_SUFFIX_KEY = ((r"\bltd\b", "limited"), (r"\bpvt\b", "private"), (r"\bco\b", "company"))


def name_key(name):
    """canon_firm with the usual abbreviations spelled out, so "X Ltd" and "X Limited" are one
    firm (step-3b review B4)."""
    k = canon_firm(name)
    for rx, full in _SUFFIX_KEY:
        k = re.sub(rx, full, k)
    return k


def _word_prefix_split(a, words):
    """True when `a` is the concatenation of non-empty prefixes of words[0], words[1], ... in
    order ("isec" = "i"cici + "sec"urities; "jpm" = j + p + morgan)."""
    if not a:
        return True
    if not words:
        return False
    w = words[0]
    return any(a[:k] == w[:k] and _word_prefix_split(a[k:], words[1:])
               for k in range(min(len(a), len(w)), 0, -1))


def alias_names_firm(alias, firm):
    """Step-3b review B3: a short caption name ("handled by JM:") names a heading's firm only when
    it is built from the firm's own words, in order, from the first word: each piece a prefix of
    the next word ("Kotak", "JM", "JPM" for J.P. Morgan, "I-Sec" for ICICI Securities, "SBICAPS"
    for SBI Capital Markets with its plural s). "Citi" never names JM Financial."""
    a = canon_firm(alias).replace(" ", "")
    words = canon_firm(firm).split()
    if not a or not words:
        return False
    return _word_prefix_split(a, words) or (a.endswith("s") and _word_prefix_split(a[:-1], words))


def _match_firm(text, names):
    """The one name in `names` that `text` names, or None (zero or several = None)."""
    c = canon_firm(re.sub(r"\*+", "", text))
    if not c:
        return None
    hits = [n for n in names if canon_firm(n) == c]
    if not hits:
        # B4: "X Ltd" printed for the list's "X Limited" is the same firm, in the list's spelling.
        hits = [n for n in names if name_key(n) == name_key(c)]
    if not hits:
        # A heading that wraps "Equirus Capital Limited (formerly known as ...": the printed
        # line is a firm name ending in Limited and the list name starts with it.
        if _FIRM_END_RX.search(c):
            hits = [n for n in names if canon_firm(n).startswith(c + " ")]
    return hits[0] if len(hits) == 1 else None


# ----------------------------------------------------- rows 148-151: BRLM track record
_SUMMARY_RX = re.compile(r"summary\s+statement\s+of\s+price\s+information\s+of\s+past\s+issues", re.I)
_HANDLED_RX = re.compile(r"handled\s+by\s+(.+)$", re.I | re.S)
_FY_ROW_RX = re.compile(r"^\s*(?:FY\s*)?(\d{4})\s*-\s*(\d{2}|\d{4})[*$^#@]*\s+(.*)$")
_CELL_RX = re.compile(r"^(?:-|–|—|\d[\d,]*(?:\.\d+)?)\**$")
_ROMAN_HEAD_RX = re.compile(r"^\s*(?:[IVXL]+|[A-Z]|\d{1,2})[.)]\s+(.{4,140}?)\*?\s*:?\s*$")
_HEAD_REACH = 200
_NOTE_RX = re.compile(r"^\s*(?:notes?\b|source\b|\*|#)", re.I)


def _cell_int(cell):
    c = cell.rstrip("*")
    if c in ("-", "–", "—"):
        return 0
    if "." in c:
        return None
    return int(c.replace(",", ""))


def _fy_start(a, b):
    a = int(a)
    b = int(b) % 100
    return a if (a + 1) % 100 == b else None


def _summary_rows(lines, start):
    """The FY rows of one summary table from line `start`: [(fy_start, cells)] or a reason."""
    rows = []
    for k in range(start, min(len(lines), start + 25)):
        ln = lines[k]
        if k > start and _SUMMARY_RX.search(ln):
            break
        m = _FY_ROW_RX.match(ln)
        if m:
            fy = _fy_start(m.group(1), m.group(2))
            cells = m.group(3).split()
            if fy is None:
                return None, "fiscal_year_label_unreadable: %s" % ln.strip()[:40]
            if len(cells) != 14 or not all(_CELL_RX.match(c) for c in cells):
                return None, "row_not_14_cells: %s" % ln.strip()[:60]
            rows.append((fy, cells))
            if len(rows) == 3:
                break
        elif rows and _NOTE_RX.match(ln):
            break
    if len(rows) != 3:
        return None, "summary_rows_found_%d_not_3" % len(rows)
    years = sorted(r[0] for r in rows)
    if len(set(years)) != 3 or years[2] - years[0] != 2:
        return None, "fiscal_years_not_three_consecutive: %s" % [r[0] for r in rows]
    return rows, None


def _caption_name(lines, i):
    """The name after "handled by" on caption line i (it may wrap onto the next line)."""
    text = lines[i]
    m = _HANDLED_RX.search(text)
    if not m:
        return None
    name = m.group(1).strip()
    nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
    if not re.search(r"[:.]\s*$", name) and nxt and not re.match(r"financial", nxt, re.I):
        name = name + " " + nxt
    return re.sub(r"[\s:.]+$", "", name).strip() or None


def read_brlm_track_record(page_texts, lead_managers=None):
    """Rows 148-151 from each BRLM's summary table.

    Returns (rows, first_page, problems). A row is {"brlm", "issues_3y", "closed_below",
    "page"}. `issues_3y` is the sum of the table's three fiscal-year IPO totals (the current
    financial year and the two before it). `closed_below` is None: the offer document's table
    counts IPOs trading at a discount on the 30th calendar day, not issues that closed below the
    issue price on the LISTING date, which is what the column (and the page that shows it) means.

    The BRLM is the full firm name, taken from the caption when it prints one, otherwise from
    the single numbered firm heading between the previous summary table and this one; when the
    document's own BRLM list is known the name must be one of them."""
    flat = []
    for idx, text in page_texts:
        for ln in (text or "").split("\n"):
            flat.append((idx, ln))
    lines = [ln for _i, ln in flat]
    names = [n for n in (lead_managers or []) if n]
    rows, problems, first_page = [], [], None
    prev_end = 0
    for i, ln in enumerate(lines):
        if not _SUMMARY_RX.search(ln):
            continue
        # A caption with no "handled by" in reach (a bare title line printed above the real
        # caption) is skipped, not read.
        cap_at = next((j for j in (i, i + 1) if j < len(lines) and _HANDLED_RX.search(lines[j])), None)
        if cap_at is None:
            continue
        if cap_at != i and _SUMMARY_RX.search(lines[cap_at]):
            continue
        page = flat[i][0]
        alias = _caption_name(lines, cap_at)
        table_rows, why = _summary_rows(lines, cap_at + 1)
        span_start = prev_end
        prev_end = i + 1
        if table_rows is None:
            problems.append("p%d %s: %s" % (page, alias, why))
            continue
        brlm = None
        if alias and _FIRM_END_RX.search(canon_firm(alias)):
            # B4: a full caption name takes the document's own BRLM spelling when the list is known.
            brlm = _match_firm(alias, names) if names else alias
        elif not names:
            problems.append("p%d %s: short_name_and_no_document_brlm_list" % (page, alias))
            continue
        else:
            # The nearest numbered heading above the caption that names one of the document's
            # BRLMs, after the previous summary table and within the section's reach. Detail rows
            # ("2. Aye Finance Limited*") name issuers, never one of this document's BRLMs.
            for j in range(i - 1, max(span_start, i - _HEAD_REACH) - 1, -1):
                hm = _ROMAN_HEAD_RX.match(lines[j])
                if hm:
                    brlm = _match_firm(hm.group(1), names)
                    if brlm:
                        break
            if brlm is None:
                problems.append("p%d %s: no_brlm_heading_above_the_table" % (page, alias))
                continue
            if not alias or not alias_names_firm(alias, brlm):
                # B3: the heading above is not the firm the caption's short name names.
                problems.append("p%d %s: caption_alias_does_not_name_heading_firm %s" % (page, alias, brlm))
                continue
        if brlm is None:
            problems.append("p%d %s: not_one_of_the_documents_brlms" % (page, alias))
            continue
        totals = [_cell_int(c[0]) for _fy, c in table_rows]
        if any(t is None for t in totals):
            problems.append("p%d %s: ipo_total_not_a_count" % (page, alias))
            continue
        # Each row's 30th-day discount + premium counts can never exceed its IPO total.
        bad = False
        for _fy, cells in table_rows:
            buckets = [_cell_int(c) for c in cells[2:8]]
            if any(b is None for b in buckets) or sum(buckets) > _cell_int(cells[0]):
                bad = True
        if bad:
            problems.append("p%d %s: day30_buckets_exceed_total" % (page, alias))
            continue
        if any(name_key(r["brlm"]) == name_key(brlm) for r in rows):
            problems.append("p%d %s: second_table_for_the_same_brlm" % (page, alias))
            rows = [r for r in rows if name_key(r["brlm"]) != name_key(brlm)]
            continue
        rows.append({"brlm": brlm, "issues_3y": sum(totals), "closed_below": None,
                     "fiscal_years": ["%d-%02d" % (fy, (fy + 1) % 100) for fy, _c in table_rows],
                     "page": page})
        first_page = page if first_page is None else first_page
    return rows, first_page, problems


# ------------------------------------------- rows 161-165: WACA 1y / 18m / 3y period table
_WACA_CAPTION_RX = re.compile(
    r"weighted\s+average\s+cost\s+of\s+acquisition\s+of\s+all\s+(?:equity\s+)?shares\s+transacted", re.I)
_PERIOD_RX = {
    "1Y": re.compile(r"^\s*(?:last|past)\s+(?:one|1)\s+year\b", re.I),
    "18M": re.compile(r"^\s*(?:last|past)\s+(?:18|eighteen)(?:\s+months)?\b", re.I),
    "3Y": re.compile(r"^\s*(?:last|past)\s+(?:three|3)\s+years\b", re.I),
}
_PERIOD_TAIL_RX = re.compile(
    r"^(?:\s+months)?(?:\s+(?:immediately\s+)?preceding)?(?:\s+the)?(?:\s+date)?(?:\s+of)?(?:\s+this)?", re.I)
_MARKS = r"[*^#@$]*(?:\(\d\))?"
_NUM = r"\d[\d,]*(?:\.\d+)?"
_WACA_CELL_RX = re.compile(r"^\s*(?P<w>%s|nil|n\.?\s?a\.?|not\s+applicable)%s" % (_NUM, _MARKS), re.I)
_CAP_CELL_RX = re.compile(r"^\s*(?:(?P<ph>\[[^\]]{0,3}\])|(?P<c>%s)\s*(?:times|x)?)%s" % (_NUM, _MARKS), re.I)
_RANGE_RX = re.compile(
    r"^\s*(?P<lo>%s|nil)%s\s*(?:(?:to|–|—|-)\s*(?P<hi>%s|nil)%s)?\s*$" % (_NUM, _MARKS, _NUM, _MARKS), re.I)
_RANGE_NA_RX = re.compile(r"^\s*(?:n\.?\s?a\.?|not\s+applicable)%s\s*$" % _MARKS, re.I)


def _money(tok):
    return float(tok.replace(",", ""))


def _parse_period_row(rest):
    """WACA, cap-multiple and range cells after the period label, or (None, reason)."""
    rest = _PERIOD_TAIL_RX.sub("", rest, count=1)
    m = _WACA_CELL_RX.match(rest)
    if not m:
        return None, "waca_cell_unreadable"
    w = m.group("w")
    rest = rest[m.end():]
    c = _CAP_CELL_RX.match(rest)
    if not c:
        return None, "cap_multiple_cell_unreadable"
    rest = rest[c.end():]
    out = {"waca": None, "waca_why": None, "cap": None, "cap_why": None,
           "low": None, "high": None, "range_why": None}
    if re.match(r"nil", w, re.I):
        out["waca_why"] = "waca_printed_nil"
    elif re.match(r"n|not", w, re.I):
        out["waca_why"] = "waca_printed_not_applicable"
    else:
        out["waca"] = _money(w)
    if c.group("ph") is not None:
        out["cap_why"] = "cap_multiple_placeholder_not_priced"
    else:
        out["cap"] = _money(c.group("c"))
    if _RANGE_NA_RX.match(rest):
        out["range_why"] = "range_printed_not_applicable"
        return out, None
    r = _RANGE_RX.match(rest)
    if not r:
        return None, "range_cell_unreadable"
    lo, hi = r.group("lo"), r.group("hi") if r.group("hi") is not None else r.group("lo")
    # A printed Nil (bonus or gift shares) is a stated absence of a price, never 0 (spec row
    # 111's rule for a nil WACA, applied to the range ends).
    out["low"] = None if re.match(r"nil", lo, re.I) else _money(lo)
    out["high"] = None if re.match(r"nil", hi, re.I) else _money(hi)
    if out["high"] is None and out["low"] is not None:
        return None, "range_high_nil_low_priced"
    if out["low"] is None or out["high"] is None:
        out["range_why"] = "range_end_printed_nil"
    if out["low"] is not None and out["high"] is not None and out["low"] > out["high"]:
        return None, "range_low_above_high"
    return out, None


_NO_PROMOTER_RX = re.compile(
    r"(?:does\s+not\s+have\s+(?:an?\s+|any\s+)?identifiable\s+promoters?|no\s+identifiable\s+promoters?)", re.I)
_PROMOTER_GROUP_RX = re.compile(r"\bpromoters?\b", re.I)
_SELLING_RX = re.compile(r"\bselling\s+shareholders?\b", re.I)


def read_acquisition_ranges(page_texts):
    """{"rows": {period: parsed}, "page", "group"} or {"rows": None, "reason", "page"}.

    The table read is the one under a "weighted average cost of acquisition of all (equity)
    shares transacted ..." caption: the same table the advertisement prints and
    `promoter_acquisition_ranges` holds. `group` is the caption's own wording of whose
    transactions it covers.

    Step-3b review B1 / owner decision D15: a caption must name the Promoter(s) (or the promoter
    group); a caption naming only the selling shareholders is accepted ONLY when the document states
    the issuer has no identifiable promoter (NSE DRHP p105: "does not have an identifiable
    promoter"). Every caption is weighed, never the first one found; when no caption qualifies the
    answer is null with reason group_not_promoter."""
    flat = []
    for idx, text in page_texts:
        for ln in (text or "").split("\n"):
            flat.append((idx, ln))
    lines = [ln for _i, ln in flat]
    no_promoter = any(_NO_PROMOTER_RX.search(t or "") for _i, t in page_texts)
    found, rejected = [], None
    for i, ln in enumerate(lines):
        if not _WACA_CAPTION_RX.search(ln):
            continue
        cap = " ".join(l.strip() for l in lines[i:i + 3])
        gm = re.search(r"transacted\s+(?:by\s+(.+?)\s+)?in\s+(?:the\s+)?(?:last\s+)?(?:one|three)",
                       cap, re.I)
        group = gm.group(1) if gm and gm.group(1) else "all shareholders"
        eligible = bool(_PROMOTER_GROUP_RX.search(group)) or (
            no_promoter and bool(_SELLING_RX.search(group)))
        got, why_rows = {}, {}
        for k in range(i + 1, min(len(lines), i + 40)):
            if k > i + 1 and _WACA_CAPTION_RX.search(lines[k]) and got:
                break
            for period, rx in _PERIOD_RX.items():
                m = rx.match(lines[k])
                if m and period not in got:
                    # A line that starts with the label but does not parse as a row (the
                    # caption itself: "LAST THREE YEARS, EIGHTEEN MONTHS ...") is not the row;
                    # its reason is kept only if no later line reads as that period's row.
                    parsed, why = _parse_period_row(lines[k][m.end():])
                    if parsed is None:
                        why_rows.setdefault(period, why)
                    else:
                        got[period] = parsed
                        why_rows.pop(period, None)
            if len(got) == 3:
                break
        if not (got or why_rows):
            continue
        if not eligible:
            rejected = rejected or (i, group)
            continue
        found.append((i, got, why_rows, group))
        break
    if not found:
        if rejected is not None:
            return {"rows": None, "page": flat[rejected[0]][0],
                    "reason": "group_not_promoter: %s" % rejected[1][:80]}
        return {"rows": None, "reason": "waca_period_table_not_found", "page": None}
    i, got, why_rows, group = found[0]
    page = flat[i][0]
    if why_rows or len(got) != 3:
        missing = sorted(set(_PERIOD_RX) - set(got) - set(why_rows))
        return {"rows": None, "page": page,
                "reason": "waca_period_rows_unreadable: %s" % (
                    ", ".join("%s %s" % kv for kv in sorted(why_rows.items()))
                    or "missing %s" % missing)}
    return {"rows": got, "page": page, "group": group}


# ------------------------------------------------------ row 158: BRLM grievance e-mail
# Step-3b review B2: a heading that opens another intermediary's block ends the BRLM block above it
# in that column; a grievance label below such a heading is never filed under a BRLM.
_NON_BRLM_HEAD_RX = re.compile(
    r"^\s*(?:registrar\s+to\s+the\s+(?:offer|issue)|(?:domestic\s+|international\s+)?legal\s+counsel"
    r"|syndicate\s+members?|statutory\s+auditors?|(?:joint\s+)?statutory\s+auditor"
    r"|bankers?\s+to\s+(?:the\s+)?(?:offer|issue|our\s+company|the\s+company)|escrow\s+collection\s+bank"
    r"|refund\s+bank|public\s+offer\s+account\s+bank|sponsor\s+banks?|monitoring\s+agency"
    r"|company\s+secretary|chief\s+financial\s+officer|independent\s+chartered\s+accountant)", re.I)
_LABEL_WORD_RX = re.compile(r"^(?:Telephone|Tel|E-?mail|Website|Contact|SEBI|Investor)\b:?", re.I)
_EMAIL_RX = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")


def _word_lines(words, tol=3.0):
    """Words grouped into printed lines (same `top` within tol), each sorted by x0."""
    lines = []
    for w in sorted(words, key=lambda w: (round(w["top"]), w["x0"])):
        for ln in lines:
            if abs(ln[0]["top"] - w["top"]) <= tol:
                ln.append(w)
                break
        else:
            lines.append([w])
    for ln in lines:
        ln.sort(key=lambda w: w["x0"])
    lines.sort(key=lambda ln: ln[0]["top"])
    return lines


def _segments(line, gap=18.0):
    """A printed line cut into its column pieces wherever the gap between words is wide."""
    segs, cur = [], [line[0]]
    for w in line[1:]:
        if w["x0"] - cur[-1]["x1"] > gap:
            segs.append(cur)
            cur = [w]
        else:
            cur.append(w)
    segs.append(cur)
    return segs


def read_grievance_emails(page_texts, words_for_page, lead_managers):
    """{brlm name: grievance e-mail} read by word position, plus a list of problems.

    The text layer interleaves a two-column BRLM grid ("E-mail: X Investor grievance e-mail:
    Y" on one line holds two firms' cells), so the label's own x position decides its column,
    and the firm is the heading above it in that column. A label whose column has no firm
    heading above it on the page, or whose address is not an e-mail, is a problem, never a
    guess; a firm given two different addresses keeps neither."""
    names = [n for n in (lead_managers or []) if n]
    if not names:
        return None, ["no_document_brlm_list"]
    if words_for_page is None:
        return None, ["no_word_positions_available"]
    pages = [i for i, t in page_texts if re.search(r"grievance\s+e-?\s?mail", t or "", re.I)
             and any(canon_firm(n)[:12] in canon_firm(t) for n in names)]
    found, problems = {}, []
    for idx in pages:
        words = words_for_page(idx) or []
        if not words:
            continue
        lines = _word_lines(words)
        # Column starts = where the contact labels (Telephone:, E-mail:, Website:, Contact
        # person:, SEBI registration, Investor grievance) begin; every firm block starts its
        # lines there. A word belongs to the last column start at or left of it.
        starts = sorted(round(ln[k]["x0"]) for ln in lines for k in range(len(ln))
                        if _LABEL_WORD_RX.match(ln[k]["text"])
                        and (k == 0 or ln[k]["x0"] - ln[k - 1]["x1"] > 6))
        cols = []
        for x in starts:
            if not cols or x - cols[-1] > 40:
                cols.append(x)
        if not cols:
            continue

        def col_of(x0):
            c = [s for s in cols if s <= x0 + 3]
            return c[-1] if c else None

        segs = []  # (line index, words of one column on that line)
        for li, ln in enumerate(lines):
            by_col = {}
            for w in ln:
                by_col.setdefault(col_of(w["x0"]), []).append(w)
            for c, ws in by_col.items():
                if c is not None:
                    segs.append((li, ws))
        heads = []  # (x0, top, name)
        for li, s in segs:
            nm = _match_firm(" ".join(w["text"] for w in s), names)
            if nm:
                heads.append((s[0]["x0"], s[0]["top"], nm))
        if not heads:
            continue
        stops = [(s[0]["x0"], s[0]["top"]) for _li, s in segs
                 if _NON_BRLM_HEAD_RX.match(" ".join(w["text"] for w in s))]

        page_hits = []
        for li, s in segs:
            text = " ".join(w["text"] for w in s)
            lm = re.search(r"grievance\s+e-?\s?mail\s*(?:id)?\s*:?", text, re.I)
            if not lm:
                continue
            col = col_of(s[0]["x0"])
            if col is None:
                problems.append("p%d label_left_of_every_column" % idx)
                continue
            tail = text[lm.end():].strip().split()
            email = tail[0].rstrip(".;,") if tail else None
            if email is None:
                # The address wrapped onto the next printed line, same column.
                nxt = [s2 for li2, s2 in segs if li2 == li + 1 and col_of(s2[0]["x0"]) == col]
                email = nxt[0][0]["text"].rstrip(".;,") if nxt else None
            if not email or not _EMAIL_RX.match(email):
                problems.append("p%d grievance_address_not_an_email: %s" % (idx, email))
                continue
            above = [h for h in heads if col_of(h[0]) == col and h[1] < s[0]["top"]]
            if not above:
                problems.append("p%d %s: no_firm_heading_above_in_column" % (idx, email))
                continue
            head = max(above, key=lambda h: h[1])
            # Any column: a section heading ("Registrar to the Offer") often spans the page from the
            # left margin, and it ends every BRLM block above it (fail closed).
            stop = [t for _x, t in stops if head[1] + 3 < t < s[0]["top"]]
            if stop:
                problems.append("p%d %s: label_under_a_non_brlm_heading" % (idx, email))
                continue
            page_hits.append((head, email))
        # One grievance label per firm block. A heading that collects two labels means the page
        # is not the heading-over-block grid this reader understands (a cover table whose firm
        # names wrap, a column the clustering merged): nothing on that page is used.
        per_head = {}
        for head, email in page_hits:
            per_head.setdefault(head, []).append(email)
        if any(len(v) > 1 for v in per_head.values()):
            problems.append("p%d layout_not_one_label_per_firm_block" % idx)
            continue
        for head, emails in per_head.items():
            firm, email = head[2], emails[0]
            if firm in found and found[firm] != email:
                problems.append("%s: two_addresses %s / %s" % (firm, found[firm], email))
                found[firm] = None
            elif firm not in found:
                found[firm] = email
    out = {k: v for k, v in found.items() if v}
    return out, problems
