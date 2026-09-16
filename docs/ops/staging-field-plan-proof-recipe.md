# Staging proof recipe: field-plan generation (PASS 2.5) and the walk (PASS 3)

Written 2026-09-16 before the run, so the steps are the ones actually executed.
Folds into `docs/ops/prod-ops-recipes.md` in the morning batch.

**Scope: STAGING ONLY.** Prod's env is not touched by any step here. Neither flag
is a required key in `scripts/assert-env-keys.sh` (verified: zero matches), and the
flag-liveness report only covers required keys and never fails a deploy — so adding
these lines is additive and changes no deploy behaviour.

## What is being proven, and why in this order

1. **Generation writes rows** — `ENABLE_FIELD_PLAN=true`, walk flag still OFF.
2. **Generation reconciles, never regenerates** — a second wake inserts zero and
   leaves the table unchanged.
3. **The walk consumes them** — `ENABLE_FIELD_PLAN_WALK=true`. This is the step
   that pays #678's owed proof; it cannot be taken earlier, because a walk with
   no plan rows to read proves nothing.

## The trap this recipe exists to avoid

A row count alone is not evidence. Generation is PASS 2.5, second-to-last in the
wake, so a cycle where PASS 1+2 consume the budget skips it and says so. Three
distinct outcomes look identical in the table and are distinguishable ONLY in the log:

| Log line | Means |
|---|---|
| `PASS 2.5 field-plan generation summary for this cycle` | it RAN (payload carries `ipos`, `rowsInserted`, `failed`) |
| `Field-plan generation skipped — no wake budget remains` | never ran; PASS 1+2 ate the wake |
| `Field-plan generation budget exhausted — remaining IPOs resume next cycle` | ran, stopped partway between IPOs |

The summary is logged **unconditionally** (fixed at 55b36ace) precisely so that
wake 2 of the reconciled-not-regenerated proof, where zero rows is the CORRECT
result, still announces that the pass ran. Read the line first, the count second,
and name the cycle each came from.

## Two clocks, and the cycle that is not a wake

**The host reports IST; the scraper logs are UTC.** `stat` on the env file said
`07:54:37 +0530`; the cycle line said `02:22:43Z`. Those are 2 minutes apart, not
5.5 hours. Comparing them raw makes a flag look written before a cycle it was
actually written after -- the same class as the journal-vs-runner-log trap.
Convert before concluding anything about ordering.

**A deploy runs its own cycle that is NOT a cron wake.** The 7e24f7ce deploy
completed at 02:17Z and a full cycle ran at 02:22:43Z -- neither :15 nor :45.
`deploy-linux.sh` starts the scraper after the atomic flip. That cycle runs the
NEW CODE but whatever env existed at that moment, so a flag added afterwards is
absent from it. Its silence on the PASS 2.5 line is correct and proves nothing.
Read the flag file's mtime against the cycle's timestamp (both in the same zone)
before treating any cycle as the first flagged one.

## Does a deploy undo this?

No. `scripts/deploy-linux.sh` only READS `$SCRAPER_ENV_FILE` (required-keys
assert at :485, runtime preflight at :528, REDIS_URL read at :626) and
SYMLINKS it into the release at :975 (`ln -sfn "$SCRAPER_ENV_FILE"
"$RELEASE_DIR/scraper/.env"`). It never writes or regenerates it. A flag added
here survives every subsequent deploy until someone removes the line.

Checked 2026-09-16 because "the next deploy silently reverted my flag" is the
first thing that would make this proof unreproducible, and the deploy script
DOES regenerate other config (the retired Windows path rewrote
ecosystem.config.js on every deploy — see .claude/rules/
pm2-scheduled-one-shot-scraper.md). It does not do that here.

## Steps

    # 1. add the flag (staging slot only)
    # host alias per prod-ops-recipes.md; the VPS is production, read paths only
    # except this one sanctioned staging write.
    # PATH VERIFIED ON THE BOX 2026-09-16, including a correction to my own
    # correction. The root is /var/www/ipodhan, NOT /root/ipodhan -- that half my
    # first draft got wrong, and a flag appended to a non-existent path creates the
    # file, exits 0, and changes nothing. But env-staging and env/staging are the
    # SAME FILE: shared/env-staging is a symlink to shared/env/staging (same inode
    # 4456820), so both spellings work and deploy-linux.sh's $ROOT/shared/env/$SLOT
    # was right about the shape. The running release symlinks scraper/.env to the
    # env/staging spelling; the flag is visible through it either way.
    F=/var/www/ipodhan/shared/env-staging/scraper.env
    ssh -o BatchMode=yes rfp-vps "test -f $F && echo PATH_OK"   # refuse to proceed without this
    cp "$F" "$F.bak-$(date +%Y%m%d-%H%M)"      # restore path, never git checkout
    grep -q '^ENABLE_FIELD_PLAN=' "$F" || echo 'ENABLE_FIELD_PLAN=true' >> "$F"
    grep -n 'ENABLE_FIELD_PLAN' "$F"           # read it back

    # 2. DO NOT `pm2 restart` to pick up the flag.
    # ipodhan-scraper-staging is the scheduled ONE-SHOT pattern: autorestart
    # false, `cron restart 15,45 * * * *`, normally sitting in state `stopped`
    # between wakes (verified on the box 2026-09-16). A restart would START A
    # SCRAPE IMMEDIATELY -- a different code path from the scheduled wake this
    # proof claims to measure, and one that skips whatever the cron wake sets up.
    # pm2's cron restart re-reads the env when it fires, so the flag is picked
    # up by the NEXT natural wake at :15 or :45. Wait for it.
    ssh -o BatchMode=yes rfp-vps "pm2 describe ipodhan-scraper-staging --no-color | grep -iE 'cron restart|script path'"

    # 3. wake 1 — read the LINE, then the count
    pm2 logs ipodhan-scraper-staging --nostream --lines 400 \
      | grep -E 'PASS 2.5 field-plan generation summary|Field-plan generation (skipped|budget exhausted)'
    # then, through the 15432 tunnel, against ipodhan_staging:
    #   select count(*) from ipo_field_plan;

    # 4. wake 2 — DO NOT expect rowsInserted=0. That was my original test and it
    #    is wrong on a live slot: staging keeps DISCOVERING IPOs, so later cycles
    #    legitimately plan newly-found ones (measured: 298 rows/40 ipos at 02:41,
    #    then 10 rows/1 new ipo at 02:48, then 14 rows/2 new ipos at 02:56).
    #    A non-zero rowsInserted is not regeneration.
    #
    #    The property to test is PER-IPO, not per-cycle: no IPO may receive rows
    #    from more than one cycle. Run against ipodhan_staging:
    #
    #      select ipo_id, count(distinct date_trunc('minute', created_at)) cycles
    #      from ipo_field_plan group by ipo_id having count(distinct
    #      date_trunc('minute', created_at)) > 1;
    #
    #    PASS = ZERO ROWS. That is strictly stronger than rowsInserted=0: a zero
    #    insert count is ambiguous between "correctly skipped" and "never ran",
    #    whereas zero multi-cycle IPOs while inserts CONTINUE can only mean the
    #    ON CONFLICT DO NOTHING clause is doing its job.
    #    A missing summary line is still NOT a pass; it means the pass did not run.

    # 5. only then: ENABLE_FIELD_PLAN_WALK=true, same add + restart, and read
    #      pm2 logs ipodhan-scraper-staging --nostream --lines 400 | grep -E 'PASS 3 field-plan walk summary'
    #    Verified 2026-09-16 that all four patterns in this file match the
    #    strings document-cycle.ts actually emits (each pattern stops before
    #    the em dash, so a C locale over SSH does not silently return zero).
    #    fieldsCheckFailed and outcomesFailed are the two counters that say the
    #    pass went badly even when it looks busy.

## Rollback

Restore the `.bak` written in step 1 and `pm2 restart ipodhan-scraper-staging
--update-env`. Both flags default to false when the key is absent
(`process.env.X === 'true'`), so removing the line is a complete rollback.
