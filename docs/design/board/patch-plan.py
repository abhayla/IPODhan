"""Re-render the "Where the stage stands" status section into a saved copy of
the board artifact's index.html.

Usage:
    python docs/design/board/patch-plan.py --html <saved index.html> [--out <path>]
                                           [--status <status.json>] [--fixes <body-fixes.json>]

--out defaults to "<html>.patched.html"; --status and --fixes default to the
files next to this script. No session scratchpad paths are hard-coded: pass the
copy of index.html that `Artifact read_file` saved for you.

The rendering logic below is the one that produced the live board; only the
path handling changed.
"""
import argparse
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--html', required=True, help='saved copy of the board artifact index.html')
parser.add_argument('--out', default=None, help='output path (default: <html>.patched.html)')
parser.add_argument('--status', default=os.path.join(HERE, 'status.json'))
parser.add_argument('--fixes', default=os.path.join(HERE, 'body-fixes.json'))
args = parser.parse_args()

out_path = args.out or (args.html + '.patched.html')

src = open(args.html, encoding='utf-8').read()
m = re.search(r'<title>.*</html>', src, re.S)
page = m.group(0).replace('</body></html>', '').replace('</html>', '')
# drop the existing status section (re-rendered below)
page, n = re.subn(r'\n?<section class="status" id="status">.*?</section>\n?', '\n', page, count=1, flags=re.S)
assert n == 1, 'existing status section not found'
rows = json.load(open(args.status, encoding='utf-8'))
cls = {'landed': 'landed', 'merged': 'merged', 'building': 'building', 'review': 'building', 'red': 'red', 'queued': ''}
bar = ''.join('<span class="%s"></span>' % cls[r['state']] for r in rows['slices'] if r['id'] not in ('STEP 1', 'Swap Test'))
def pill(r):
    c = cls[r['state']] or 'queued'
    return '<span class="pill %s">%s</span>' % (c, r['status'])
def tier(t):
    return '&mdash;' if t == '-' else '<span class="tier %s">%s</span>' % (t, t)
trs = ''.join(
    '<tr><td class="s">%s</td><td>%s</td><td>%s</td><td class="mono">%s</td><td class="mono">%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>'
    % (r['id'], r['what'], tier(r['tier']), r['pr'] or '&mdash;', r['sha'] or '&mdash;', r['review'], r['proof'], r['gate'] or '&mdash;', pill(r))
    for r in rows['slices'])
now = ''.join('<div><span class="k">%s</span>%s</div>' % (k, v) for k, v in rows['now'].items())
status = f'''
<section class="status" id="status">
 <div class="hd"><h2>Where the stage stands</h2><span class="stamp">updated {rows['stamp']}</span></div>
 <div class="bar" aria-hidden="true">{bar}</div>
 <div class="legend"><span><i style="background:var(--ok)"></i>landed (merged + staging proof + gate PASS)</span><span><i style="background:var(--warn)"></i>merged, proof owed</span><span><i style="background:var(--accent)"></i>building or in review</span><span><i></i>queued</span><span><i style="background:var(--bad)"></i>red, being fixed</span></div>
 <div class="now">{now}</div>
 <div class="wrap"><table>
 <thead><tr><th>Slice</th><th>What it lands</th><th>Tier</th><th>PR</th><th>Merged sha</th><th>Review</th><th>Staging proof</th><th>Gate</th><th>Status</th></tr></thead>
 <tbody>{trs}</tbody></table></div>
 <p class="rule">Landed = merged on main + staging proof read by identity + <code>check-stage3-dod.mjs</code> all PASS. This table is rewritten at every landing, the same step as the ledger row and the board; the stamp is the last rewrite.</p>
</section>
'''
anchor = '<h2>1. What "customizable" means, and how it is tested</h2>'
assert anchor in page
page = page.replace(anchor, status + '\n' + anchor, 1)
# body fixes (owner asked 2026-09-17 16:4x whether the page is fully updated): apply once, idempotent
fixes = json.load(open(args.fixes, encoding='utf-8'))
for old, new in fixes:
    if old in page:
        page = page.replace(old, new, 1)
    else:
        assert new in page, 'fix neither applied nor present: ' + old[:60]
open(out_path, 'w', encoding='utf-8').write(page)
print('written', out_path, len(page), 'bytes; rows', len(rows['slices']))
