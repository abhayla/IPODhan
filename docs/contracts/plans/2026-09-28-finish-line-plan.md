# Finish-line plan: admin core, then one production release

Date: 2026-09-28 (IST). Owner decisions: OD-133, OD-134, OD-135, OD-136 in
`docs/design/data-sourcing-pull-model.md` §0.0.1. Status: **awaiting owner go**.

## Why the project has not been finishing (measured 2026-09-28)

- Production last released **2026-09-07**. **378** fix commits sit on `main`, not live. Work was
  done; none of it shipped.
- The release gate said "every item built and every proof read". Item 36 (admin editing) was added
  on 09-25, three items stayed partial (6, 7, 19), and **15** contract-1 items wait on real-world
  events that have happened 0 times (e.g. #963 needs NSE to serve a blank date). A gate like that
  has no date.
- **134** open issues: 56 are already fixed on `main` (they close after the release), 46 deferred,
  19 parked, the rest mixed.

OD-133 replaces that gate with a fixed finish line. OD-134 decides who fixes each data problem.

## The finish line (OD-133, OD-135)

ONE production release that carries:

1. every fix merged to `main` (the 378), including the admin-route auth fix;
2. the fix-a-value admin core: §9 items 1, 2, 3, 5, 6, 7, 10, 11, 12, 13, 17, 19, 20, 22, 24;
3. the admin queue (OD-63), ordered live IPOs first (OD-136);
4. the release-safety fixes named in step 4 below.

Not blocking it any more: items 6, 7, 19 remainders; every parked proof; §9 items 8, 9, 14, 15,
16, 18, 21, 23, 25-28 (next release).

## Scraper or admin: the rule (OD-134)

| The field... | Who | Example |
|---|---|---|
| is plainly on a page/document we already fetch, and we store it empty or wrong for many IPOs | SCRAPER, fix now | sector blank but printed on Chittorgarh (#343, fixed) |
| is in no source we fetch | ADMIN, reason `NOT_SOURCED` | old BSE-only issue sizes (#979) |
| has failed two fix rounds | ADMIN | issue size from BSE share counts (#728, #472) |
| is right on some reads, wrong on others | ADMIN, all source values shown | lot size placeholder 100 (#696) |

## The order of work

Each step names its core and proof first (prove-core-first rule). A step that fails two rounds is
parked and its fields go to the admin queue; it does not hold the release.

### Step 1: prove the core, the per-source values (#1108 step 1)

- **Core:** for a field, the store records what EVERY listed source said, not only the one that won.
- **Proof:** one real staging cycle writes witnesses with 2 or more sources for at least 3 live IPOs,
  read back by query.
- **Today (F-196, 2026-09-27):** 53 rows carry witnesses, every one holds exactly ONE source (the one
  that supplied a value). The admin panel would show one source per field, which is not OD-102.
- If this cannot be made to work in two rounds, STOP and re-plan with the owner: the panel would then
  show only what was collected (the option OD-103 rejected).

### Step 2: the admin write path (§9 items 3, 11, 12, 19, 20)

One shared write function for every admin entry point. The saved value outranks every scraper,
passes the same field check as a scraped value, is refused if the field changed after the admin
opened it, and clears the cache so it shows at once. Folds in #1159 (400 on a bad value) and #1243
(admin paths still touching `ipo_reviews`). Fixes F-169, F-170, F-171 as one class.

### Step 3: the editor and the queue (§9 items 1, 2, 5, 6, 7, 10, 13, 17, 22, 24 + OD-62/63/136)

- Admin logins for the owner plus one or two people (OD-104). Login page exists (`web/app/admin/login`).
- Edit control on the IPO detail page; per field: each source's value, pick one or type one;
  derived fields read-only; every IPO, every status.
- Reason codes (OD-62) written for fields no source supplied. Today `field_extraction_failures`
  holds zero rows, so the queue cannot list missing values without this.
- Queue: conflicts + missing values, live IPOs first, links straight to the field (#787 sizing).
- Reader line: "From NSE, read <date>" or "Set by admin" (OD-109). Source values never shown to readers.
- UI proof: drive staging in a browser; edit one real field; confirm the page shows it and the next
  scraper cycle leaves it alone.

### Step 4: release-safety and reader-visible fixes (scraper's job under OD-134)

| Issue | What | Why it blocks |
|---|---|---|
| #1256 | status moves backwards (CLOSED to OPEN) | readers see a wrong status; in flight (worktree d-1256) |
| #1255 | a stuck lock skips every wake silently | scraper can stop with no alert; in flight (d-1255) |
| #1259 | deploy proceeds while an old scraper run is live | the release itself could corrupt a run |
| #97 | /affiliates page shows an error box on prod | revenue page; confirm fixed on staging |
| #94 | dummy "Alpha/Beta Registrar" rows on prod | junk readers see; deleting rows needs owner OK |
| #1115 | three pm2 apps have no TZ | one-line ops fix |
| #620 | document queue never drains | document fields never arrive; measure first, two rounds max |

### Step 5: staging soak, then one release

- Staging runs the full bundle for one scraper day; the owner reads the proof lines.
- Pre-deploy brief (deploy rule R6): done + proof, cost, disk %, rollback plan, open issues named.
- Prod has been on 09-07 code for three weeks, so every migration since then applies in one go.
  Staging already ran the same chain; the brief lists the count and the rollback point.
- One deploy from `release/prod-<date>` in the evening window, on the owner's word.
- After the release: the 56 `fixed-on-main` issues close as their nightly signal goes GONE.

### Step 6: the admin works the queue

Issues that OD-134 sends to the admin become queue items, not code work:
#453, #472, #561, #598, #684, #696, #979, #1179, #1196, #212, #241, #1116, #903, #963, #721, #356.

## What stops now

- No new detection checks, hooks or fleet tooling unless a step above needs one.
- No chasing parked proofs; they close when their event happens.
- No new spec discovery rounds; §9's later items wait for the next release.
- Deferred test/CI-infra issues (#1063, #1149, #1150, #1156, #1160, #1173, #1176-#1182, #1187,
  #1208, #1211, #1215, #1217, #1240, #1242, #1245-#1250, #1253) and worktree-tool bugs (#607, #613)
  wait until after the release, unless one breaks a step above.

## Honest risks

- **Step 1 is the real unknown.** If asking every source costs too much time per cycle, or some
  sources cannot be asked for some fields, the panel shows fewer sources than OD-102 wants.
- **Big migration jump on prod.** Three weeks of migrations at once. Proven on staging, still the
  riskiest part of the release.
- **Size.** The admin core is roughly half of §9 plus the queue. No date is promised here; the brief
  after step 3 gives a measured one.
