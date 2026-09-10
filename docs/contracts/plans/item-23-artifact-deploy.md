# Item 23 — build in CI, deploy an artifact: the production VPS never runs `npm ci` or `next build` again

**Owner approval:** typed in lanes A, B, C on 2026-09-10 ~22:3x IST: "Approved: item 23, build in CI and deploy an artifact so the production server never runs npm ci or next build; lane A, after s17." · **Lane:** A · **Position:** after item 1 s17 · **Tier:** A throughout (deploy pipeline, CI, prod) · **Author:** supervisor, from a read of the files cited below (2026-09-10 22:5x IST).

## Why (measured)

A release today is 3.1 GB: `web/.next/cache` 1.5 GB (build scratch, not served), `node_modules` 1.5 GB (all workspaces, dev deps included), served output 83 MB (`web/.next/static` 5.3 MB + `web/.next/server` 78 MB). Every merge to main runs a full install and compile on the 2-vCPU box that serves the live site (36 staging deploy runs on 2026-09-10 read at 22:0x IST, 21 failed, most of the failures before the disk was cleared; load average 1.4 on 2 cores at 22:06 and 5.5 at 22:30 with two deploys stacked). Item 1's s12/s16/s17 shrink and space out that load; they do not remove it. The repo is public, so GitHub-hosted Ubuntu runners cost nothing (a five-job pr-gate run bills 0 minutes).

## What the deploy does today (`scripts/deploy-linux.sh`, read 2026-09-10)

| step | lines | needs dev deps? |
|---|---|---|
| release dir + `git archive $SHA \| tar -x` | 718–733 | no |
| symlink env files and certs into the release | 737–750 | no |
| `NODE_ENV=development HUSKY=0 npm ci --include=dev --no-audit --no-fund` at repo root (all workspaces; comment 775–789 explains why dev deps are forced) | 781 | yes |
| `packages/shared && npx tsc` (declaration-only, `dist/*.d.ts` for type-checking; runtime imports resolve to `src/*.ts` via `packages/shared/package.json` exports and tsconfig paths, `web/tsconfig.json:22-24`, `scraper/tsconfig.json:9`) | 782 | yes (typescript) |
| `web && npm run build` (Next; `output: 'standalone'` is NOT set, `web/next.config.mjs` 1–121) | 783 | yes |
| Python venv: `python3 -m venv` (858), `pip install -r scraper/scripts/requirements.txt -c requirements-constraints.txt` (870), smoke import (894), atomic swap (961–990) | 830–993 | n/a (stays on the VPS) |
| `atomic_flip_current()` (`mv -Tf`) | 708–716 | no |
| pm2 restart (flags inline in the script; no ecosystem file since T-407) | ~522–583 | no |

Facts that shape the design: the scraper runs from TypeScript via `tsx` in production (`scraper/package.json:6-13`; its `build` script at :27 is never invoked); `packages/shared` is consumed as source at runtime, never from `dist/`; no `engines` field, no `.nvmrc`, and the deploy script does not assert the Node version; no Playwright browsers on the VPS; the workflow (`.github/workflows/deploy-linux.yml:47`) runs entirely on the self-hosted runner and no GitHub-hosted build exists today; `actions/upload-artifact` is already used by `ci.yml`, `test.yml`, `prod-verify.yml`.

## Definition of done

1. A staging deploy and then a prod deploy complete with the deploy log showing **no** `npm ci` and **no** `next build` step executed on the VPS (the build-mode branch of the script is not taken), the served `/api/version` sha equals the artifact manifest sha, and the release directory size is measured by `du -sh` and recorded in the ledger against the threshold S1 sets from its pruned-tree measurement (not a number fixed in advance; the expectation is well under today's 3.1 GB).
2. The Node major used to build the artifact equals the Node major on the VPS, asserted by the deploy script before extraction (a mismatch is FATAL with both versions printed).
3. Every native module in the production dependency set is listed in the card's slice 1 measurement, and the artifact's smoke step loads each one on the VPS before the flip.
4. Secrets never enter the artifact: env files and certs stay symlinked on the VPS (today's step 737–750 unchanged); a CI check fails the build if any `.env*` or `certs/` path is inside the tarball.
5. Rollback: `DEPLOY_MODE=build` restores today's path unchanged and is **kept permanently as the fallback**, never deleted (lane A: deleting it plus 7-day artifact retention would leave no rollback path beyond a week that is a redeploy rather than a CI round-trip). The runbook states plainly: a rollback to a sha whose artifact has expired is either `DEPLOY_MODE=build` on that sha (today's path, ~N minutes, measured in S3) or a `workflow_dispatch` rebuild in CI then an artifact deploy (~M minutes, measured in S2); both numbers are in the runbook line before S4 flips the default.
6. One full staging soak (three real scraper cycles read, drift assert green, `npm run test:prod-verify` green against staging) before the prod release cut, on the owner's word for the prod window.

## Slices (each Tier A; sizes are source lines)

**23-S1 — pin and measure (no behaviour change; ~120 lines).** Add `engines.node` to root/web/scraper `package.json` and a `.nvmrc` matching the VPS (`node -v` read from the VPS, recorded in the ledger); make the deploy script print and assert the Node major (FATAL on mismatch). **Decide the scraper runtime dependency fork first** (lane A, read 2026-09-10 22:3x: `tsx` is in `scraper/package.json` devDependencies `^4.7.0` only, absent from `dependencies` and from root; `scripts.start` is `tsx --tsconfig tsx.tsconfig.json src/index.ts`; this is the same reason the deploy forces `--include=dev` at :775-789, so an `npm prune --omit=dev` artifact ships a scraper that cannot start). Ruling: **move `tsx` (and any other package the scraper's start path imports at runtime) to `scraper/package.json` `dependencies`**, keeping the runtime identical to today's tsx-from-source. Not chosen: shipping compiled JS via the never-invoked `build` script (changes runtime resolution: `tsc-alias`, path mapping, a second code path nobody has run in production) and a prune keep-list (rots silently). Proof of the dependency set, in S1: `npm ci --omit=dev` in a scratch dir, then start the scraper's import graph under that tree (the existing import-smoke step from #509, `Scraper import smoke (real ESM runtime)`) and `node -e "require.resolve('tsx')"` from `scraper/`; both must pass with dev deps absent. Then measure and record in the ledger: production `node_modules` size, the list of native modules (`find node_modules -name binding.gyp -o -name '*.node' | sed` to package names). Set `output: 'standalone'` in `web/next.config.mjs` **only if** a local build with it serves `/api/version` from `web/.next/standalone/server.js`; otherwise record why not and the artifact ships `web/.next` without `cache/` plus the pruned `node_modules`. Proof: the measurements, and one local build with the pinned Node that produces the served output.

**23-S2 — the build job (CI; ~200 lines of workflow + a small assembly script).** New workflow `build-artifact.yml` on GitHub-hosted `ubuntu-latest`, `workflow_dispatch` (inputs: `ref`) and called by the deploy workflow: checkout `ref`; `npm ci` (dev deps, for the build); `packages/shared && npx tsc`; `web && npm run build`; `rm -rf web/.next/cache`; `npm prune --omit=dev`; assemble `ipodhan-<sha>.tar.zst` containing the source tree (for the scraper's tsx runtime and shared `src/`), the pruned `node_modules`, `web/.next` (or `standalone` per S1), `packages/shared/dist`; write `manifest.json` (sha, node version, size, sha256 of the tarball, native module list); fail if any `.env*`, `certs/`, or `web/.next/cache` path is inside; upload with `actions/upload-artifact` (retention 7 days). Proof: one dispatched run, manifest pasted in the ledger, artifact size in the ledger; the CI step-log URL per delta 2 §2.5.

**23-S3 — artifact mode in the deploy script (~250 lines).** `DEPLOY_MODE=artifact|build`, default `build` (unchanged behaviour). In artifact mode: the workflow's first job is the S2 build (GitHub-hosted); the self-hosted job downloads the artifact by run id, verifies sha256 against the manifest, asserts Node major, extracts into the release dir in place of steps 727–733 and 775–783 (git archive, npm ci, shared tsc, next build are skipped; the venv steps 830–993, env symlinks 737–750, runtime preflight 490–510, drift assert ~1038, flip and pm2 restart are unchanged); smoke-loads every native module from the manifest before the flip. Mutation tests per guard (bad checksum, wrong Node major, `.env` inside the tarball, missing manifest), each proven to fail closed with `current` untouched. Proof: one staging deploy in artifact mode with the log showing the skipped steps, `du -sh` of the release, `/api/version` sha equal to the manifest.

**23-S4 — soak and flip (~40 lines).** Staging runs in artifact mode for one full scraper day: three real cycles read (per `docs/ops/prod-ops-recipes.md` §2), nightly floor delta with no NEW check, `test:prod-verify` green against staging. Then default `DEPLOY_MODE=artifact`, staging deploys carry it, and the next `release/prod-<date>` cut ships it on the owner's word in the deploy window. Build mode stays as the permanent fallback (DoD 5); nothing deletes it.

## Risks named, not hidden

- **Node or glibc mismatch** between `ubuntu-latest` and the VPS: S1's pin and S3's assert close it; the native-module smoke closes the rest.
- **The scraper runs from source under `tsx`**: the artifact must carry the scraper's source and `packages/shared/src`, and `tsx` must survive `npm prune --omit=dev`; S1 measures it.
- **Artifact retention** (7 days): a prod rollback older than that rebuilds from the release branch sha via `workflow_dispatch`; the runbook line says so.
- **Bandwidth**: the artifact (estimate 400–800 MB before S1 measures) is pulled by the VPS once per deploy; with s17's 15-minute cadence that is at most ~100 pulls a day worst case and typically 10–30; if S1's measurement is over 1 GB, S2 adds `zstd -19` and the ledger records the ratio.
- **Two deploy paths for one release cycle** (build and artifact): the drift assert, preflight and flip are shared code, so a divergence can only be in what lands in the release dir; the `/api/version` sha check and the native-module smoke are the equality proof.
- **The Python venv is still built on the VPS** (pip from `requirements.txt` with constraints, 830–993); it is small and already isolated, and moving it is out of scope. Say so in every proof line so nobody reads "no build on the VPS" as "no pip on the VPS".

## Detection

- CI: the S2 assembly check (no secrets, no cache in the tarball) and the manifest.
- Deploy: the checksum, Node-major and native-module gates fail closed.
- Nightly: `i_wire_or_retire` already reads served sha vs main; add one line to the deploy brief printing `DEPLOY_MODE` and the artifact run id so a build-mode fallback is visible, never silent.
