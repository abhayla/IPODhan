"""The maximum bid amounts an offer document prints for a retail individual bidder and an eligible
employee (Appendix A rows 73-74, `ipo_details.max_retail_subscription` / `max_employee_subscription`,
rupees per OD-48).

Read from the sentences SEBI ICDR makes every book-built DRHP / RHP / PROSPECTUS print, never from
the "Offer Structure" table (its columns run together in text order, NSE DRHP p.480-481):

    retail    the "Retail Individual Bidder(s)" / "Retail Individual Investor(s)" / "RIB(s)" / "RII(s)"
              Definitions row: "... whose Bid Amount ... is not more than Rs 0.20 million ..." /
              "... who have Bid for an amount not more than Rs 2,00,000 ..."
    employee  "The maximum Bid Amount under the Employee Reservation Portion by an Eligible Employee
              shall not exceed Rs 0.50 million"

Answer states: every reading in the document must agree (B4(c)); two different amounts are MISSED
`*_sources_disagree`, never a pick. No sentence is MISSED `*_not_found` (an SME offer has no retail
cap of this form; a fixed-price offer may print none). An amount outside the regulatory range
(retail 1 to 5 lakh, employee 1 to 10 lakh) is REFUSED. No reason is a stated absence.
"""

import re

import answer_states

DEFINITIONS_PAGES = 40

# The rupee mark is required: "not more than 10% of the Offer" is not an amount.
RUPEE = r"(?:Rs\.?|INR|₹|`)\s*"
AMOUNT = re.compile(RUPEE + r"(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d+)?)\s*(million|mn|lakhs?|lacs?|crores?)?\b", re.I)
_UNIT = {"million": 10 ** 6, "mn": 10 ** 6, "lakh": 10 ** 5, "lakhs": 10 ** 5, "lac": 10 ** 5, "lacs": 10 ** 5,
         "crore": 10 ** 7, "crores": 10 ** 7}

# The Definitions row's term, quoted or not, whole or wrapped ("“Retail Individual" / "Bidders” or
# “RIB(s)”", Emcure DRHP p.15; "Retail Individual Investors or RIIs ...", Studds DRHP p.10).
RIB_TERM = re.compile(r"^\s*[“\"]?(?:Retail\s+Individual\b|RIBs?\b|RIIs?\b)", re.I)
# Side-by-side Definitions pages interleave the term column into the sentence ("not more than
# Bidders” or “RIB(s)” ₹0.20 million", Emcure DRHP p.15): up to 45 characters with no digit, rupee
# mark or sentence end may sit between "than" and the amount.
RIB_CAP = re.compile(r"\bnot\s+more\s+than\s+[^\d₹`.;%]{0,45}?" + AMOUNT.pattern, re.I)
EMP_CAP = re.compile(r"maximum\s+Bid\s+Amount\s+under\s+the\s+Employee\s+Reservation\s+Portion\s+by\s+an\s+"
                     r"Eligible\s+Employee\s+shall\s+not\s+exceed\s+" + AMOUNT.pattern, re.I)

RANGES = {"max_retail_subscription": (100000, 500000), "max_employee_subscription": (100000, 1000000)}


def rupees(number, unit):
    value = float(number.replace(",", ""))
    if unit:
        value *= _UNIT[unit.lower()]
    elif "," not in number and value < 1000:
        return None  # a bare small number with no unit is not a rupee amount
    return int(round(value))


def check_range(name):
    lo, hi = RANGES[name]

    def check(value):
        if lo <= value <= hi:
            return (True, "%d rupees" % value)
        return answer_states.refused("%d rupees is outside %d..%d" % (value, lo, hi))
    return check


def _retail_readings(page_texts):
    out = []
    for idx, text in list(page_texts)[:DEFINITIONS_PAGES]:
        lines = (text or "").splitlines()
        for k, line in enumerate(lines):
            if not RIB_TERM.match(line):
                continue
            # from the line above: the row's sentence can start beside the term (Water Infra DRHP p.15)
            window = re.sub(r"\s+", " ", " ".join(lines[max(0, k - 1):k + 5]))
            m = RIB_CAP.search(window)
            if m:
                out.append((rupees(m.group(1), m.group(2)), idx))
    return out


def _employee_readings(page_texts):
    out = []
    for idx, text in page_texts:
        blob = re.sub(r"\s+", " ", text or "")
        for m in EMP_CAP.finditer(blob):
            out.append((rupees(m.group(1), m.group(2)), idx))
    return out


def read_bid_limits(page_texts, emit):
    page_texts = list(page_texts)
    for name, readings in (("max_retail_subscription", _retail_readings(page_texts)),
                           ("max_employee_subscription", _employee_readings(page_texts))):
        amounts = {a for a, _p in readings}
        if not readings:
            emit.null(name, "%s_not_found" % name)
        elif len(amounts) != 1 or None in amounts:
            emit.null(name, "%s_sources_disagree" % name)
        else:
            value = amounts.pop()
            emit.put(name, value, readings[0][1], "bid_limit_in_regulatory_range", check_range(name)(value))
            if emit.fields[name].get("value") is not None:
                emit.fields[name]["pages"] = sorted({p for _a, p in readings})
