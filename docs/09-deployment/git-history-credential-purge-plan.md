# Git-history credential purge — plan, evidence and force-push runbook (T-216)

**Status:** rewrite REHEARSED and VERIFIED in an offline mirror. **Nothing has been pushed.**
The force-push is the destructive step and is owner-gated — see §8.

**Date:** 2026-08-21 · **Task:** T-216 · **Precondition:** T-215/T-252 rotation complete and proven.

> This document never contains the leaked value. Everything below is counts, hashes and paths.

---

## 1. What is actually leaked

The production Postgres superuser password for the Windows VPS (`103.118.16.189:5432`) was
committed at `043a0246`, stayed in the tree for 611 commits, and was scrubbed from the working
tree at `d3284473` ("scrub hardcoded VPS database password from 36 tracked files"). The tracked
credentials file was removed at `66ebd417` (#113), whose message explicitly deferred rewriting
history.

Deleting a file in a later commit does not remove it from history. `git log -p` retrieves the old
blob in seconds.

### 1.1 The finding that changes the fix

The credential is present in history in **two different encodings**:

| variant id (salted sha256 prefix) | form | length | occurrences |
|---|---|---|---|
| `8d169e056c` | raw literal (`password: '...'`) — **contains an embedded `@`** | 14 | 37 |
| `e7fe279d16` | percent-encoded inside `postgresql://user:...@host` URLs | 16 | 26 |

**Total: 63 occurrences across 51 distinct blobs.**

**One credential, two encodings — not two secrets.** Percent-encoding the raw 14-char value
(which itself contains an `@`) yields the 16-char variant exactly: `quote(raw) == encoded` was
re-verified programmatically on 2026-08-22. An independent checker that anchored on the host
initially read these as two distinct credentials; they are not. Both encodings are in the pattern
file, and both scan to zero after the rewrite.

A `--replace-text` run using only the raw literal (the obvious first attempt) removes 37 of 63
occurrences and leaves **26 readable copies** inside `DATABASE_URL` connection strings. The first
rehearsal in this task did exactly that, and the residual scan caught it. Any rewrite that does not
carry the percent-encoded variant is a false "done".

### 1.2 Sibling-class audit — are there other secrets in history?

A full-history sweep for other credential shapes (connection strings with passwords,
`PGPASSWORD=`, AWS access key ids, private-key blocks, `api_key` / `auth_token` / `client_secret` <!-- secret-scan:allow -->
assignments) found **no second real secret**. Every remaining match is a placeholder or a code
expression — verified by character-class fingerprint and masked context, not by assumption:

| what | verdict |
|---|---|
| `postgresql://<db-user>:...@103.118.16.189` in README/docs | angle-bracket placeholder |
| `ipodhan_user:...@localhost` in two story docs | ALL-CAPS placeholder token |
| `ipodhan_user:...@localhost` in a PowerShell doc | a `$variable` reference, not a value |
| `postgresql://postgres:postgres@localhost` in `.github/workflows/test.yml` | CI throwaway container |
| `PGPASSWORD="..."` in three docs | the words `password` / `your_password` | <!-- secret-scan:allow -->
| `PGPASSWORD=...` in `chittorgarh-audit.py` and `setup_remote_database.ps1` | a Python expression / PowerShell `Read-Host` | <!-- secret-scan:allow -->
| `api_key = "..."` in a skill reference doc | an example inside a "hardcoded key detected" report |
| `ADMIN_AUTH_TOKEN="..."` in `docs/00-admin/E2E_TESTING.md` | `your...`-prefixed placeholder |

AWS access keys: 0. Private-key blocks: 0.

---

## 2. Backup (taken FIRST, verified)

```
D:\Abhay\GetWorkDone\workspaces\T-216\IPODhan-backup.git
```

- Created with `git clone --mirror https://github.com/abhayla/IPODhan.git`
- **1083 commits · 111 refs · 15,555 objects · 65.56 MiB**
- Contains all 20 branches, all 91 `refs/pull/*` refs and every tag exactly as they existed on
  GitHub before any rewrite.

**Restore procedure — undoes a bad force-push completely:**

```bash
cd D:/Abhay/GetWorkDone/workspaces/T-216/IPODhan-backup.git
git push --mirror https://github.com/abhayla/IPODhan.git
```

This restores every branch and tag verbatim. It does **not** restore `refs/pull/*` (GitHub owns
those; we never rewrite them anyway — see §6) and it does not undo a branch-protection change made
to permit the force-push.

---

## 3. Tool choice

**`git-filter-repo`** (version `a40bce548d2c`), run as
`python <site-packages>/git_filter_repo.py`.

- `git filter-branch` is deprecated by the Git project, is far slower, and is easy to get subtly
  wrong. Not used.
- BFG would also work but adds a JVM dependency; filter-repo is already installed and is the tool
  the Git project points at.
- `--replace-text` replaces the literal in **blob content across all refs**, leaving trees and
  commit metadata otherwise untouched.

---

## 4. Exact rewrite procedure (reproducible)

```bash
cd D:/Abhay/GetWorkDone/workspaces/T-216

# 1. backup mirror (already taken - see section 2)
git clone --mirror https://github.com/abhayla/IPODhan.git IPODhan-backup.git

# 2. build the variant list (raw + percent-encoded); writes replace-patterns.txt
#    and never prints the value
python tools/build_patterns.py D:/Abhay/Ventures/IPODhan replace-patterns.txt

# 3. rewrite a COPY, never the backup
cp -r IPODhan-backup.git IPODhan-rewrite.git
cd IPODhan-rewrite.git
python <site-packages>/git_filter_repo.py --replace-text ../replace-patterns.txt --force

# 4. prove it
cd .. && python tools/scan_history.py IPODhan-rewrite.git replace-patterns.txt "post-rewrite"
```

`replace-patterns.txt` lives only under `workspaces/` (git-ignored on the fleet bus) and is deleted
after the run. It is never committed anywhere.

---

## 5. Verification — the difference is demonstrated, not asserted

Both scans walk **every object reachable from every ref** (`git rev-list --objects --all`),
stream the blobs through `git cat-file --batch`, and count exact byte matches for both variants.

| repo | objects scanned | blobs with a variant | occurrences |
|---|---|---|---|
| `IPODhan-backup.git` (pre-rewrite) | 14,472 | **51** | **63** (37 raw + 26 encoded) |
| `IPODhan-rewrite.git` (post-rewrite) | 14,472 | **0** | **0** |

Integrity of the rewrite:

- refs preserved: **111 → 111**; commits preserved: **1083 → 1083**
- **19 of 20 branch tips have byte-identical trees** before and after — the rewrite changed nothing
  except the credential.
- The one differing tip, `rescue/scraper-duplicate-routing`, is a stale pre-scrub branch (last
  commit 2026-07-16, **not merged into main**, open as PR #111). Its tip **still carries the
  credential in 37 working-tree files in the public repo today** — the same 36-file set the scrub
  commit named, plus `test-db-connection.js`. The diff there is exactly **43 replaced lines and
  nothing else**: all 37 files keep identical line counts, and every changed line carries
  `***REMOVED-CREDENTIAL***`. Zero unexplained changes.
- `git log -p --all -- test-db-connection.js` on the rewritten mirror returns the placeholder
  `***REMOVED-CREDENTIAL***` where the value used to be.

Evidence files: `D:\Abhay\GetWorkDone\evidence\2026-08-21-T-216\`.

---

## 6. What a history rewrite does NOT fix — read this before approving

This is the part that decides whether the disruption is worth it.

1. **GitHub pull-request refs cannot be rewritten.** 91 of the repo's 111 refs are
   `refs/pull/N/head` (plus three `/merge`). Every one of them reaches all 51 leaked blobs. They
   are server-owned and read-only: `git push --force` cannot touch them. After a perfect
   force-push of all 20 branches, **the credential is still fetchable from GitHub** via
   `git fetch origin refs/pull/17/head` and 90 others, until GitHub garbage-collects.
   A rewrite is therefore only complete when paired with a **GitHub Support request** to run GC
   and purge cached views. Without that ticket the force-push buys almost nothing.
2. **Cached commit views.** GitHub serves an unreachable commit by SHA at
   `github.com/abhayla/IPODhan/commit/<sha>` for a while. The same support ticket covers it.
3. **Existing clones.** Anyone or any machine that already cloned still holds the old objects. A
   server-side rewrite changes nothing on their disk.
4. **Forks.** Currently **0 forks**, so this risk is nil today — but it is permanent for any fork
   taken before the rewrite.
5. **Backups that predate the rewrite** — including the mirror in §2, which exists precisely
   because it still contains the secret. Delete it deliberately once the rewrite is accepted.
6. **The repository is PUBLIC** (created 2025-09-26, made public 2026-08-20). Between going public
   and the rotation completing on 2026-08-21 the value was world-readable. Assume it was scraped.
   What actually removed the risk was the rotation. This task removes the *appearance* of a live
   secret, not the exposure that already happened.

---

## 7. Blast radius — what breaks and who must act

Every commit from `043a0246` onward gets a new SHA. `main` moves `69a32ab4...` → `763d0858...`.
All 20 branches are affected.

| where | impact | required action |
|---|---|---|
| **5 open PRs** (#143, #137, #136, #111, #105) | head commits are replaced; GitHub may show them force-pushed or, worst case, unmergeable | land or close all 5 **before** the rewrite (strongly preferred), or recreate them after |
| **Dev PC — `D:\Abhay\Ventures\IPODhan`** | primary clone plus **7 linked worktrees** (`-t220 -t226 -t236 -t242 -t251 -t252` and the main tree) sharing one object store | re-clone fresh; worktrees cannot be fixed individually — `git worktree remove` them and recreate |
| **Local-only branch `fleet/T-243-...`** | exists on the dev PC but not on origin; its commits are absent from the rewritten history and would be orphaned | confirm it is already merged (its remote branch is deleted) and delete it locally |
| **Linux VPS `72.61.240.224` — self-hosted runner** | `_work/IPODhan/IPODhan` holds a checkout of old objects; `actions/checkout` force-fetches but the cache is stale | wipe the runner work directory once after the rewrite |
| **Linux VPS — deployed releases** | `/var/www/ipodhan/DEPLOYED_SHA-{staging,prod}` record OLD SHAs and the `/api/version` step compares against them | expect one mismatched version check; redeploy each slot to re-stamp |
| **Windows VPS `103.118.16.189` — `C:\Apps\IPODhan`** | legacy deploy path, retired under T-252 | verify retired; delete any remaining clone |
| **GetWorkDone fleet workspaces** | `workspaces/T-216/*` mirrors are deliberate copies of the old history | delete after acceptance |

---

## 8. Force-push runbook — OWNER-GATED, never run autonomously

Preconditions, all of them:

- [ ] All 5 open PRs merged or closed.
- [ ] No fleet worker holds a claim on IPODhan.
- [ ] A GitHub Support ticket is drafted (see §6.1) and ready to send immediately after the push.
- [ ] Backup mirror present and the restore command in §2 understood.

Steps:

```bash
# 1. temporarily allow non-fast-forward on main (web UI or gh api PATCH on branch protection)

# 2. push the rewritten refs - branches and tags only
cd D:/Abhay/GetWorkDone/workspaces/T-216/IPODhan-rewrite.git
git push --force --prune https://github.com/abhayla/IPODhan.git \
    "refs/heads/*:refs/heads/*" "refs/tags/*:refs/tags/*"

# 3. re-enable branch protection immediately

# 4. open the GitHub Support ticket: "please GC unreachable objects and purge cached commit
#    views for abhayla/IPODhan after a credential-removal history rewrite"

# 5. re-verify against the server
cd /tmp && git clone --mirror https://github.com/abhayla/IPODhan.git verify.git
python tools/scan_history.py verify.git replace-patterns.txt "server post-push"
# expect 0 under refs/heads/*; refs/pull/* will STILL match until GitHub GCs
```

Then, on every machine in §7: delete the old clone and clone fresh. Do not `git pull`.

**Rollback:** §2, one command.

---

## 8a. Mirror freshness gate — MANDATORY immediately before the push

The rewritten mirror is a **snapshot**. If anything lands on GitHub after the snapshot was taken,
force-pushing it **silently deletes that work**. This gate is not optional.

Snapshot taken 2026-08-21 16:14 IST. Re-verified 2026-08-22 00:45 IST: **20/20 branch heads
byte-identical to origin, `main` = `69a32ab4` on both sides — no drift.**

Run this immediately before step 2 of §8 and abort on any output:

```bash
cd D:/Abhay/Ventures/IPODhan
git ls-remote --heads origin | awk '{print $2" "$1}' | sort > /tmp/live-heads.txt
git --git-dir=D:/Abhay/GetWorkDone/workspaces/T-216/IPODhan-backup.git show-ref   | grep 'refs/heads/' | awk '{print $2" "$1}' | sort > /tmp/mirror-heads.txt
diff /tmp/live-heads.txt /tmp/mirror-heads.txt   # ANY output => STOP, re-do the rewrite
```

If it differs, the whole rewrite must be re-run from a fresh mirror. Do not "fix up" the old one.

## 8b. Post-push verification — what must be true before calling this done

| # | Check | Command | Expected |
|---|---|---|---|
| 1 | Old leak commit gone from branches | `gh api repos/abhayla/IPODhan/commits/043a0246` | still resolves **only** via `refs/pull/*` until GitHub GCs; unreachable from any branch |
| 2 | Server history is clean | clone `--mirror` fresh, run `scan_history.py` | **0** occurrences under `refs/heads/*` |
| 3 | Nothing lost | commit count on new `main` | **1083** total commits, 20 branches present |
| 4 | Site unaffected | `curl -sI https://ipodhan.com` + `/api/version` | 200; version step may report one SHA mismatch until each slot is redeployed |
| 5 | CI unaffected | trigger a workflow run | green; wipe the runner `_work` dir first (§7) |
| 6 | PRs reconciled | `gh pr list --state open` | all 5 pre-existing PRs merged/closed **before** the push, or recreated after |
| 7 | Support ticket | GitHub Support | filed — without it the `refs/pull/*` copies remain fetchable (§6.1) |

## 8c. Re-clone guidance — every machine holding this repo

A rewrite makes `git pull` unsafe: it will merge the old history back in. **Delete and re-clone.
Never pull.**

| Machine | Path | Action |
|---|---|---|
| Dev PC (`itsab-PC`) | `D:\Abhay\Ventures\IPODhan` + 7 linked worktrees | `git worktree remove` each (or delete the folders and `git worktree prune`), then delete the clone and `git clone` fresh. The worktrees share one object store — fixing them individually is not possible. |
| Dev PC | local-only branch `fleet/T-243-...` | already merged upstream; delete locally — its old-SHA commits do not exist in the new history |
| Linux VPS `72.61.240.224` | self-hosted runner `_work/IPODhan/IPODhan` | delete the work directory once; `actions/checkout` re-clones |
| Linux VPS | `/var/www/ipodhan/` deployed releases | redeploy staging and prod once to re-stamp `DEPLOYED_SHA-*` |
| Windows VPS `103.118.16.189` | `C:\Apps\IPODhan` | retired under T-252 — confirm and delete any remaining clone |
| Fleet bus | `GetWorkDone/workspaces/T-216/*.git` | the backup mirror is the rollback source — keep until acceptance, then delete deliberately (it still contains the value) |

## 8d. Verification status of THIS document

Everything in §5 was **re-run live on 2026-08-22**, not carried over from the earlier run:
backup mirror 63 occurrences / 51 blobs, rewrite mirror **0**; both mirrors `fsck` clean at
1083 commits / 111 refs; `main` tree SHA identical before and after; 19/20 branch tips
byte-identical; the 20th differs by 43 redaction lines and nothing else.

A prior checker run (T-216C, 2026-08-21 17:08 IST) returned **FAIL** — correctly — because that
run's mirrors were deleted mid-audit by disk pressure on a 94%-full `C:` drive. This run's mirrors
live on `D:` (38% used, 172 GB free) and were verified present and intact at the time of writing.

## 9. Honest recommendation

The credential is dead: rotated under T-252, the old value proven **refused** by the server, plus a
`pg_hba` lockdown and `REVOKE CONNECT`. The repo has 0 forks. The risk this task removes is
**reputational and hygienic, not operational**.

Against that: the rewrite breaks 5 open PRs, invalidates 7 worktrees and every clone, needs a
runner wipe and a redeploy of both slots — and **does not actually remove the secret from GitHub**
without a support ticket only the owner can file.

Recommendation: **do it, but as one deliberate batch, not now.** Wait until the 5 open PRs land,
then run §8 end to end in a single sitting with the support ticket ready. A force-push without the
ticket is disruption with no payoff. Doing nothing is also defensible — the money risk is already
gone.

Independent of that decision, two things are worth doing immediately and cost nothing:

1. **Close or delete `rescue/scraper-duplicate-routing` / PR #111.** Its tip still shows the
   credential in 17 files in the current public repo. It is five weeks old and unmerged.
2. **Extend the pre-commit secret scanner** (`scripts/check-staged-secrets.js`) to catch
   percent-encoded credentials inside connection strings — the exact gap that made this leak
   double-sized and that nearly made this rewrite incomplete.
