"""The issuer's registered office, read off the offer document's cover (Appendix A rows 61, 64-66).

SEBI ICDR Schedule VI makes every DRHP / RHP / PROSPECTUS print the issuer's registered office on
its cover, as a labelled prose line ("Registered Office: <address>; Telephone: ...") on the second
cover and often again in the first cover's table. This reader takes the labelled line only: the
first cover's table prints the address in a column that text order runs together with the contact
person's column (NSE DRHP p.1: "Exchange Plaza, C-1, Block G, Bandra Kurla Complex, Smt. Prajakta
Powle, Company Secretary and ..."), so it is never read as an address.

    company_address   the registered office as printed (whitespace collapsed, trailing ';' cut)
    company_pincode   the six-digit PIN printed in it ("400 051" -> "400051")
    company_state     the one Indian state / union territory named in it
    company_city      the place printed before the PIN (or before the state, when the state
                      sits between the place and the PIN), at most two words

Where the document names a registered office and a separate corporate office, the REGISTERED
office is the company's address (its statutory address, the one its CIN is registered at).

Answer states (answer_states.py): every labelled line on the cover pages must agree, or the
address is MISSED with `company_address_sources_disagree` (B4(c), never a pick). No labelled line
is MISSED `company_address_not_found`. A city / state / PIN that cannot be read unambiguously from
an agreed address is MISSED with its own cause; none is ever guessed. No reason here is a stated
absence: a cover never says "our company has no registered office".
"""

import re

import answer_states

COVER_PAGES = 4

# "Registered Office:", "Registered office & Corporate office:", "Registered Office and Corporate
# Office:", "Registered and Corporate Office:". The colon is required: prose such as "the
# registered office of our Company, see ..." is not a label.
REG_LABEL = re.compile(
    r"\bRegistered\s+(?:(?:and|&)\s+Corporate\s+)?Office(?:\s+(?:and|&)\s+Corporate\s+Office)?\s*:\s*", re.I)
# The address ends at the next label of the contact block or at a ';' / end of the block.
NEXT_LABEL = re.compile(
    r"(?:;|\bCorporate\s+Office\s*:|\bAdministrative\s+Office\s*:|\bContact\s+Person\b|\bTel(?:ephone)?\s*(?:No\.?)?\s*:|"
    r"\bPhone\s*:|\bE-?mail\s*:|\bWebsite\s*:|\bCorporate\s+Identity\s+Number\b|\bCIN\s*:|\bFax\s*:)", re.I)
# Where the issuer block ends on a cover page: what follows belongs to the intermediaries.
BLOCK_END = re.compile(r"^\s*(?:BOOK\s+RUNNING\s+LEAD\s+MANAGER|LEAD\s+MANAGER|REGISTRAR\s+TO\s+THE)", re.I)
PIN = re.compile(r"(?<!\d)([1-9]\d{2})\s?(\d{3})(?!\d)")
DIRECTION = re.compile(r"(?:\((?:East|West|North|South)\)|\b(?:East|West|North|South)\b)\s+", re.I)

STATES = (
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
    "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
    "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Orissa", "Punjab",
    "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
    "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
    "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "NCT of Delhi", "Jammu and Kashmir",
    "Ladakh", "Lakshadweep", "Puducherry",
)
_STATE_RX = re.compile(r"(?<![A-Za-z])(" + "|".join(sorted((re.escape(s) for s in STATES), key=len, reverse=True))
                       + r")(?![A-Za-z])", re.I)
_CANON_STATE = {s.lower(): s for s in STATES}
_CANON_STATE["orissa"] = "Odisha"
_CANON_STATE["nct of delhi"] = "Delhi"


def _canon(address):
    return re.sub(r"[^a-z0-9]", "", address.lower())


def _labelled_addresses(page_texts):
    """[(address, page)]: the first labelled registered office on each cover page, read up to the
    next contact label, joined across the line breaks it wraps over."""
    found = []
    for idx, text in list(page_texts)[:COVER_PAGES]:
        lines = (text or "").splitlines()
        stop = next((k for k, l in enumerate(lines) if BLOCK_END.match(l)), len(lines))
        blob = "\n".join(lines[:stop])
        m = REG_LABEL.search(blob)
        if not m:
            continue
        rest = blob[m.end():]
        end = NEXT_LABEL.search(rest)
        raw = rest[:end.start()] if end else rest[:300]
        address = re.sub(r"\s+", " ", raw).strip(" ;,.")
        if address:
            found.append((address, idx))
    return found


def check_address(address):
    if address is None:
        return answer_states.missed("no address")
    if 10 <= len(address) <= 400 and PIN.search(address) and re.search(r"[A-Za-z]", address):
        return (True, "registered office with a PIN")
    return answer_states.refused("%r is not an address with a six-digit PIN" % address)


def _pincode(address):
    pins = {a + b for a, b in PIN.findall(address)}
    return (pins.pop(), None) if len(pins) == 1 else (None, "not_found" if not pins else "two_candidates")


def _state(address):
    states = {_CANON_STATE[s.lower()] for s in _STATE_RX.findall(address)}
    return (states.pop(), None) if len(states) == 1 else (None, "not_found" if not states else "two_candidates")


def _city(address, state):
    """The place printed before the PIN: 'Bandra (East) Mumbai 400 051' -> Mumbai;
    'New Delhi, Delhi - 110 052' -> New Delhi (the state sits before the PIN)."""
    m = PIN.search(address)
    head = re.split(r",", address[:m.start()])
    segs = [s.strip(" -–—,.") for s in head]
    segs = [s for s in segs if s]
    if not segs:
        return None, "not_found"
    place = segs[-1]
    if state and place.lower() == state.lower() and len(segs) > 1:
        place = segs[-2]
    parts = DIRECTION.split(place)
    place = parts[-1].strip()
    if state and place.lower() == state.lower():
        return None, "is_the_state"
    # A place that carries the state name ("Pune Maharashtra") is a place and a state run
    # together; only the capital "New Delhi" legitimately contains its state's name.
    if state and re.search(r"\b%s\b" % re.escape(state), place, re.I) and place.lower() != "new delhi":
        return None, "unresolved"
    # A district or taluk is not a city ("Kancheepuram District", Hyundai DRHP p.3).
    if re.search(r"\b(?:District|Dist|Taluka?|Tehsil|Mandal)\b", place, re.I):
        return None, "is_a_district"
    words = place.split()
    if not (1 <= len(words) <= 2) or not all(re.fullmatch(r"[A-Za-z][A-Za-z.'\-]*", w) for w in words):
        return None, "unresolved"
    return place, None


def read_issuer_address(page_texts, emit):
    cands = _labelled_addresses(page_texts)
    keys = {_canon(a) for a, _p in cands}
    names = ("company_address", "company_pincode", "company_state", "company_city")
    if len(keys) != 1:
        why = "not_found" if not keys else "sources_disagree"
        for n in names:
            emit.null(n, "%s_%s" % (n, why) if n == "company_address" else "company_address_%s" % why)
        return None
    address, page = cands[0]
    pages = sorted({p for _a, p in cands})
    emit.put("company_address", address, page, "address_has_pin", check_address(address))
    rec = emit.fields["company_address"]
    if rec.get("value") is None:
        for n in names[1:]:
            emit.null(n, "company_address_refused")
        return None
    rec["pages"] = pages
    pin, why = _pincode(address)
    _put(emit, "company_pincode", pin, page, pages, why, "pincode_six_digits",
         lambda v: (True, v) if re.fullmatch(r"[1-9]\d{5}", v) else answer_states.refused("%r" % v))
    state, why = _state(address)
    _put(emit, "company_state", state, page, pages, why, "state_is_indian",
         lambda v: (True, v))
    city, why = _city(address, state) if pin else (None, "no_pin")
    _put(emit, "company_city", city, page, pages, why, "city_is_a_place_name",
         lambda v: (True, v))
    return address


def _put(emit, name, value, page, pages, why, check_name, check):
    if value is None:
        emit.null(name, "%s_%s" % (name, why))
        return
    emit.put(name, value, page, check_name, check(value))
    if emit.fields[name].get("value") is not None:
        emit.fields[name]["pages"] = pages
