#!/usr/bin/env python3
"""chittorgarh-audit.py — compare IPODhan's IPO data against Chittorgarh (data-quality audit).
Read-only. Deterministic data pull; run any time to spot IPODhan-vs-source discrepancies.

Config (env, not hardcoded):
  DATABASE_URL              IPODhan Postgres (same var the app uses; reads from env or .env.local)
  CHITTORGARH_REPORT_URL    optional override; defaults to the webnodejs report endpoint the scraper uses
Usage:  python scripts/audit/chittorgarh-audit.py
"""
import subprocess, json, urllib.request, urllib.parse, re, os, sys, datetime, shutil

def load_env():
    if os.environ.get("DATABASE_URL"): return
    for f in (".env.local", "web/.env.local", ".env"):
        if os.path.exists(f):
            for line in open(f, encoding="utf-8", errors="ignore"):
                if line.startswith("DATABASE_URL="):
                    os.environ["DATABASE_URL"] = line.split("=",1)[1].strip().strip('"'); return

CHITTORGARH = os.environ.get("CHITTORGARH_REPORT_URL",
    "https://webnodejs.chittorgarh.com/cloud/report/data-read/82/1/9/2026/2026-27/0/all/0?search=&v=15-11")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36"

def q(sql):
    u = urllib.parse.urlparse(os.environ["DATABASE_URL"])   # handles special chars incl. '@' in password
    env = dict(os.environ, PGPASSWORD=urllib.parse.unquote(u.password or ""))
    psql = shutil.which("psql") or r"C:\Program Files\PostgreSQL\16\bin\psql.exe"
    r = subprocess.run([psql, "-h", u.hostname, "-p", str(u.port or 5432), "-U", u.username,
                        "-d", u.path.lstrip("/"), "-t", "-A", "-F", "\t", "-c", sql],
                       capture_output=True, text=True, env=env)
    if r.returncode != 0: sys.exit(f"psql error: {r.stderr.strip()[:200]}")
    return [ln.split("\t") for ln in r.stdout.strip().splitlines() if ln.strip()]

def main():
    load_env()
    if not os.environ.get("DATABASE_URL"): sys.exit("DATABASE_URL not set (env or .env.local)")
    ip = q("SELECT company_name, COALESCE(issue_size::text,''), open_date::date "
           "FROM ipos WHERE open_date IS NOT NULL ORDER BY open_date DESC LIMIT 10;")
    req = urllib.request.Request(CHITTORGARH, headers={"User-Agent": UA, "Accept": "application/json"})
    cg = json.load(urllib.request.urlopen(req, timeout=20)).get("reportTableData", [])
    print(f"# IPODhan vs Chittorgarh data audit ({datetime.date.today()})")
    print(f"\nIPODhan: {len(ip)} latest IPOs (DB). Chittorgarh: {len(cg)} records (report API).\n")
    print("NOTE: fuzzy company-name matching + field diffing is intentionally left to an LLM/reviewer layer")
    print("on top of this deterministic data pull — rigid string matching mis-handles real name variants.\n")
    print("| IPODhan company | issue_size (₹) | open_date |\n|---|---|---|")
    for name, issue, od in ip:
        print(f"| {name} | {issue} | {od} |")
    print(f"\nChittorgarh sample: " + "; ".join((r.get('Company') or '')[:30] for r in cg[:5]))
main()
