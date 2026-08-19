# Security: Production Postgres Credential Exposure (T-215)

**Status:** Credential still live and unrotated as of 2026-08-20. Rotation plan approved-pending-owner.
**Severity:** P1 — production database superuser, reachable from the public internet.
**Related:** T-216 (git history rewrite — separate task, still open).

> This file records a verified security finding. It contains **no credential values** and
> must never be edited to include one. Refer to credentials by name and location only.

---

## 1. What was exposed

The PostgreSQL **superuser** credential (`user postgres`) for the production database on
the VPS `103.118.16.189` was committed to this repository in plaintext.

The same host also serves **algochanakya.com** and runs the IPODhan scraper, so the blast
radius of this credential is larger than IPODhan alone.

The scrub commit's subject says "36 tracked files"; `git show --stat d3284473` reports
**37 files changed**. Either way the value was spread across the repository in two forms:

- raw literal (`password:` fields, `PGPASSWORD=` assignments), and
- URL-encoded inside the password segment of `DATABASE_URL` connection strings.

## 2. Exposure window

| Marker | Commit | Date |
|---|---|---|
| First commit containing the literal | `043a0246` | 2025-10-05 |
| Working tree scrubbed | `d3284473` | 2026-06-12 |
| Last tracked file removed | `66ebd417` | 2026-07-19 |

**611 commits** sit between `043a0246` and `d3284473`
(`git rev-list --count 043a0246..d3284473` → `611`).

## 3. The credential has NEVER been rotated

Verified 2026-08-20:

```bash
git log --all -i --grep=rotat --oneline
```

Every match is a commit that *mentions* rotation as an outstanding follow-up; none performs
one. The two scrub commits say so in their own messages:

- `d3284473`: *"The credential remains in git history — rotation on the VPS is still required."*
- `66ebd417`: *"rotating it and rewriting git history are separate, owner-approved follow-ups outside this change."*

## 4. History still contains it

The scrub commits removed the value from the **working tree only**. `git log -p`,
`git show 043a0246`, and any clone, fork, backup, or CI cache of this repository still
contain a working production superuser password.

**Consequence:** every machine that has ever held a clone of this repo holds a live
production credential. Scrubbing the working tree did not reduce that exposure at all.

## 5. Repository visibility is gated on this

On 2026-08-19 the owner asked to make this repository public to unblock CI minutes. That
change was **blocked**: publishing the repo would have published this credential to the
open internet, where automated scanners locate such values within minutes.

Rotation is the prerequisite that makes the visibility question safe to revisit. It is
**not** sufficient on its own — see §6.

## 6. Open follow-up: git history rewrite (T-216)

Rotation invalidates the leaked value but does **not** remove it from history. Making the
repository public still requires T-216 (history rewrite), because history also reveals:

- the production host, port, database name, and superuser account name;
- the historical password, which indicates the password-generation scheme in use and may
  match credentials reused on other estate systems.

**Order of operations:** rotate first (T-215), then rewrite history (T-216), then revisit
visibility. Rewriting history before rotating leaves the live credential valid on every
existing clone while giving false assurance.

## 7. Rotation plan

The full consumer enumeration, least-privilege role design, cutover, rollback, and
verification steps are in
[`CREDENTIAL-ROTATION-PLAN.md`](./CREDENTIAL-ROTATION-PLAN.md).

That plan is **owner-gated**: no live credential change has been executed. The autonomous
phase of T-215 ends at an approved plan.

## 8. Secret-handling rules that apply going forward

- Real credentials live only in the project's own `.env` files (already gitignored:
  `.gitignore` lines 14–18, 51) or in GitHub Actions secrets.
- Never in `GLOBAL.md`, never in any repo-tracked file, never in a commit message, PR body,
  log line, or evidence artifact.
- `scripts/check-staged-secrets.js` runs pre-commit and blocks connection strings with
  embedded passwords, `PGPASSWORD=` literals, AWS keys, and private-key blocks. Do not
  bypass it with `secret-scan:allow` for a real value.
