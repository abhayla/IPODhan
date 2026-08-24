import json, re, time, urllib.request, os, tempfile

TMP = tempfile.gettempdir()
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

lookup = json.load(open(os.path.join(TMP, 'cg_lookup.json')))
outdir = os.path.join(TMP, 't308_cg_pages')
os.makedirs(outdir, exist_ok=True)

results = {}
for slug, info in lookup.items():
    url = info['detail_url']
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=20) as r:
            html = r.read().decode('utf-8', errors='replace')
    except Exception as e:
        results[slug] = {'error': str(e)}
        time.sleep(2)
        continue

    fname = os.path.join(outdir, f"{slug}.html")
    with open(fname, 'w', encoding='utf-8') as f:
        f.write(html)

    # Chittorgarh detail pages are Next.js RSC payloads: the rupee entity is
    # escaped as &#8377; (JSON-encoded "&#8377;") rather than a literal &.
    RUPEE = r'(?:\\u0026#8377;|&#8377;|₹|Rs\.?)'
    m = re.search(r'Price\s*Band[^0-9]{0,80}' + RUPEE + r'\s*([\d.]+)\s*to\s*' + RUPEE + r'\s*([\d.]+)', html, re.IGNORECASE)
    if not m:
        # fixed-price form: "Issue Price ... Rs. X per share" with no band
        m2 = re.search(r'Issue\s*Price[^0-9]{0,80}' + RUPEE + r'\s*([\d.]+)', html, re.IGNORECASE)
        results[slug] = {
            'band': None,
            'issue_price': m2.group(1) if m2 else None,
            'file': fname,
        }
    else:
        results[slug] = {
            'band': [float(m.group(1)), float(m.group(2))],
            'file': fname,
        }
    time.sleep(2)

with open(os.path.join(TMP, 'cg_bands.json'), 'w') as f:
    json.dump(results, f, indent=2)

print(f"done: {len(results)} fetched")
