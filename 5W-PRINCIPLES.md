# 5W-PRINCIPLES — Immutable principles for every project Abhay builds

**Generic, drop-in.** Same file in every product repo. These four principles override convenience, override speed, override "just for me" patches. If a proposed solution violates any of them, surface it as a problem before writing code.

---

## 1 — Permanent, productized solutions only

> Never temporary patches just for Abhay. Build it like the next user is watching.

**What this rules out**

- Hard-coded values that only make sense for Abhay's accounts, IDs, addresses, broker keys, or family names.
- Special-case branches like `if user.email === "abhayinfosys@gmail.com"`.
- Manual SQL fixes or one-off scripts that never get committed as a feature.
- "Just for now" workarounds with no follow-up ticket.

**What this requires**

- Every feature works for any user with a similar life shape.
- Configuration over hard-coding — even when there's only one user today.
- The feature shipped on day-one is the same feature shipped on day-N (no "we'll generalize later" pattern).

This mirrors L-026 in the 5Wealths plan.

---

## 2 — Scale to all users from day one

> The architecture, schema, auth, and tenancy assumptions should accommodate user #2 with zero refactor.

**What this rules out**

- Single-tenant schemas that mix Abhay's data with shared reference data in the same tables.
- Storing personal identifiers (Abhay's name, Madhu's ARN, family birthdays) anywhere except as a row in a generalized `users` / `profiles` table.
- Auth flows that assume one user.
- Reports / dashboards / exports that hard-code specific account numbers, brokers, or amounts.

**What this requires**

- Multi-tenant from the schema up: `user_id` foreign keys on every operational table from the first migration.
- Any "Abhay's data" is just one row in the same shape any future user's data will take.
- Even when launching to a single test user (Abhay), the code path is the multi-user code path.

---

## 3 — Automate everything

> Minimal manual input from users wherever possible. If a value can be fetched, calculated, or inferred, fetch / calculate / infer it.

**What this rules out**

- Forms that ask the user for information already known (or available via integration).
- Manual data entry where an API or scraper exists.
- Required fields that could be optional with sensible defaults.
- Re-asking the same question across separate features instead of storing the answer once.

**What this requires**

- Default to integrations over manual entry (Google Fit for physical, FireKaro / bank statement parsing for financial, calendar for time, etc.).
- Calculate derived fields server-side (e.g., BMI from height+weight, FIRE crossover from income+expenses, GMP from scraped sources) instead of asking users.
- Detect changes and prompt only on exceptions, not on routine state.

---

## 4 — Continuously update from any signal

> When new information lands in any project or conversation, propagate it. Don't let one project hold a stale fact that another project already knows.

**What this rules out**

- Snapshot data copied between projects that goes stale silently.
- A user changing their bank in FireKaro but the broker-link integration in IPODhan still showing the old one.
- Documenting the same fact in multiple places (CLAUDE.md, README, code constants) without a single source of truth.

**What this requires**

- Every fact has one canonical home (the upstream system that owns it).
- Other systems query / subscribe / pull — never duplicate.
- When duplication is unavoidable for performance (cache), the cache has a clear refresh strategy.
- The 5Wealths system itself is the canonical home for portfolio-level facts (legal entity, operational entity, project relationships) — query it, don't copy it.

---

## How these four work together

The four principles compound: if you Productize (1) **and** Scale (2) **and** Automate (3) **and** Continuously update (4), the system grows by addition — new users, new integrations, new projects — without rewrites.

Violating any one of them creates technical or strategic debt that costs disproportionately to fix later. Treat a violation in code review as a blocker, not a nit.

---

## When the principles seem to conflict with shipping speed

They don't. They look like they do because building the productized version takes longer the first time. But the second feature, the second user, the second project — every subsequent thing — ships faster on a productized base.

If Abhay is asking for a quick fix that violates these, push back. He has explicitly chosen these principles for a reason: he is building a **lifetime portfolio**, not a quarterly sprint. Speed today that costs rebuild later is a bad trade.

---

*These four principles are stable. They should rarely, if ever, need to change.*
