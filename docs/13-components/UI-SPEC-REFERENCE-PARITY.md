# IPODhan UI Specification v1.0 — "Reference Parity" (target ≥9.5/10)

> Produced 2026-07-02 by the design-prescriber agent from the owner-selected references
> (Screener.in structure · Zerodha visual language · Levels.fyi tables) + current captures,
> per Abhay's reverse-solutioning directive. Companion to UI-REDESIGN-NORTHSTAR.md.
> Scoring stays with a SEPARATE context-blind reviewer (never the prescriber).

## G — GLOBAL

### G1. Color tokens (WHITE canvas — replaces the gray/teal system)

```css
:root {
  --bg-page:        #FFFFFF;   /* body — pure white, like Zerodha */
  --bg-section:     #F8F9FB;   /* optional alternating band / page gutter */
  --bg-card:        #FFFFFF;
  --border:         #E6E8EC;   /* 1px card & table borders */
  --border-strong:  #D4D8DE;   /* table header underline */
  --text-primary:   #1C2024;
  --text-secondary: #43484E;
  --text-muted:     #6E7681;
  --accent:         #387ED1;   /* THE one accent — links, active tab, buttons, chart line */
  --accent-hover:   #2E6DB5;
  --accent-tint:    #EFF5FC;
  --gain:           #118A4E;  --gain-tint: #E9F6EF;
  --loss:           #D32F2F;  --loss-tint: #FDEEEE;
  --warn:           #B45309;  /* on --warn-tint #FDF3E3 */
}
```

Hard rules: delete teal everywhere (→ --accent); delete mint value-pills in key-value tables
(values plain text-primary 600); delete yellow row tints (status = 6px dot + chip only);
green/red ONLY on gain/loss numbers + status dots — never card borders/washes; cards =
white, 1px border, 8px radius, shadow max `0 1px 2px rgb(16 24 40 / .04)`.

### G2. Typography (Inter, `tnum` on ALL numeric cells)
Page title 24/32·600 (20/28 mobile) · section title 17/24·600 · card title 14/20·600 ·
KPI label 12/16·500 muted (ls .02em) · KPI value 18/24·600 (15/20 in-card) · table header
12/16·600 muted · cell 13/20·400 (company 500) · body 14/22·400 secondary · caption 12/18 muted.
Kill 28px+ decorative numerals; no two-tone gray headings.

### G3. Charts
1. Line = accent 1.5px; area fill accent 8%; multi-series #387ED1/#7C3AED/#0E9384; NEVER stack
   non-additive series (subscription multiples).
2. Gridlines horizontal only #F0F2F4; no chart border box.
3. Axis labels 11px muted; y 3–5 ticks no axis line; x baseline #E6E8EC.
4. Hierarchy-aware time ticks: ≤48h → HH:mm every 2-3h, date printed once per day change,
   max 6 ticks; 3–45d → `d MMM` deduped; >45d → `MMM ''yy`. A formatted label must NEVER
   repeat consecutively — enforce in ONE shared axis formatter.
5. <4 points → NO chart (value + signed delta chip); 4–10 → 48px sparkline; >10 → full chart
   240px desktop / 200px mobile.
6. Tooltip: white card, border, 12px; dashed #C9CED6 crosshair.

### G4. KPI ribbon (Zerodha strip — replaces ALL "3 big stat cards")
One bordered card split by 1px vertical rules; cell = label 12/500 muted over value 18/600;
desktop ≤8 cells one row; mobile 2×3 (hide 2 lowest-priority), no h-scroll.

### G5. Buttons & links
Primary accent bg white text 13/600 r8 h36 (44 only Apply CTA), max-width 220px desktop.
Secondary white + border. Links accent, hover underline. Table company names text-primary 500
→ accent on hover (not permanent link-color columns). Orange Compare → secondary.

### G6. Status chips (one system)
Open=gain dot · Closing soon=warn · Upcoming=accent · Closed/Listed=muted. 12px text, 2/8px
padding, tint bg, 999px radius. Meta pills (KNACK/NSE/MAINBOARD) → one muted meta line.

## D — DETAIL PAGE (Screener structure + Zerodha header)
D1 header: breadcrumb → name 24/600 + status chip; muted meta line `Mainboard · Sector · NSE, BSE`;
right: Compare (secondary) + Apply (primary). DELETE logo card, 8-step icon timeline banner,
full-width warning; UPI countdown = one amber inline line under ribbon while open.
D2 fact ribbon (G4): `Price Band · Lot · Min Inv · Issue Size · GMP (colored) · Subscription ·
Open–Close · Listing`. Replaces 3 stat cards + duplicates. Mobile 2×3.
D3 sticky 34px tab bar: Overview · Subscription · GMP · Financials · Allotment · Documents —
13/500, active = accent text + 2px underline.
D4 section order: 1 compact 56px dot timeline · 2 Subscription (category table QIB/NII/Retail/
Total 40px rows + intraday 3-line chart, 1x dashed reference "Fully subscribed"; kill
Current/Peak/Avg mini-cards; caption `Updated 5:00 PM, 2 Jul · Source: NSE+BSE`) · 3 GMP
(value+delta left, 30d line right, issue-price dashed ref, est-listing caption, GMP disclaimer;
<4 pts → number only) · 4 Lot & application matrix (drop giant green ₹ display; Retail(Min)
row accent-tint) · 5 Financials (Screener years-as-columns; until data: header + one muted line
"Available after DRHP analysis" — kill the gray Awaiting-data strip) · 6 About (72ch, 4-line
clamp) · 7 IPO details full key-value grid (merge Allotment & Listing card; no tinted cells) ·
8 Apply card (two 220px buttons + disclosure; mobile sticky bottom bar 56px while Open) ·
9 Documents rows · 10 Lot calculator.
D5 mobile: single col, ribbon 2×3, tables → 2-line rows except lot matrix (h-scroll + sticky
first col), sticky Apply bar.

## H — HOME
H1 hero ≤260/220px white; title 32/700 single color "India's IPO tracker — live subscription,
GMP & allotment"; one-line sub; Browse (primary) + Lot Calculator (secondary).
H2 two live tables (Mainboard/SME): `Company | Price Band | Open | Close | Subscription | GMP`
(add last two — persona's #1 data); no row tints; dot before name; 8 rows + View all.
H3 ONE merged upcoming table `Company | Board | Status | Expected date`; empty = one muted line.
H4 six icon cards → one row of quiet icon+label links; DELETE "Ready to Start" banner.
H5 order: Hero → live tables → Upcoming → Recently listed (mini-table with gain%) → tools row → footer.

## L — LISTING PAGES
L1: title + 2-line description · KPI ribbon (Total/Open/Upcoming) · status TABS (Open/Upcoming/
Recently listed/All) each showing ONE table (recently-listed gains colored column replaces
Performance-Highlights cards) · All = detailed table `Company | Status | Open | Close | Listing |
Price ₹ | Issue Size ₹ Cr | Listing gain %` (Listing At + Lead Manager demoted to detail);
sticky header; DELETE reviews empty card, features 4-card block, lone subscription card.
L2 mobile: row-cards (`Company — chip` / `₹170 · 1–3 Jul · GMP ₹30 · 1.16x`), no h-scroll.

## Y — HISTORY (Levels.fyi upgrade)
Y1 table: dark #232B35 header, white 12/600, 40px; rows 44px zebra #FAFBFC, hover accent-tint;
columns + ADD `Current price ₹` + `Current gain %`; numerics right tabular; company cell
two-line (name + muted `Mainboard · Jul 2026`).
Y2 filters: year multi-select + sector chips; mobile bottom-sheet "Filters (2)"; summary strip
`155 IPOs · median listing gain +6.4% · 58% listed in gain`.
Y3 (phase 2): 40px gain-distribution histogram with median marker.

## T — TABLE SPEC (shared)
Rows 40px dense / 44px browse / 48px mobile touch; padding 12/16; header 12/600 muted white bg
1px border-strong bottom (dark header = History only); text left, numbers/dates right,
tabular-nums; hover #F6F8FB full-row clickable; sort glyph 10px; mobile ≤4 cols keep table,
>4 → row-cards or h-scroll+sticky-first; empty state = one 13px muted line (no gray panels).

## TOP 5 (ranked, est. score impact)
1. G1 color reset (white canvas, one blue accent, semantic-only green/red) ~ +1.5
2. D2 fact ribbon + details dedupe ~ +0.8
3. G3.4 time-axis formatter + un-stack subscription chart ~ +0.7
4. L1 listing de-carding (status-tabbed single table) ~ +0.6
5. T/Y1 table system + H2 GMP/Subscription columns on Home ~ +0.5

Implementation order: G1→G2 tokens → D2/D3/D4 → G3 → L1/H → Y.
