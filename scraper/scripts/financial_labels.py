"""ONE label dictionary for the offer-document financial grids (OD-173 rebuild, steps 3/3b/4).

Used by financial_copies.py for the statement grids and the other mandated sections' tables, and by the
unread-table guard. Ported from the proven spike (claude-doc/rebuild/label_dictionary.py) without behaviour change.

Every target field is written once: the statement it lives on, the accepted label shapes (full match on the
normalised label), the refusal shapes (searched on the raw lower-cased label AND on its header context), and how its
value is read. A field with no accepted row is MISSED; it is never filled from a neighbouring row or by arithmetic.

Binding decisions: D8 (pre_ipo_eps = latest-FY basic EPS, written only when its sign matches PAT), D9 (reserves =
"Other equity" or "Reserves and surplus"), D10 ("-" / "Nil" in a borrowings total = 0), D11 (single-value fields =
latest FULL fiscal year; never fall back to an older year), D13 (consolidated wins), OD-172 (plain "EBITDA" beats a
qualified EBITDA; %, margin, ratio, "to", "/", per share, growth are never EBITDA), and the answer-key rule "a total
the document does not print is not expected" (no adding current + non-current borrowings).
"""
import re

TO_CRORE = {'crore': 1.0, 'million': 0.1, 'lakh': 0.01, 'thousand': 0.0001}

# ---------------------------------------------------------------- label normalisation
_LEAD = re.compile(r'^(?:[-–—*•�]\s*)+|^(?:[ivx]{1,5}|[a-h]|\d{1,2})[.)]\s+|'
                   r'^\((?:[ivx]{1,5}|[a-h]|\d{1,2})\)\s*|^[ivx]{1,5}\s+(?=[a-z(])|^[a-h]\.\s*')
_TRAIL_NOTE = re.compile(r'\s+\d{1,3}(?:\.\d+)?[a-z]?(?:\s*\([a-z]\))?(?:\s*[&,]\s*[\d.a-z() ]+)?$')
_TRAIL_PAREN = re.compile(r'\s*\([^()]*\)\s*$')
_TRAIL_FORMULA = re.compile(r'\s*(?:\(?[ivxa-h\d]{1,4}\)?\s*[+\-=]\s*)+\(?[ivxa-h\d]{1,4}\)?\s*$')


def raw_lower(label):
    s = (label or '').lower().replace('’', "'").replace('₹', 'rs ')
    return re.sub(r'\s+', ' ', s).strip()


def norm(label):
    """'XI Restated profit for the year (IX-X)' -> 'restated profit for the year'."""
    s = raw_lower(label)
    for _ in range(3):
        s2 = _LEAD.sub('', s).strip()
        if s2 == s:
            break
        s = s2
    for _ in range(6):
        s2 = _TRAIL_FORMULA.sub('', s)
        s2 = _TRAIL_PAREN.sub('', s2)
        s2 = re.sub(r'\s*-\s*total$', '', s2)
        s2 = re.sub(r'[\s:*#]+$', '', s2)
        s2 = _TRAIL_NOTE.sub('', s2).strip()
        if s2 == s:
            break
        s = s2
    s = re.sub(r'\s*/\s*', ' / ', s)
    return re.sub(r'\s+', ' ', s).strip()


# ---------------------------------------------------------------- statement classification by row labels
SIGNATURES = {
    'pl': [r'(?:total )?revenue from operations?', r'total (?:income|revenue)', r'total expenses?', r'other income',
           r'(?:total )?tax expenses?', r'.*\bbasic\b.*', r'finance costs?', r'employee benefits? expenses?'],
    'bs': [r'total assets', r'equity share capital', r'total equity and liabilities', r'inventories',
           r'trade receivables', r'total (?:current|non-current) (?:assets|liabilities)', r'other equity'],
    'cf': [r'.*operating activities', r'.*investing activities', r'.*financing activities',
           r'net (?:increase|decrease).*cash.*', r'cash and cash equivalents? at the (?:beginning|end).*'],
}


def classify(rows):
    """-> (kind or None, {kind: hits}). A kind needs >= 2 distinct signature hits and a strict lead."""
    hits = {}
    for k, pats in SIGNATURES.items():
        n = set()
        for r in rows:
            lab = norm(r['label'])
            for i, p in enumerate(pats):
                if re.fullmatch(p, lab):
                    n.add(i)
        hits[k] = len(n)
    best = max(hits, key=hits.get)
    others = [v for k, v in hits.items() if k != best]
    return (best if hits[best] >= 2 and hits[best] > max(others) else None), hits


# ---------------------------------------------------------------- the dictionary
P_PROFIT_CORE = (r'(?:profit|loss|profit / loss|loss / profit|profit / \(loss\)|\(loss\) / profit|profit\s*\(loss\)|'
                 r'net profit|net loss|net profit / \(loss\))')
P_PERIOD = r'(?: for the (?:year|period|year / period|period / year))?'

FIELDS = {
    'revenue': dict(
        kind='pl', value='money', mode='series',
        accept=[[r'(?:total )?(?:net )?revenue from operations?']],
        refuse=r'\bgross\b|excise|\bgst\b|other|share of|\bless\b|growth|%',
        why='"Revenue from operations" (or its "Total ..." line), never other income, gross-of-tax or a breakdown line.'),
    'total_income': dict(
        kind='pl', value='money', mode='series',
        accept=[[r'total income'], [r'total revenue']],
        refuse=r'from operations|comprehensive|other|growth|%',
        identity_for_tier1=True,
        why='"Total income"; "Total revenue" only when no "Total income" row exists AND revenue + other income = it.'),
    'profit': dict(
        kind='pl', value='money', mode='series',
        accept=[[r'(?:restated )?' + P_PROFIT_CORE + r'(?: after tax(?:es)?)?' + P_PERIOD + r'(?: after tax(?:es)?)?'
                 r'(?: / (?:restated )?profit after tax)?']],
        refuse=r'before|attributable|owners?\b|non-controlling|minority|comprehensive|continuing|discontinued|'
               r'share of|exceptional|per (?:equity )?share|carried|brought|balance|transferred|opening|margin|%',
        why='Total profit/(loss) for the year after tax (PAT): not before tax, not attributable to owners/NCI, not '
            'continuing operations alone, not total comprehensive income.'),
    'ebitda': dict(
        kind='pl', value='money', mode='series',
        accept=[[r'(?:restated )?(?:ebitda|ebidta|earnings before interest,? (?:and )?tax(?:es|ation)?,? '
                 r'depreciation,? and amorti[sz]ation(?: expenses?)?(?: \(ebitda\))?)'],
                [r'(?:operating|adjusted|normali[sz]ed|core) (?:ebitda|ebidta)']],
        refuse=r'%|margin|ratio|\bto\b| / |per (?:equity )?share|growth',
        why='OD-172: plain "EBITDA" row; a qualified (Operating/Adjusted) row only when no plain row exists.'),
    'eps_basic': dict(
        kind='pl', value='per_share', mode='series',
        accept=[[r'.*\bbasic\b.*']],
        refuse=r'weighted|number of|no\. of|%|\bshares? outstanding',
        context_refuse=r'(?<!and )\b(?:continuing|discontinued)\b(?! and discontinued)',
        why='Row labelled Basic (incl. "Basic and diluted"); refused under a "continuing" or "discontinued" '
            'operations header unless it says "continuing and discontinued".'),
    'eps_diluted': dict(
        kind='pl', value='per_share', mode='series',
        accept=[[r'.*\bdiluted\b.*']],
        refuse=r'weighted|number of|no\. of|%|\bshares? outstanding',
        context_refuse=r'(?<!and )\b(?:continuing|discontinued)\b(?! and discontinued)',
        why='As eps_basic, for Diluted.'),
    'net_worth': dict(
        kind='bs', value='money', mode='latest',
        accept=[[r'(?:restated )?net ?worth']],
        refuse=r'%|return|ratio',
        why='Only a row printed as "Net worth". "Total equity" / "Equity attributable to owners" are REFUSED: the '
            'keys show net worth differs from both (Hero FY2024 key 3,854.44 vs attributable 3,858.39; NSE FY2026 '
            'key 318,697.20 vs total equity 321,135.41 million).'),
    'reserves_and_surplus': dict(
        kind='bs', value='money', mode='latest',
        accept=[[r'other equity', r'reserves? (?:and|&) surplus']],
        refuse=r'attributable|non-controlling|total equity|share capital',
        why='D9: "Other equity" (Ind AS) or "Reserves and surplus", latest full FY (D11).'),
    'total_assets': dict(
        kind='bs', value='money', mode='latest',
        accept=[[r'total assets']],
        refuse=r'non-current|current|equity|liabilities',
        why='"Total assets", latest full FY (D11).'),
    'total_borrowing': dict(
        kind='bs', value='money', mode='latest', dash_is_zero=True,
        accept=[[r'total borrowings?']],
        refuse=r'current|non-current|lease',
        why='Only a printed "Total borrowings" row (answer-key rule: a total the document does not print is not '
            'expected; current + non-current are never added). D10: "-"/"Nil" in that row = 0.'),
    'op_cash_flow': dict(
        kind='cf', value='money', mode='series',
        accept=[[r'net cash.*operating activities']],
        refuse=r'continuing|discontinued|before|investing|financing',
        why='"Net cash from/(used in) operating activities" (after tax), never "cash generated from operations".'),
}

# Fields keyed in the answer keys that the statement grids never print: declared refusals, always MISSED here.
NOT_ON_STATEMENTS = {
    'ronw': 'a ratio (return on net worth) printed in the KPI / accounting-ratio tables, not on a statement; never computed',
    'rent_expense': 'printed in the notes to accounts, not on the face of a statement',
    'dscr': 'a ratio printed in KPI tables, not on a statement; never computed',
}


# ================================================================ step 3b: the other mandated sections
# Same rules, read from the tables of the Offer Document Summary (sod), Other Financial Information (ofi), Basis for
# Offer Price (bop), Capitalisation Statement (cap) and the restated notes (restated). A field is read only from the
# sections listed for it. Any two accepted rows that disagree for a period refuse the field.
_UNIT_PAREN = re.compile(r'\(?\s*(?:in\s+)?(?:rs\.?|inr|₹|rs )?\s*(?:in\s+)?(?:millions?|mn|lakhs?|lacs?|crores?|cr)\s*\)?'
                         r'|\(\s*(?:in\s+)?(?:rs\.?|₹|inr)\s*\)', re.I)


def norm3(label):
    """-> (normalised label, is_percent). Unit words, footnote digits and markers are removed before matching."""
    s = raw_lower(label)
    pct = '%' in s or 'per cent' in s or 'percent' in s
    s = s.replace('%', ' ')
    s = _UNIT_PAREN.sub(' ', s)
    s = re.sub(r'[*^#†]+', ' ', s)
    s = re.sub(r'\(\s*\)', ' ', s)
    s = re.sub(r'(?<=[a-z)])\d{1,2}(?=\s|$)', ' ', s)  # 'EBITDA1' footnote
    return norm(s), pct


def accept_label(spec, label):
    """The ONE acceptance test for a printed row label, used by every reader AND by the unread-table guard (step 4).

    -> (tier, None) accepted at that tier; (None, None) not a label of this field; (tier, why) a label of this field's
    shape that the dictionary refuses (refusal pattern, context words in the label, or a percent row for a money /
    per-share field: "EBITDA %" is never EBITDA, OD-172)."""
    lab, pct = norm3(label)
    tier = next((i for i, pats in enumerate(spec['accept']) if any(re.fullmatch(p, lab) for p in pats)), None)
    if tier is None:
        return None, None
    raw = raw_lower(label)
    if re.search(spec['refuse'], raw):
        return tier, 'refusal pattern'
    cr = spec.get('context_refuse')
    if cr and re.search(cr, raw):
        return tier, 'context refusal'
    if pct and spec['value'] in ('money', 'per_share'):
        return tier, 'a percent row is not a %s value' % spec['value']
    return tier, None


FIELDS_3B = {
    'ebitda': dict(
        sections=('sod', 'ofi', 'bop'), value='money', mode='series',
        accept=[[r'(?:restated )?(?:ebitda|ebidta|earnings before interest,? (?:and )?tax(?:es|ation)?,? '
                 r'depreciation,? and amorti[sz]ation(?: expenses?)?(?: \(ebitda\))?)'],
                [r'(?:operating|adjusted|normali[sz]ed|core) (?:ebitda|ebidta)']],
        refuse=r'margin|ratio|\bto\b|/|per (?:equity )?share|growth|reconciliation|\(e=',
        why='OD-172: plain "EBITDA" row; a qualified row (Operating/Adjusted) only when the document prints no plain '
            'row; %, margin, ratio, "to", "/", per share and growth rows are never EBITDA.'),
    'net_worth': dict(
        sections=('sod', 'ofi', 'bop'), value='money', mode='series',
        accept=[[r'(?:restated )?(?:total )?net ?worth']],
        refuse=r'return|ratio|per (?:equity )?share|average|adjusted|tangible|attributable|growth|/|\bto\b',
        why='Only a row the document itself labels "Net worth" (accounting ratios, KPI, summary table). Total equity '
            'and equity attributable to owners are NOT net worth (Hero 385.839 vs key 385.444; NSE 32,113.54 vs '
            '31,869.72 crore) and are never read or derived.'),
    'total_borrowing': dict(
        sections=('sod', 'ofi', 'bop', 'cap'), value='money', mode='latest', dash_is_zero=True,
        accept=[[r'total (?:borrowings?|debt)']],
        refuse=r'\bnet\b|ratio|equity|/|lease|current|average|\bto\b|growth',
        why='A printed "Total borrowings" / "Total debt" line (summary, KPI, capitalisation statement); never current '
            '+ non-current added; D10: "-"/"Nil" on that printed total = 0.'),
    'ronw': dict(
        sections=('sod', 'ofi', 'bop'), value='percent', mode='latest',
        accept=[[r'(?:restated )?(?:return on (?:average )?net ?worth|ronw)(?: \(ronw\))?']],
        refuse=r'weighted|adjusted|annuali[sz]ed|margin|/',
        why='"Return on net worth (%)" row, or the RoNW column of the period-per-row RoNW table; the weighted '
            'average line is never RoNW; never computed.'),
    'rent_expense': dict(
        sections=('restated',), value='money', mode='series',
        accept=[[r'(?:rent|rents|rent expenses?|rental (?:charges|expenses?)|rent charges)']],
        refuse=r'income|received|receivable|deposit|lease|prepaid|advance|security|recover',
        why='The "Rent" line of the restated notes (other expenses); rental income, deposits and lease lines are '
            'never rent expense.'),
}
