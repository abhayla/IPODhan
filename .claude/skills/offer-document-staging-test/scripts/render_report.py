"""Render the offer-document test report page from one round's data files (never hand-edited).

Usage: python render_report.py <out.html> <doc-label>=<truth.json>,<causes.json>,<compare.json> ...
Every number on the page is counted from the files; the stamp is read from the clock.
"""
import datetime
import html
import json
import sys

CAUSES = {
    "RC4": ("F-241", "Read and saved, but the document's own record covers only 2 of 14 tables"),
    "RC1": ("F-242", "Reader exists but runs only for price band adverts"),
    "RC3": ("F-243", "Multi-column cover breaks the lead-manager and registrar readers"),
    "RC2": ("F-244", "'DRHP has no price band' rule also blanks price-independent facts"),
    "RC6": ("F-245 / F-246", "Read, but written to the wrong row or column (filing date, issuer contact, name, exchanges)"),
    "RC7": ("F-246", "No reader anywhere"),
    "RC5": ("not registered", "Reader ran and failed (objects of the offer, EPS series): under review"),
    "RC2b": ("not registered", "Listing sentence read but not claimed (branch unverified)"),
}
STATUS_ORDER = ["CORRECT", "WRONG", "MISSED", "NOT PRINTED"]


def load(spec):
    label, paths = spec.split("=", 1)
    truth_p, causes_p, compare_p = paths.split(",")
    truth = {x["key"]: x for x in json.load(open(truth_p, encoding="utf8"))}
    causes = {x["key"]: x for x in json.load(open(causes_p, encoding="utf8"))}
    compare = json.load(open(compare_p, encoding="utf8"))
    rows = []
    for key, status, cause, pages, printed in compare:
        c = causes.get(key)
        rc = c["root_cause"] if c else ""
        rows.append({
            "key": key, "table": key.split(".")[0], "status": status,
            "pages": pages, "printed": "" if printed in ("None", None) else printed,
            "finding": CAUSES.get(rc, ("", ""))[0] if c else "",
            "cause": CAUSES.get(rc, ("", ""))[1] if c else ("" if status != "CORRECT" else ""),
            "where": c["location"][:140] if c else "",
            "note": (truth.get(key) or {}).get("note") or "",
        })
    return label, rows


def esc(s):
    return html.escape(str(s), quote=True)


def render(docs):
    stamp = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5, minutes=30))).strftime("%Y-%m-%d %H:%M IST")
    sections = []
    for label, rows in docs:
        counts = {s: sum(1 for r in rows if r["status"] == s) for s in STATUS_ORDER}
        printed = len(rows) - counts["NOT PRINTED"]
        by_cause = {}
        for r in rows:
            if r["status"] == "MISSED":
                k = (r["finding"], r["cause"])
                by_cause[k] = by_cause.get(k, 0) + 1
        cause_rows = "".join(
            f'<tr><td class="num">{n}</td><td>{esc(c)}</td><td class="fid">{esc(f)}</td></tr>'
            for (f, c), n in sorted(by_cause.items(), key=lambda kv: -kv[1]))
        field_rows = "".join(
            f'<tr data-s="{esc(r["status"])}"><td class="mono">{esc(r["key"])}</td>'
            f'<td><span class="pill p-{esc(r["status"].replace(" ", "-").lower())}">{esc(r["status"].lower())}</span></td>'
            f'<td class="num">{esc(", ".join(str(p) for p in r["pages"]))}</td>'
            f'<td class="val">{esc(r["printed"])}</td>'
            f'<td>{esc(r["cause"])}{"<br><span class=fid>" + esc(r["finding"]) + "</span>" if r["finding"] else ""}</td></tr>'
            for r in rows)
        sections.append(f"""
<section class="doc">
  <h2>{esc(label)}</h2>
  <p class="lede">Of the <b>{printed}</b> fields this document prints, staging saved <b>{counts['CORRECT'] + counts['WRONG']}</b> from it.
  {counts['NOT PRINTED']} of the {len(rows)} fields are not printed in this document type.</p>
  <div class="tiles">
    <div class="tile ok"><span class="n">{counts['CORRECT']}</span><span class="l">correct</span></div>
    <div class="tile warn"><span class="n">{counts['WRONG']}</span><span class="l">wrong</span></div>
    <div class="tile bad"><span class="n">{counts['MISSED']}</span><span class="l">missed</span></div>
    <div class="tile mute"><span class="n">{counts['NOT PRINTED']}</span><span class="l">not printed</span></div>
  </div>
  <h3>Why fields were missed</h3>
  <div class="scroll"><table class="causes"><thead><tr><th>Fields</th><th>Cause</th><th>Finding</th></tr></thead><tbody>{cause_rows}</tbody></table></div>
  <h3>Every field</h3>
  <div class="filters" role="group" aria-label="Filter by status">
    <button type="button" class="f on" data-f="all">All {len(rows)}</button>
    {''.join(f'<button type="button" class="f" data-f="{s}">{s.lower()} {counts[s]}</button>' for s in STATUS_ORDER)}
  </div>
  <div class="scroll"><table class="fields"><thead><tr><th>Field</th><th>Status</th><th>Page</th><th>Value in the document</th><th>Cause</th></tr></thead>
  <tbody>{field_rows}</tbody></table></div>
</section>""")
    return TEMPLATE.replace("{{SECTIONS}}", "".join(sections)).replace("{{STAMP}}", stamp)


TEMPLATE = """<title>Offer Document Test</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Mono:wght@400&family=Fraunces:opsz,wght@9..144,600&display=swap">
<style>
/* Layout: one column per document round; summary first, causes, then the full field ledger */
:root{--bg:#f6f7f4;--fg:#1d2420;--muted:#5d665f;--line:#d9ddd5;--card:#ffffff;--accent:#1f6f5c;
--ok:#1f7a4d;--okbg:#e2f2e8;--warn:#9a6400;--warnbg:#fbefd6;--bad:#b23a2e;--badbg:#f8e1dd;--mutebg:#eceee9;
--display:'Fraunces',Georgia,serif;--body:'IBM Plex Sans',system-ui,sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141816;--fg:#e4e8e3;--muted:#9aa49c;--line:#2c332e;--card:#1b201d;--accent:#5cc3a5;
--ok:#6fd39c;--okbg:#17301f;--warn:#e7b65a;--warnbg:#33290f;--bad:#f08a7d;--badbg:#3a1c18;--mutebg:#222824;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#141816;--fg:#e4e8e3;--muted:#9aa49c;--line:#2c332e;--card:#1b201d;--accent:#5cc3a5;
--ok:#6fd39c;--okbg:#17301f;--warn:#e7b65a;--warnbg:#33290f;--bad:#f08a7d;--badbg:#3a1c18;--mutebg:#222824;color-scheme:dark}
body{background:var(--bg);color:var(--fg);font:15px/1.55 var(--body)}
.wrap{max-width:1100px;margin:0 auto;padding-inline:16px;padding-block:28px 48px;display:grid;gap:28px}
header h1{font:600 clamp(26px,4vw,38px)/1.15 var(--display);margin:0;text-wrap:balance}
header p{margin:6px 0 0;color:var(--muted);max-width:68ch}
.meta{font:12px var(--mono);color:var(--muted);letter-spacing:.02em}
h2{font:600 22px/1.2 var(--display);margin:0}
h3{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:22px 0 8px}
.doc{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:20px;min-width:0}
.lede{max-width:70ch}
.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
@media (max-width:520px){.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
.tile{border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;background:var(--mutebg)}
.tile .n{font:600 28px/1 var(--display);font-variant-numeric:tabular-nums}
.tile .l{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-top:4px}
.tile.ok{background:var(--okbg)}.tile.ok .n{color:var(--ok)}
.tile.warn{background:var(--warnbg)}.tile.warn .n{color:var(--warn)}
.tile.bad{background:var(--badbg)}.tile.bad .n{color:var(--bad)}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th{text-align:left;font-weight:600;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line);padding:6px 8px}
td{border-bottom:1px solid var(--line);padding:6px 8px;vertical-align:top}
.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.mono{font:12.5px var(--mono);white-space:nowrap}
.val{max-width:28ch;word-break:break-word}
.fid{font:12px var(--mono);color:var(--accent)}
.pill{display:inline-block;border-radius:99px;padding:1px 9px;font-size:12px;white-space:nowrap;background:var(--mutebg);color:var(--muted)}
.p-correct{background:var(--okbg);color:var(--ok)}.p-wrong{background:var(--warnbg);color:var(--warn)}.p-missed{background:var(--badbg);color:var(--bad)}
.filters{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.f{font:13px var(--body);border:1px solid var(--line);background:transparent;color:var(--fg);border-radius:99px;padding:3px 12px;cursor:pointer}
.f.on{background:var(--accent);border-color:var(--accent);color:var(--bg)}
.f:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
</style>
<div class="wrap">
<header>
  <h1>Offer Document Test</h1>
  <p>What staging saved from each offer document, field by field, against what the document actually prints. One document at a time, in filing order. A field counts as extracted only when staging saved it from that document.</p>
  <p class="meta">Generated {{STAMP}} from the round's data files (skill offer-document-staging-test). Staging only.</p>
</header>
{{SECTIONS}}
</div>
<script>
document.querySelectorAll('.doc').forEach(function(sec){
  sec.querySelectorAll('.f').forEach(function(b){
    b.addEventListener('click',function(){
      sec.querySelectorAll('.f').forEach(function(x){x.classList.toggle('on',x===b)});
      var f=b.getAttribute('data-f');
      sec.querySelectorAll('.fields tbody tr').forEach(function(tr){tr.hidden=!(f==='all'||tr.getAttribute('data-s')===f)});
    });
  });
});
</script>
"""

if __name__ == "__main__":
    out = sys.argv[1]
    docs = [load(s) for s in sys.argv[2:]]
    open(out, "w", encoding="utf8").write(render(docs))
    print("wrote", out, [(l, len(r)) for l, r in docs])
