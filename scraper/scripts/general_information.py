"""General Information section of an offer document: the book running lead managers' blocks and the registrar's
investor grievance e-mail (OD-173 rebuild, section 3; plan 2026-10-07 "GI attempt 4" DECISION).

Ported from the proven spike (claude-doc/rebuild-gi/gi_spike.py, attempt 4: 0 wrong on the tuning set and on four
blind sets) without behaviour change. Pipeline:
  contents-page section locator -> page furniture removed (page_furniture.py) -> word-position bands / columns ->
  ONE line classifier (classify) that every reader calls -> ONE block grammar (entity name line(s) -> address
  line(s) -> contact lines; out of order = refused, never re-assigned) -> ONE label dictionary -> copies checked
  (OD-177 / F-248) with cover copies read only from the same column cell under the same entity's heading.
Fail closed: a missed value is acceptable, a wrong one is not.

The product reads from this module ONLY the families the plan moved (0 wrong on all five sets AND found >= today):
lead_managers, each BRLM's SEBI no. / contact person / phone / e-mail / grievance e-mail, and the registrar's
grievance e-mail. The registrar's other fields, the compliance officer and the company contact fields stay on
today's readers (cover_block.py); company address and registrar phone / e-mail are PARKED (never emitted here).

read_general_information(page_texts, grid_words_for_page, ocr_pages) -> {
  section, fields: {lead_managers, brlm_rows, registrar}, log, reason}
"""
import re

import page_furniture
import section_locator as sl
import statement_grid as sg

# ---------------- normalisation steps (each switchable for the mutation tests) ----------------
STRIP_ALIAS = True          # "(formerly known as ...)" on the line, wrapped to the next line, or split into another column
STRIP_MARKS = True          # footnote marks * ^ ** † #
STRIP_LABEL_PREFIX = True   # "Name:", "Address:", "Registered Office:" in front of a value
ENTITY_DIGITS = True        # an entity name may hold digits ("360 ONE WAM Limited")
JOIN_WRAPPED_NAME = True    # "Nomura ... Securities (India)" + "Private Limited"
SKIP_PROSE = True           # an introductory sentence is prose, never a name / address
PIN_TOLERANT = True         # "400-051", "400 070", "1220 03", PIN after the state
LINK_CONTINUATION = True    # a wrapped website tail ("/index.html") belongs to the website value
COVER_CELLS = True          # a cover copy counts only from the same cell under the same entity's heading
CLEAN_INPUT = True          # page furniture (running heads / footers / page numbers) removed before anything else
ALIAS_ONLY_LINE = True      # a line that is only "(formerly known as ...)" is alias_continuation, never address / name
CONTACT_SPLIT = True        # a person-name line under "Contact person:" is a separate person (joined " / ") or refused

SECTION_PAGES = 15          # at most this many pages of the located section are read
COVER_PAGES = 6             # cover pages: page 1 up to the contents page, at most this many
GI = re.compile(r'^\s*' + sl.SEC_PREFIX + r'general\s+information\s*$', re.I)
TOC = re.compile(r'table\s+of\s+contents?|^\s*contents\s*$', re.I | re.M)


def contact_join(prev, line):
    """'Contact person: A B' + next line: -> (joined value, None) or (None, reason). A line after a printed separator
    or after a complete name is a NEW person (joined ' / '); a line after a one-word fragment completes that name;
    anything else is unsure -> refused."""
    p, t = prev.rstrip(), line.strip()
    nw = len(re.split(r'/|,|&|\band\b', t)[0].split())       # words of the first person on the new line
    last = re.split(r'/|,|&|\band\b', p)[-1].strip()
    if re.search(r'(?:/|,|&|\band)$', p):
        if nw >= 2:
            return re.sub(r'\s*(?:/|,|&|\band)$', '', p) + ' / ' + t, None
        return None, 'contact_split_unsure'
    if len(last.split()) == 1 and 1 <= nw <= 2:
        return p + ' ' + t, None
    if len(last.split()) >= 2 and nw >= 2:
        return p + ' / ' + t, None
    return None, 'contact_split_unsure'


# ---------------- one label dictionary ----------------
def _heading(p):
    return re.compile(r'^\s*(?:[a-z]\)\s*|\d{1,2}\.\s*)?' + p + r'\s*[:.]?\s*$', re.I)


HEADINGS = [  # (kind, whole-line pattern). Order matters: first match wins.
    ('brlm', _heading(r'(?:global\s+co-?ordinators?\s+and\s+)?(?:book\s+running\s+)?lead\s+managers?(?:\s*\(s\))?'
                      r'(?:\s+to\s+the\s+(?:offer|issue))?(?:\s+\(?brlms?\)?)?')),
    ('registrar', _heading(r'registrar\s+to\s+(?:the|our)\s+(?:offer|issue)')),
    ('cs', _heading(r'(?:company\s+secretary\s*(?:and|&)\s*compliance\s+officer|compliance\s+officer\s*(?:and|&)\s*'
                    r'company\s+secretary)(?:\s+of\s+(?:our|the)\s+company)?')),
    ('regoff', _heading(r'registered\s+(?:(?:and|&)\s+corporate\s+)?office(?:\s+(?:and|&)\s+corporate\s+office)?'
                        r'(?:\s+of\s+(?:our|the)\s+company)?')),
    ('corpoff', _heading(r'corporate\s+office(?:\s+of\s+(?:our|the)\s+company)?')),
    ('other', _heading(r'(?:legal\s+(?:counsel|advisors?)|statutory|auditors?|bankers?|banker\(s\)|syndicate|escrow|'
                       r'refund|sponsor|public\s+offer\s+account|filing|changes?\s+in|board\s+of\s+directors|the\s+'
                       r'governing\s+board|address\s+of\s+the\s+roc|registrar\s+of\s+companies|designated\s+'
                       r'intermediaries|monitoring\s+agency|credit\s+rating|ipo\s+grading|experts?|debenture|appraising|'
                       r'green\s+shoe|inter[\s-]*se|statement\s+of\s+inter|key\s+intermediaries|investor\s+grievances|'
                       r'chief\s+financial\s+officer|company\s+registration|corporate\s+identity|underwrit|self[\s-]*'
                       r'certified|registered\s+brokers?|collecting|grading|details\s+of|book\s+building|brief\s+'
                       r'description|our\s+company|chief\s+executive).{0,90}')),
]
LABELS = [  # (kind, line-start pattern) - first match wins; 'contact' before 'phone' ("Contact Person" vs "Contact:")
    ('grievance', re.compile(r'^investor\s+grievances?\s*(?:e[\s-]*mail|mail)?\s*(?:id|address)?\s*[:.]?\s*', re.I)),
    ('contact', re.compile(r'^contact\s+persons?(?![a-z])\s*[:.]?\s*', re.I)),
    ('email', re.compile(r'^e[\s-]*mail(?![a-z])\s*(?:id|address)?\s*[:.]?\s*', re.I)),
    ('website', re.compile(r'^web\s*site(?![a-z])\s*[:.]?\s*', re.I)),
    ('sebi', re.compile(r'^sebi\s+reg(?:istration|n)?\.?\s*(?:no|number)?\.?\s*[:.]?\s*', re.I)),
    ('phone', re.compile(r'^(?:tel(?:ephone)?|phone|mobile|contact)(?![a-z])\.?\s*(?:no|number)?\.?\s*[:.]?\s*', re.I)),
    ('fax', re.compile(r'^fax(?![a-z])\s*(?:no|number)?\.?\s*[:.]?\s*', re.I)),
    ('name', re.compile(r'^(?:name|name\s+of\s+the\s+(?:registrar|brlm|company))\s*:\s*', re.I)),
    ('address', re.compile(r'^(?:registered\s+(?:(?:and|&)\s+corporate\s+)?office|corporate\s+office|(?:office\s+)?'
                           r'address)(?:\s+of\s+(?:our|the)\s+company)?\s*:\s*', re.I)),
    ('ignored', re.compile(r'^(?:cin|corporate\s+identity\s+number|(?:icai\s+)?firm\s+registration|peer\s+review|'
                           r'membership\s+(?:no|number)|registration\s+(?:no|number))\b', re.I)),
]
CONTACT_KINDS = ('grievance', 'contact', 'email', 'website', 'sebi', 'phone', 'fax', 'ignored')
INLINE_LABEL = re.compile(r'\s(?:fax|e[\s-]*mail|website|tel(?:ephone)?|contact\s+person|sebi\s+reg\w*)\b\s*[:.]', re.I)
CORP = re.compile(r'\b(?:limited|ltd|llp|private|pvt|bank|advisors?|capital|securities|partners|services|technologies|'
                  r'financial|markets|company|corporation|inc|plc)\b', re.I)
CORP_WORDS = re.compile(r'\b(?:private|pvt|limited|ltd|llp|inc|plc|the|company|co)\b\.?', re.I)
ENTITY_END = re.compile(r'\b(?:limited|ltd|llp|inc|plc|pvt\.?\s*ltd)\.?$', re.I)
ALIAS = re.compile(r'\s*\((?:formerly|earlier|previously)\b[^)]*(\))?', re.I)
ALIAS_TAIL = re.compile(r"^[A-Za-z0-9 .,&'-]{0,80}\)\.?$")
MARKS = re.compile(r'^[*^†#]+\s*|\s*[*^†#]+$')
EMAIL = re.compile(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$')
SEBI = re.compile(r'\b(IN[MR]\d{9})\b')
PERSON = re.compile(r"^[A-Za-z][A-Za-z .,'/&-]{1,120}$")
HONORIFIC = re.compile(r'^(?:mr|mrs|ms|smt|shri|dr|prof|ca)\.?\s+', re.I)
FOOTER = re.compile(r'^(?:page\s*\|?\s*)?\d{1,4}(?:\s*\|\s*page)?$', re.I)
PROSE = re.compile(r':\s*$|\bas\s+follows\b|\b(?:are|is)\s+set\s+(?:out|forth)\s+below\b|\bdetails\s+of\b|\bas\s+under\b',
                   re.I)
VERB = re.compile(r'\b(?:is|are|was|were|has|have|shall|will|may|being|been)\b', re.I)
URL_TAIL = re.compile(r'^/?[A-Za-z0-9._%#?=&/-]+$')
COL_GAP_TOL = 15.0


def label_of(text):
    t = text.strip()
    for kind, rx in LABELS:
        m = rx.match(t)
        if m:
            return kind, t[m.end():].strip()
    return None, None


def heading_of(text):
    t = text.strip()
    if len(t) > 110 or not t or t[0].islower():
        return None
    for kind, rx in HEADINGS:
        if rx.match(t):
            return kind
    return None


# ---------------- normalisation + the one line classifier ----------------
def normalise(t):
    """-> (text, alias_open). Label prefix, alias, footnote marks: removed here and nowhere else."""
    t = t.strip()
    if STRIP_LABEL_PREFIX:
        k, v = label_of(t)
        if k in ('name', 'address'):
            t = v
    alias_open = False
    if STRIP_ALIAS:
        m = ALIAS.search(t)
        if m:
            alias_open = m.group(1) is None
            t = (t[:m.start()] + ' ' + t[m.end():]).strip()
    if STRIP_MARKS:
        t = MARKS.sub('', t)
    return re.sub(r'\s+', ' ', t).strip().rstrip(',;').strip(), alias_open


def is_entity(n):
    if not n or len(n.split()) > 14 or ':' in n:
        return False
    if not ENTITY_DIGITS and re.search(r'\d', n):
        return False
    return bool(ENTITY_END.search(n.rstrip('.')))


def is_prose(t):
    return bool(PROSE.search(t)) or (len(t) > 60 and bool(VERB.search(t)))


def classify(t, ctx=None):
    """-> (class, info). Classes: label | entity_name | alias_continuation | address | prose | contact |
    footnote_or_link_continuation. ctx: alias_open, last_label (kind), next (text of the next line), expect_person."""
    ctx = ctx or {}
    t = t.strip()
    if ctx.get('alias_open') and STRIP_ALIAS:
        return 'alias_continuation', {'closes': ')' in t}
    if ALIAS_ONLY_LINE and re.match(r'^\((?:formerly|earlier|previously)\b', t, re.I):
        return 'alias_continuation', {'closes': ')' in t, 'opens': ')' not in t}
    if STRIP_ALIAS and '(' not in t and ALIAS_TAIL.match(t) and len(t.split()) <= 6 and not re.search(r'\d{3}', t):
        return 'alias_continuation', {'closes': True}          # "Limited)" split into another column
    k, v = label_of(t)
    if k in CONTACT_KINDS:
        return 'label', {'kind': k, 'value': v}
    if LINK_CONTINUATION and ctx.get('last_label') == 'website' and URL_TAIL.match(t) and ('/' in t or '.htm' in t) \
            and '@' not in t:
        return 'footnote_or_link_continuation', {'link': True}
    if re.match(r'^[*^†#]+\s*\S', t) and len(t) > 40:
        return 'footnote_or_link_continuation', {'footnote': True}
    if SKIP_PROSE and is_prose(t) and k not in ('name', 'address'):
        return 'prose', {}
    n, aopen = normalise(t)
    if is_entity(n):
        return 'entity_name', {'name': n, 'alias_open': aopen}
    nxt = (ctx.get('next') or '').strip()
    # join only a wrapped TAIL ("Private Limited"): a next line with a name word of its own is a name by itself, and
    # whatever stands above it (a cover heading, a contact person) is never part of that name
    tail_only = all(w.lower().strip('.,()') in ('private', 'pvt', 'limited', 'ltd', 'llp', 'inc', 'plc', 'company',
                                                'india')
                    for w in nxt.split())
    if JOIN_WRAPPED_NAME and nxt and tail_only and len(nxt.split()) <= 4 and not label_of(nxt)[0]:
        n2, aopen2 = normalise(t + ' ' + nxt)
        if is_entity(n2) and not re.search(r'\d{3}', t):
            return 'entity_name', {'name': n2, 'alias_open': aopen2, 'join_next': True}
    if ctx.get('last_label') == 'contact' and PERSON.match(t) and not CORP.search(t) and len(t) < 40:
        return 'contact', {'continues_label': True}
    if PERSON.match(n) and not CORP.search(n) and len(n.split()) <= 5 and \
            (HONORIFIC.match(n) or ctx.get('expect_person')):
        return 'contact', {'person': n.rstrip('.,')}
    return 'address', {'text': n if k == 'address' else t.rstrip(',')}


# ---------------- format checks ----------------
def phone_numbers(v):
    out = []
    for part in re.split(r'/|,|;|\bor\b|\band\b', v or ''):
        dg = re.sub(r'\D', '', part)
        if not dg:
            continue
        if dg.startswith('91') and len(dg) >= 12:
            dg = dg[2:]
        out.append(dg.lstrip('0'))
    return out


def phone_ok(v):
    nums = phone_numbers(v)
    return bool(nums) and (len(nums[0]) == 10 or (len(nums[0]) == 11 and nums[0].startswith('1800')))


def clean_email(v):
    v = (v or '').strip().rstrip('.,;')
    return v if EMAIL.match(v) else None


def name_key(n):
    n = re.sub(r'\([^)]*\)?', ' ', n or '')
    n = CORP_WORDS.sub(' ', n.lower())
    return re.sub(r'[^a-z0-9]', '', n)


def person_key(n):
    return re.sub(r'[^a-z]', '', HONORIFIC.sub('', (n or '').strip()).lower())


def pins(text):
    """6-digit Indian PINs in an address: '400 051', '400-051', '400051', '1220 03' (4+2), after the state too."""
    if not PIN_TOLERANT:
        return [a + b for a, b in re.findall(r'\b(\d{3})\s?(\d{3})\b', text)]
    out = [a + b for a, b in re.findall(r'(?<![A-Za-z0-9])(\d{3})[\s-]?(\d{3})(?![\d])', text)]
    out += [a + b for a, b in re.findall(r'(?<![A-Za-z0-9])(\d{4})\s(\d{2})(?![\d])', text)]
    return [p for p in out if p[0] in '12345678']


# ---------------- word positions -> bands -> columns -> blocks ----------------
def page_lines(pw):
    return [ln['w'] for ln in sg.lines_of(pw['words']) if not FOOTER.match(ln['text'].strip())]


def bands(words):
    out, cur = [], dict(kind='lead', lines=[])
    for pg in sorted(words, key=int):
        for ws in page_lines(words[pg]):
            kind = heading_of(' '.join(w['text'] for w in ws))
            if kind:
                out.append(cur)
                cur = dict(kind=kind, lines=[], head=' '.join(w['text'] for w in ws), page=int(pg))
                continue
            cur['lines'].append((int(pg), ws))
    out.append(cur)
    return [b for b in out if b['lines']]


def columns(band):
    xs = []
    for _, ws in band['lines']:
        for i, w in enumerate(ws):
            if i and w['x0'] - ws[i - 1]['x1'] <= 10.0:
                continue
            k, _ = label_of(' '.join(x['text'] for x in ws[i:i + 4]))
            if k in ('email', 'grievance', 'contact', 'sebi', 'phone', 'website'):
                xs.append(w['x0'])
    xs.sort()
    clusters = []
    for x in xs:
        if clusters and x - clusters[-1][-1] <= COL_GAP_TOL:
            clusters[-1].append(x)
        else:
            clusters.append([x])
    return [min(c) for c in clusters if len(c) >= 2] or [0.0]


def column_streams(band):
    starts = columns(band)
    streams = [[] for _ in starts]
    for pg, ws in band['lines']:
        parts = [[] for _ in starts]
        alias_words = set()
        if STRIP_ALIAS:   # an alias "(formerly ... Limited)" stays in the column of its "(" even if it runs across
            i = next((j for j, w in enumerate(ws) if re.match(r'\((?:formerly|earlier|previously)', w['text'], re.I)),
                     None)
            if i is not None:
                j = next((j for j in range(i, len(ws)) if ')' in ws[j]['text']), len(ws) - 1)
                alias_words = set(range(i, j + 1))
        home = None
        for j, w in enumerate(ws):
            k = max([i for i, s in enumerate(starts) if w['x0'] >= s - 8] or [0])
            if j in alias_words:
                home = k if home is None else home
                k = home
            parts[k].append((j, w))
        overrun = set()
        for k in range(len(starts) - 1):
            own = [w for j, w in parts[k] if j not in alias_words]
            if own and max(w['x1'] for w in own) > starts[k + 1] - 2:
                overrun |= {k, k + 1}
        for k, p in enumerate(parts):
            if p:
                streams[k].append(dict(page=pg, text=' '.join(w['text'] for _, w in p), overrun=k in overrun))
    return starts, streams


GRAMMAR = {  # block shape over line classes: p prose/footnote, c person, e entity name, a address
    'firm': re.compile(r'^p*ea*p*$'),
    'cs': re.compile(r'^p*c?e?a*p*$'),
    'office': re.compile(r'^p*e?a*p*$'),
}
CODE = {'prose': 'p', 'footnote_or_link_continuation': 'p', 'contact': 'c', 'entity_name': 'e', 'address': 'a'}


def blocks(stream, band_kind='firm'):
    """one grammar for every block: [prose] [person] entity name (+ alias / wrapped tail) -> address -> labels."""
    out, cur, pending, last_label, alias_open, force = [], None, None, None, False, None

    def new(ln):
        b = dict(lines=[], labels=[], page=ln['page'])
        out.append(b)
        return b
    for idx, ln in enumerate(stream):
        t = ln['text'].strip()
        if pending is not None and not label_of(t)[0]:
            pending['value'] = t
            pending['overrun'] |= ln['overrun']
            pending = None
            continue
        pending = None
        if force:
            cls, info = force, {}
            force = None
        elif ln['overrun']:   # words crossing the column cut: full-width text split by the cut, never a cell's line
            cls, info = 'footnote_or_link_continuation', {'footnote': True, 'overrun': True}
        else:
            ctx = dict(alias_open=alias_open, last_label=last_label['kind'] if last_label else None,
                       next=stream[idx + 1]['text'] if idx + 1 < len(stream) else '',
                       expect_person=band_kind == 'cs' and not out or (
                           band_kind == 'cs' and cur is not None and cur is out[0] and not cur['labels']
                           and not any(x['cls'] in ('contact', 'entity_name', 'address') for x in cur['lines'])))
            cls, info = classify(t, ctx)
        if cls == 'alias_continuation':
            alias_open = bool(info.get('opens')) or (alias_open and not info.get('closes', True))
            if cur is not None:
                cur['lines'].append(dict(text=t, cls=cls, overrun=ln['overrun']))
            continue
        alias_open = False
        if cls == 'label':
            if cur is None:
                cur = new(ln)
            v = info['value']
            m = INLINE_LABEL.search(' ' + v)
            if m and info['kind'] != 'website':
                v = (' ' + v)[:m.start()].strip()
            lab = dict(kind=info['kind'], value=v, page=ln['page'], overrun=ln['overrun'])
            cur['labels'].append(lab)
            pending = lab if not v else None
            last_label = lab
            continue
        if cls == 'footnote_or_link_continuation' and info.get('link') and last_label is not None:
            last_label['value'] += t
            continue
        if cls == 'contact' and info.get('continues_label') and last_label is not None:
            if not CONTACT_SPLIT:
                last_label['value'] += ' ' + t
            elif not last_label.get('refused'):
                v, why = contact_join(last_label['value'], t)
                if why:
                    last_label['refused'] = why
                else:
                    last_label['value'] = v
            continue
        last_label = None if cls != 'footnote_or_link_continuation' else last_label
        if cls in ('prose', 'footnote_or_link_continuation'):
            if cur is not None and (cur['labels'] or any(x['cls'] == 'address' for x in cur['lines'])):
                cur = None                       # a sentence after the address / contacts ends the block
            if cur is None:
                cur = new(ln)
            cur['lines'].append(dict(text=t, cls=cls, overrun=ln['overrun']))
            continue
        seq = ''.join(CODE[x['cls']] for x in cur['lines'] if x['cls'] in CODE) if cur else ''
        if cls == 'entity_name':
            starts_new = cur is None or cur['labels'] or 'a' in seq or (
                'e' in seq and not (band_kind == 'cs' and seq.endswith('c')))
        else:
            starts_new = cur is None or bool(cur['labels'])
        if starts_new:
            cur = new(ln)
        cur['lines'].append(dict(text=t, cls=cls, overrun=ln['overrun'],
                                 **{k: v for k, v in info.items() if k in ('name', 'person')}))
        if cls == 'entity_name':
            alias_open = info.get('alias_open', False)
            if info.get('join_next'):
                force = 'alias_continuation'
    for b in out:
        b['seq'] = ''.join(CODE[x['cls']] for x in b['lines'] if x['cls'] in CODE)
    return out


def block_shape(b, kind):
    """None when the block follows the grammar of its kind, else the refusal reason."""
    if not GRAMMAR[kind].match(b['seq']):
        return "block_out_of_order:%s" % b['seq']
    return None


def entity_of(b):
    """the block's entity name (the name reader): the normalised entity line, never any other class."""
    e = [x for x in b['lines'] if x['cls'] == 'entity_name']
    return e[0]['name'] if e else None


def address_of(b):
    """the address reader: the block's address lines (after the entity), ended by prose; same classes as entity_of.
    Company address is PARKED: this reader is kept for the block-level class tests only."""
    out, started = [], False
    for x in b['lines']:
        if x['cls'] == 'address':
            out.append(x['text'].rstrip(','))
            started = True
        elif x['cls'] in ('prose', 'footnote_or_link_continuation') and started:
            break
    return out


# ---------------- per-block values with format checks ----------------
def block_values(b, log, where):
    vals, bad = {}, set()
    for lab in b['labels']:
        k, v = lab['kind'], lab['value'].strip()
        if k in ('fax', 'ignored') or not v:
            continue
        if lab.get('refused'):
            log.append("%s %s: refused %s (%s)" % (where, k, lab['refused'], v[:40]))
            bad.add(k)
            continue
        if lab['overrun']:
            log.append('%s %s: refused column_overrun (%s)' % (where, k, v[:40]))
            bad.add(k)
            continue
        if k in ('email', 'grievance'):
            e = clean_email(v.split()[0] if v.split() else v)
            if not e or len(v.split()) > 1:
                log.append('%s %s: refused not_one_email (%s)' % (where, k, v[:50]))
                bad.add(k)
                continue
            v = e
        elif k == 'phone':
            if not phone_ok(v):
                log.append('%s phone: refused phone_format (%s)' % (where, v[:40]))
                bad.add(k)
                continue
            v = v.rstrip('.,;')
        elif k == 'sebi':
            m = SEBI.findall(v.replace(' ', ''))
            if len(m) != 1:
                log.append('%s sebi: refused sebi_format (%s)' % (where, v[:40]))
                bad.add(k)
                continue
            v = m[0]
        elif k == 'contact':
            v = v.rstrip('.,;')
            if not PERSON.match(v) or CORP.search(v):
                log.append('%s contact: refused person_format (%s)' % (where, v[:50]))
                bad.add(k)
                continue
        elif k == 'website':
            v = v.rstrip(',;').strip()
            if ' ' in v or not re.match(r'^(?:https?://)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:/\S*)?$', v, re.I):
                log.append('%s website: refused url_format (%s)' % (where, v[:50]))
                bad.add(k)
                continue
        if k in vals and vals[k] != v and not (k == 'phone' and phone_numbers(vals[k])[:1] == phone_numbers(v)[:1]):
            log.append('%s %s: refused two_values_in_block (%s vs %s)' % (where, k, vals[k], v))
            bad.add(k)
            continue
        vals[k] = v
    for k in bad:
        vals.pop(k, None)
    return vals


# ---------------- cover copies: same column cell, same entity heading ----------------
def cover_cells(cover_words):
    cells = []
    for pg in sorted(cover_words, key=int):
        band = dict(kind='firm', lines=[(int(pg), ws) for ws in page_lines(cover_words[pg])])
        _, streams = column_streams(band)
        for s in streams:
            for b in blocks(s, 'firm'):
                cells.append(dict(name=entity_of(b), shape_ok=block_shape(b, 'firm') is None, block=b, page=int(pg)))
    return cells


def cover_copies(cells, entity, kind):
    """values of one label kind printed in a cover cell headed by `entity` (normalised name equal); anything else is
    'no copy'. Without COVER_CELLS every cover cell counts (the mutation)."""
    out = []
    for c in cells:
        if COVER_CELLS and not (c['shape_ok'] and c['name'] and name_key(c['name']) == name_key(entity)):
            continue
        out += [v for k, v in block_values(c['block'], [], 'cover').items() if k == kind]
    return out


def compare_copies(fk, value, copies, ok, same, log):
    """OD-177: a printed copy failing its own format check is not a copy; F-248: copies that disagree -> refused."""
    usable = [c for c in copies if ok(c)]
    diff = sorted({c for c in usable if not same(c, value)})
    if diff:
        log.append('%s: refused copies_disagree GI=%s cover=%s (F-248)' % (fk, value, diff))
        return None
    return value


def same_mail(a, b):
    return a.lower().rstrip('.') == b.lower().rstrip('.')


# ---------------- locating + loading the pages ----------------
def locate_section(page_texts):
    """the General Information section from the printed contents page -> {title, printed, idx, end, verified} or
    {reason}."""
    pages = [(n, t or '') for n, t in page_texts]
    by = dict(pages)
    loc = sl.locate(pages)
    off = loc['offset']
    entries = [e for n in loc['toc_pages'] for e in sl.toc_entries(by[n])]
    starts = sorted({p for _, p in entries})
    for title, printed in entries:
        if GI.match(title) and off is not None:
            nxt = [p for p in starts if p > printed]
            idx, end = printed + off, (nxt[0] + off if nxt else printed + off + 1)
            top = ' '.join(by.get(idx, '').split('\n')[:10]).lower()
            return dict(title=title, printed=printed, idx=idx, end=end, verified='general information' in top)
    return dict(reason='general_information_not_in_contents')


def cover_page_indices(page_texts):
    """page 1 up to (not including) the contents page, at most COVER_PAGES pages."""
    by = {i: t or '' for i, t in page_texts}
    want = []
    for i in range(0, COVER_PAGES):
        if i and TOC.search(by.get(i, '')):
            break
        want.append(i)
    return want


def _pages(indices, grid_words_for_page, model, log, what):
    """{idx: furniture-cleaned grid page}; None when a page has no word positions."""
    out = {}
    for i in indices:
        pw = grid_words_for_page(i)
        if pw is None:
            log.append('%s p%d: no word positions' % (what, i))
            return None
        if model is not None:
            pw, _n = page_furniture.clean_grid_page(model, pw, i)
        out[i] = pw
    return out


def read_general_information(page_texts, grid_words_for_page, ocr_pages=()):
    """-> {section, fields, log, reason}. `fields` holds lead_managers (only when every BRLM block was read and named
    on the cover), brlm_rows (one per BRLM block read) and registrar (its grievance e-mail checked against the cover
    cell copies); `reason` is set when nothing could be read."""
    page_texts = [(i, t or '') for i, t in page_texts]
    log, f = [], {}
    out = dict(section=None, fields=f, log=log, reason=None)
    if grid_words_for_page is None:
        out['reason'] = 'general_information_no_word_positions'
        return out
    sec = locate_section(page_texts)
    out['section'] = sec
    if 'idx' not in sec:
        out['reason'] = sec['reason']
        return out
    want = list(range(sec['idx'], min(sec['end'], sec['idx'] + SECTION_PAGES)))
    ocr = sorted(set(want) & {int(p) for p in ocr_pages or ()})
    if ocr:
        out['reason'] = 'general_information_page_is_ocr: %s' % ocr
        return out
    model = page_furniture.model_for(page_texts) if CLEAN_INPUT else None
    words = _pages(want, grid_words_for_page, model, log, 'section')
    if words is None:
        out['reason'] = 'general_information_no_word_positions'
        return out
    cover = _pages(cover_page_indices(page_texts), grid_words_for_page, model, log, 'cover') or {}
    bs = bands(words)
    for b in bs:
        kind = {'cs': 'cs', 'regoff': 'office', 'corpoff': 'office'}.get(b['kind'], 'firm')
        _starts, streams = column_streams(b)
        b['blocks'] = [bl for s in streams for bl in blocks(s, kind)]
    cells = cover_cells(cover)
    cover_names = {name_key(c['name']) for c in cells if c['name'] and c['shape_ok']}
    by = dict(page_texts)
    ct = '\n'.join(by.get(i, '') for i in range(0, 4)).lower()
    cover_key = re.sub(r'[^a-z0-9]', '', CORP_WORDS.sub(' ', ct))
    cover_toks = set(re.findall(r'[a-z0-9&]+', ct))

    # ---- lead managers ----
    lm, rows = [], []
    brlm_blocks = [bl for b in bs if b['kind'] == 'brlm' for bl in b['blocks']]
    lm_ok = bool(brlm_blocks)
    for bl in brlm_blocks:
        name = entity_of(bl)
        bad = block_shape(bl, 'firm')
        if not bl['labels'] and (bad or not name):
            continue                                     # prose / footnote / split fragments with no contact values
        if bad or not name:
            log.append("brlm block p%d: refused %s" % (bl['page'], bad or 'no_entity_name'))
            lm_ok = False
            continue
        if any(x['overrun'] for x in bl['lines'] if x['cls'] == 'entity_name'):
            log.append("brlm[%s]: refused heading_column_overrun" % name[:30])
            lm_ok = False
            continue
        v = block_values(bl, log, 'brlm[%s]' % name[:30])
        if v.get('sebi', '').startswith('INR'):
            log.append('brlm[%s]: not a BRLM (INR registration under the BRLM heading)' % name[:30])
            continue
        toks = [w for w in re.findall(r'[a-z0-9&]+', re.sub(r'\([^)]*\)', ' ', name.lower()))
                if not CORP_WORDS.fullmatch(w)]
        on_cover = name_key(name) in cover_names or name_key(name) in cover_key or \
            (v.get('sebi', '').startswith('INM') and bool(toks) and all(t in cover_toks for t in toks))
        if not (v.get('sebi', '').startswith('INM') or on_cover):
            log.append('brlm[%s]: refused not_a_named_brlm' % name[:30])
            lm_ok = False
            continue
        if not on_cover:
            log.append('brlm[%s]: cover copy not found' % name[:30])
            lm_ok = False
        lm.append(name)
        rows.append(dict(name=name, sebi_reg_no=v.get('sebi'), contact_person=v.get('contact'),
                         phone=v.get('phone'), email=v.get('email'), grievance_email=v.get('grievance'),
                         page=bl['page']))
    if lm and lm_ok and len({name_key(n) for n in lm}) == len(lm):
        f['lead_managers'] = lm
    elif brlm_blocks:
        log.append('lead_managers: refused (a BRLM block unread or not confirmed by the cover)')
    f['brlm_rows'] = rows

    # ---- registrar (only its grievance e-mail is read from here; the rest stays on today's reader) ----
    reg_blocks = [bl for b in bs if b['kind'] == 'registrar' for bl in b['blocks'] if entity_of(bl) or bl['labels']]
    if len(reg_blocks) == 1 and entity_of(reg_blocks[0]) and not block_shape(reg_blocks[0], 'firm'):
        bl = reg_blocks[0]
        name = entity_of(bl)
        v = block_values(bl, log, 'registrar')
        if v.get('sebi', 'INR').startswith('INR'):
            reg = dict(name=name, grievance_email=v.get('grievance'), page=bl['page'])
            if reg['grievance_email']:
                reg['grievance_email'] = compare_copies(
                    'registrar.grievance_email', reg['grievance_email'], cover_copies(cells, name, 'grievance'),
                    lambda e: bool(EMAIL.match(e)), same_mail, log)
            f['registrar'] = reg
        else:
            log.append('registrar: refused (%s sebi=%s)' % (name[:40], v.get('sebi')))
    elif reg_blocks:
        log.append('registrar: refused blocks=%s' % [(entity_of(b), b['seq']) for b in reg_blocks])
    return out
