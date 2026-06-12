# 5W-CONTEXT — This project lives inside Abhay's 5 Wealths portfolio

**This is a generic, drop-in file.** The same content lives in every product repo Abhay owns (FireKaro, IPODhan, AlgoChanakya, …). It tells Claude — running in this product repo — three things:

1. The portfolio context this project belongs to.
2. The boundary rule that protects both layers from cross-contamination.
3. How to cross-reference 5Wealths without writing into it.

> If you are Claude reading this file, also read `5W-PRINCIPLES.md` and `5W-GLOSSARY.md` next to it before doing strategic / governance / scoping work.

---

## 1 — The portfolio Abhay runs

Abhay manages life and business through a framework called **5 Wealths**: five pillars (Time, Social, Mental, Physical, Financial) reviewed quarterly, with the goal of holistic happiness — not financial success alone.

The 10/10 vision per pillar (one line each):

| Pillar | 10/10 vision |
|---|---|
| Time | Full schedule control, income from systems, family + focused work + freedom |
| Social | Strong family bonds, community, 5–10 trusted peers, reliable in crisis |
| Mental | Clear dharma, daily practice, emotional resilience, contentment |
| Physical | Body composition + cardio + strength + sleep + 150 min exercise/week |
| Financial | $100M net worth (in April 2026 dollars) for self and family |

This product repo lives under the **Financial Wealth** pillar (every code project Abhay builds is currently a Financial Wealth project — they generate income or compound capital).

---

## 2 — Where the 5 Wealths system lives

**Root:** `D:\Abhay\VibeCoding\5Wealths\`

Key files at root (read-only from a product-repo session — see boundary rule below):

| File | What it is |
|---|---|
| `IDENTITY.md` | What 5 Wealths is and is not. Read this first if you've never seen it. |
| `CLAUDE.md` | Tier-1 operating rules for the 5Wealths workspace. |
| `Financial Wealth\PROJECT-MAP.md` | Value-flow diagram across all financial projects. |
| `Financial Wealth\FW-{ProjectName}\` | This product's meta-management folder (governance, not code). |
| `DECISIONS.md` | Append-only MADR-format strategic decisions, indexed `D-yyyy-mm-dd-NNN`. |
| `OPEN-QUESTIONS.md` | Items waiting on Abhay (`OQ-NNN`). |

**Find this project's meta-management folder** by looking inside `D:\Abhay\VibeCoding\5Wealths\Financial Wealth\` for the matching `FW-` prefixed folder. Folder pattern is `FW-{ProductName}` (e.g., `FW-FireKaro`, `FW-IPODhan`, `FW-AlgoChanakya`).

That folder contains a `CLAUDE.md` (Tier-3) with project-specific governance: legal entity, operational entity, deliverable, deadline, relationships (feeds / fed_by), and roles. **Read it once at the start of any strategic session.**

---

## 3 — The boundary rule (L-042 — non-negotiable)

> **5 Wealths skills and tracking files write ONLY inside `5Wealths\`. Product repos write ONLY inside their own folder. The two layers cross-reference by file path and ID, never cross-write.**

What this means concretely for Claude running inside this product repo:

✅ **You CAN, from this repo:**
- Read any file under `D:\Abhay\VibeCoding\5Wealths\` for context.
- Reference 5Wealths IDs (`D-2026-04-25-001`, `OQ-007`, `T-FW-002`, `RISK-001`) in this repo's commits, PR descriptions, journal entries, or code comments.
- Tell Abhay "this decision needs a 5Wealths entry under `Financial Wealth\FW-{ProjectName}\DECISIONS.md` — please run a 5Wealths session to record it" — but do NOT write that entry yourself.

❌ **You CANNOT, from this repo:**
- Edit, append to, or create files under `D:\Abhay\VibeCoding\5Wealths\`.
- Modify any `CLAUDE.md`, `JOURNAL.md`, `DECISIONS.md`, `TASKS.md`, `OPEN-QUESTIONS.md`, `INBOX.md`, `INDEX.md`, `SOMEDAY-MAYBE.md`, `INTAKE.md`, `SCORING.md` inside `5Wealths\`.
- Run `5W-*` skills from inside this repo's working directory.

If a strategic decision emerges during product-repo work, capture it inline (PR description, repo journal, code comment with `TODO(5W):`) and let Abhay carry it across at next 5Wealths session. The 5Wealths Claude is the **sole curator** (L-053) of all governance tracking files.

---

## 4 — Why this project exists in the portfolio

Every project in the portfolio earns its place by feeding something else. Before suggesting major scope changes, kill/promote decisions, or strategic pivots, check `Financial Wealth\PROJECT-MAP.md` for the value-flow graph. Common patterns:

- **Lead-generation feeders** (e.g., IPODhan-style content/SEO platforms) feed broker/AP businesses (Zerodha, AngelOne) via affiliate links → demat opens → brokerage revenue.
- **Trader-tool feeders** (e.g., AlgoChanakya-style platforms) drive retention and trade volume on the broker accounts → upsell + brokerage revenue.
- **Data-layer feeders** (e.g., FireKaro) become the canonical financial data source for the 5Wealths Financial pillar itself, and double as commercial SaaS when launched.
- **Direct revenue products** (any future SaaS) earn standalone subscription / ad / affiliate revenue.

If you're proposing changes that disconnect this project from its feeder relationships, flag that to Abhay as a portfolio-level decision — not a repo-level one.

---

## 5 — Cross-reference protocol

When this product repo needs to point at a 5Wealths artifact, use the **path + ID** format:

> `D:\Abhay\VibeCoding\5Wealths\Financial Wealth\FW-{ProjectName}\DECISIONS.md#D-2026-04-25-003`

When 5Wealths needs to point at this repo, the symmetric path:

> `D:\Abhay\VibeCoding\{repoFolder}\{file}#{anchor}`

Both layers stay decoupled but each can find the other deterministically.

### ID schemes used in 5Wealths (recognize them — don't invent new ones)

| Prefix | Meaning |
|---|---|
| `D-yyyy-mm-dd-NNN` | Decision (MADR record in DECISIONS.md) |
| `T-NNN` or `T-FW-NNN` | Task |
| `OQ-NNN` | Open question (waiting on Abhay) |
| `RISK-NNN` | Risk |
| `{prefix}-I-NNN` | Intake idea (`FW-I-001`, `PW-I-001`, etc.) |
| `L-NNN` | Locked architectural decision (e.g., L-042 boundary rule) |
| `Q-NNN` | Resolved planning question |

---

## 6 — When in doubt

If something looks like a strategic / governance / portfolio question (legal entity, kill criteria, commercialization timing, scoring, kill/promote, cross-project leverage), say:

> "This looks like a 5Wealths-tier decision. I'll capture it as a `TODO(5W):` note here. Please run a 5Wealths session to record it properly under `Financial Wealth\FW-{ProjectName}\`."

If it's a code / architecture / framework / refactoring / testing / deployment question, that's repo-level — handle it normally inside this repo's own conventions.

---

*This file is the bridge between this product repo and the 5 Wealths governance system. When the 5 Wealths foundational rules change, Abhay will refresh this file in the repo.*
