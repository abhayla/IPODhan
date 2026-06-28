# About Me — IPODhan

> **In one line:** IPODhan is an automated IPO information platform for Indian investors —
> it figures out which new share issues are *genuine IPOs*, gathers every detail about them
> from many sources (including the company's own DRHP/RHP prospectus), keeps that data fresh,
> and presents it cleanly and for free to anyone deciding whether to apply for an IPO.

**Companion document:** [`how.md`](./how.md) explains, step by step, *how* this goal is achieved.

---

## 1. The goal (what this project is for)

There is no single, reliable, free place for an ordinary Indian investor to see **all** the
information needed to make an IPO decision. The data is scattered — the exchanges (NSE, BSE),
aggregator sites (Moneycontrol, Chittorgarh), grey-market trackers, and the company's own
hundreds-of-pages prospectus (DRHP/RHP). Worse, exchange "public issue" listings mix real IPOs
together with other money-raising events (rights issues, buybacks, takeovers/tender offers,
debt issues, OFS, REITs/InvITs) that look similar but are **not** IPOs.

**IPODhan's goal is to do that scattered, error-prone research automatically and correctly**, so
the user gets one trustworthy, complete, up-to-date view of every Indian IPO:

1. **Correctly identify** what is a real IPO versus some other corporate action.
2. **Collect every detail** of each IPO from all available sources — price band, lot size,
   dates, issue size, subscription numbers, grey market premium (GMP), financials, use of
   funds, peer comparison, registrar, documents.
3. **Resolve disagreements** between sources into one authoritative record (the most reliable
   source wins, per field), while never overwriting a human's manual correction.
4. **Keep it fresh** — subscription figures and GMP move during market hours; the platform
   re-scrapes on a market-aware schedule.
5. **Show it to the user** quickly, accurately formatted (₹, crores, IST dates), and
   search-engine-discoverable.

## 2. Who it serves (the primary user)

The **retail Indian investor** deciding whether to apply for an upcoming or open IPO — someone
who wants the price band, lot size, dates, subscription status, GMP, financial health, and
"should I look closer?" signals in one place without paying or hunting across five websites.

Secondary users: anyone researching past IPO listing performance, and the IPODhan admin who
curates/corrects data.

## 3. The value it creates

- **Completeness** — pulls together data that no single free source has in one place,
  including details that otherwise require reading a 300-page prospectus PDF.
- **Correctness** — it actively filters out non-IPOs (a takeover is not an IPO) and reconciles
  conflicting numbers instead of trusting one source blindly.
- **Freshness** — live-ish subscription and GMP figures, refreshed on a market-hours schedule.
- **Trust** — human admin corrections are *protected* and never silently overwritten by a later
  scrape.
- **Free & automated** — minimal manual entry; the system fetches, computes, and infers.

## 4. Why this project exists in the bigger picture

IPODhan sits in the **Financial Wealth** pillar of the 5 Wealths portfolio as a
**lead-generation feeder**: high-quality, SEO-discoverable IPO content attracts investors, who
open demat accounts through partner brokers (Zerodha / AngelOne affiliate links), which produces
brokerage/affiliate revenue for the operating business (PIFS). The product earns its place by
*feeding* that funnel — so completeness, correctness, and search visibility are not vanity
metrics; they are the engine. (Portfolio/strategic decisions are governed separately under
`5Wealths\` — see `5W-CONTEXT.md`.)

## 5. The principles it must honour

Everything is built to be **productized** (works for any user, not hard-coded for one),
**multi-tenant-ready from day one**, **automated** (fetch/compute/infer over manual entry), and
**continuously updated** from any new signal — the four immutable principles in
`5W-PRINCIPLES.md`.

---

*The mechanics — exactly how each of the five goal-steps above is implemented in code — are in
[`how.md`](./how.md).*
