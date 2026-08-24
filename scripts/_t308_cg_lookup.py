import json, re, time, urllib.request, sys, os, tempfile
from datetime import datetime, timedelta

TMP = tempfile.gettempdir()

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    'Referer': 'https://www.chittorgarh.com/',
    'Accept': 'application/json',
}

def fetch_json(url, retries=2):
    for i in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode('utf-8', errors='replace'))
        except Exception as e:
            if i == retries:
                return {'error': str(e)}
            time.sleep(2)

def normalize(name):
    n = name.lower()
    n = re.sub(r'\.(com)?ipo$', '', n)
    n = re.sub(r'\bltd\.?\b|\blimited\b|\bpvt\.?\b|\bprivate\b|\btrust\b|\binvit\b', '', n)
    n = re.sub(r'[^a-z0-9]+', ' ', n).strip()
    return n

def ist_date(iso_str):
    # DB stores naive-UTC wall clock (utc-naive-timestamp-normalization.md);
    # the true IST calendar date is UTC date + 1 day for these 18:30 timestamps.
    if not iso_str:
        return None
    d = datetime.fromisoformat(iso_str.replace('Z', '+00:00')).date()
    return d + timedelta(days=1)

# targets: DB rows (slug, company_name, listing_date)
with open(os.path.join(TMP, 'target_db_rows.json')) as f:
    db_rows = json.load(f)

targets = {r['slug']: r for r in db_rows}
target_norm = {normalize(r['company_name']): slug for slug, r in targets.items()}
target_listing = {slug: ist_date(r.get('listing_date')) for slug, r in targets.items()}

lookup = {}
pages_seen = 0
FISCAL_YEARS = [(2026, '2026-27'), (2025, '2025-26')]
for year, yrange in FISCAL_YEARS:
  for cat in ('mainboard', 'sme'):
    for page in range(1, 26):
        if len(lookup) >= len(targets):
            break
        url = f"https://webnodejs.chittorgarh.com/cloud/report/data-read/82/{page}/10/{year}/{yrange}/0/{cat}/0?search=&v=15-11"
        data = fetch_json(url)
        pages_seen += 1
        rows = data.get('reportTableData') if isinstance(data, dict) else None
        if not rows:
            time.sleep(2)
            continue
        for row in rows:
            company_html = row.get('Company', '')
            m = re.search(r'href="https://www\.chittorgarh\.com/ipo/([a-z0-9-]+)/(\d+)/"', company_html)
            name_m = re.search(r'>([^<]+)</a>', company_html)
            if not m or not name_m:
                continue
            cg_slug, cg_id = m.group(1), m.group(2)
            company_name = name_m.group(1).strip()
            norm = normalize(company_name)
            hit = target_norm.get(norm)
            if not hit:
                # fuzzy fallback, gated by listing-date agreement (from ~ListingDate,
                # a real ISO string) to avoid word-collision false positives.
                cg_listing_raw = row.get('~ListingDate')
                cg_listing = None
                if cg_listing_raw:
                    try:
                        cg_listing = datetime.fromisoformat(cg_listing_raw.replace('Z', '+00:00')).date()
                    except ValueError:
                        cg_listing = None
                for tn, tslug in target_norm.items():
                    words = [w for w in tn.split() if len(w) > 2]
                    if len(words) < 2 or not all(w in norm for w in words):
                        continue
                    tl = target_listing.get(tslug)
                    if cg_listing and tl and cg_listing == tl:
                        hit = tslug
                        break
            if hit and hit not in lookup:
                lookup[hit] = {
                    'company_name': company_name,
                    'cg_slug': cg_slug,
                    'cg_id': cg_id,
                    'detail_url': f"https://www.chittorgarh.com/ipo/{cg_slug}/{cg_id}/",
                }
        time.sleep(2)
    if len(lookup) >= len(targets):
        break

print(f"pages_fetched={pages_seen} matched={len(lookup)}/{len(targets)}", file=sys.stderr)
unmatched = [t for t in targets if t not in lookup]
print(f"unmatched={unmatched}", file=sys.stderr)

with open(os.path.join(TMP, 'cg_lookup.json'), 'w') as f:
    json.dump(lookup, f, indent=2)
