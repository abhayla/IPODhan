#!/usr/bin/env node
// merge-if-current - refuse a PR merge whose green is no longer evidence.
//
// THE INCIDENT (2026-09-11): PR #588 was merged on a stale green. Both
// freshness clauses had fired. The check HAD been run - but it was typed into
// the same shell command as the `gh pr merge`, so the clause output printed
// AFTER the merge decision was already committed. Main survived on luck.
//
// The rejected fix was "always run them as two separate commands". That is a
// habit, and a habit fails the first time someone is tired at 5am. This script
// is the mechanism: it computes every clause and EXITS NON-ZERO before any
// merge can happen, so the merge is gated on an exit code rather than on a
// human reading output.
//
// THIS SCRIPT NEVER MERGES. It cannot: it holds no merge code path at all, so
// there is no ordering in which a merge could precede the checks. The contract
// is a shell AND, which the shell - not a human - enforces:
//
//     node scripts/ops/merge-if-current.mjs 588 && gh pr merge 588 --squash
//
// On exit 0 it prints that exact command, ready to copy. On any refusal it
// prints nothing copy-pasteable.
//
// Usage:
//   node scripts/ops/merge-if-current.mjs <pr-number> [options]
//
//   --repo <path>        git repo to inspect (default: cwd)
//   --base <ref>         base ref to compare against (default: origin/main)
//   --no-fetch           skip `git fetch` (assumes refs are already current)
//   --no-import-scan     evaluate clause 2 with the DIRECT-OVERLAP half only.
//                        Prints a loud reduced-coverage banner. Required if
//                        the `typescript` package cannot be resolved.
//   --force --reason "<20+ chars>"   bypass; prints every fired clause and
//                        echoes the reason so it lands in the record.
//   --json               machine-readable verdict on stdout
//   --pr-json <file>     TEST MODE: read the gh payload from a file
//   --head <sha>         TEST MODE: use this head sha, do not consult gh
//
// Exit codes: 0 pass | 1 usage | 2 not mergeable | 3 checks not green
//             4 stale (a freshness clause fired) | 5 internal / gate cannot run
//
// Tests: scripts/tests/merge-freshness.test.mjs
//        scripts/tests/merge-if-current-cli.test.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

import {
  EXIT,
  classifyMergeability,
  classifyChecks,
  evaluateStaleness,
  importSpecifiers,
  loadTypeScript,
} from './lib/merge-freshness.mjs';

const PR_FIELDS = 'number,state,isDraft,mergeable,mergeStateStatus,headRefOid,headRefName,baseRefName,url,title,statusCheckRollup';

function parseArgs(argv) {
  const opts = {
    pr: null, repo: process.cwd(), base: 'origin/main', fetch: true,
    scanImports: true, force: false, reason: null, json: false,
    prJson: null, head: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--repo') opts.repo = next();
    else if (a === '--base') opts.base = next();
    else if (a === '--no-fetch') opts.fetch = false;
    else if (a === '--no-import-scan') opts.scanImports = false;
    else if (a === '--force') opts.force = true;
    else if (a === '--reason') opts.reason = next();
    else if (a === '--json') opts.json = true;
    else if (a === '--pr-json') opts.prJson = next();
    else if (a === '--head') opts.head = next();
    else if (/^\d+$/.test(a)) opts.pr = a;
    else if (a === '-h' || a === '--help') opts.help = true;
    else throw Object.assign(new Error(`unknown argument: ${a}`), { usage: true });
  }
  return opts;
}

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

function gitLines(repo, args) {
  const out = git(repo, args);
  return out ? out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
}

function loadPr(opts) {
  if (opts.prJson) return JSON.parse(readFileSync(opts.prJson, 'utf8'));
  const raw = execFileSync('gh', ['pr', 'view', opts.pr, '--json', PR_FIELDS], {
    cwd: opts.repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(raw);
}

const HR = '-'.repeat(78);
const out = [];
function say(line = '') { out.push(line); console.log(line); }

function refuse(code, heading, detail, verdict, opts) {
  say();
  say(HR);
  if (opts.force) {
    say(`FORCED PAST: ${heading}`);
    say(detail);
    say(`--reason: ${opts.reason}`);
    say('This bypass is recorded in this output. Paste it into the PR body or the ledger.');
    say(HR);
    return finish(EXIT.PASS, verdict, opts, true);
  }
  say(`REFUSED (exit ${code}): ${heading}`);
  say(detail);
  say(HR);
  return finish(code, verdict, opts, false);
}

function finish(code, verdict, opts, forced) {
  if (opts.json) {
    process.stdout.write(JSON.stringify({ ...verdict, exit: code, forced: Boolean(forced) }, null, 2) + '\n');
  }
  process.exit(code);
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    process.exit(EXIT.USAGE);
  }
  if (opts.help || (!opts.pr && !opts.prJson)) {
    console.error('usage: node scripts/ops/merge-if-current.mjs <pr-number> [--repo <path>] [--base <ref>]');
    console.error('       [--no-fetch] [--no-import-scan] [--json] [--force --reason "<20+ chars>"]');
    process.exit(EXIT.USAGE);
  }
  if (opts.force && (!opts.reason || opts.reason.trim().length < 20)) {
    console.error('--force requires --reason "<at least 20 characters>" - a bypass with no stated reason is not a bypass, it is an accident.');
    process.exit(EXIT.USAGE);
  }
  if (opts.scanImports && !loadTypeScript()) {
    console.error('Cannot run the gate: the `typescript` package is not resolvable, so clause 2 cannot');
    console.error('parse imports. Run from a checkout with node_modules installed, or pass');
    console.error('--no-import-scan to accept REDUCED coverage (direct overlap only).');
    process.exit(EXIT.INTERNAL);
  }

  const verdict = { pr: null, steps: {} };

  // -- Step 1: mergeability, FIRST ------------------------------------------
  let pr;
  try {
    pr = loadPr(opts);
  } catch (err) {
    console.error(`Could not read the PR: ${err.message}`);
    process.exit(EXIT.INTERNAL);
  }
  verdict.pr = { number: pr.number, title: pr.title, url: pr.url, head: pr.headRefOid, base: pr.baseRefName };

  say(HR);
  say(`merge-if-current  PR #${pr.number}  ${pr.title ?? ''}`);
  say(`head ${pr.headRefOid}  base ${pr.baseRefName}`);
  if (opts.prJson) say('[TEST MODE] PR metadata injected from a file - this run is NOT a live gate.');
  say(HR);

  const m = classifyMergeability(pr);
  verdict.steps.mergeability = m;
  say(`STEP 1  mergeability (checked FIRST: a conflicting PR gets NO pull_request run at all,`);
  say(`        which looks exactly like queue latency if you check CI before this)`);
  say(`        ${m.ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(m.evidence)}`);
  if (!m.ok) return refuse(EXIT.NOT_MERGEABLE, 'the PR is not in a mergeable state', m.reason, verdict, opts);

  // -- Step 2: every check is a genuine pass ---------------------------------
  const c = classifyChecks(pr.statusCheckRollup);
  verdict.steps.checks = c;
  say();
  say('STEP 2  checks ("no failures" is not a pass; an absent or CANCELLED check is not a pass)');
  for (const p of c.passes) say(`        PASS     ${p.name}`);
  for (const s of c.skipped) say(`        skipped  ${s.name}  (allowed: path-gated job, but NOT counted as a pass)`);
  for (const p of c.pending) say(`        PENDING  ${p.name} [${p.status ?? p.state}]  <- never ran / still running`);
  for (const f of c.failures) say(`        FAIL     ${f.name} [${f.conclusion ?? f.state}]`);
  if (!c.ok) return refuse(EXIT.CHECKS_NOT_GREEN, 'not every check on this PR is a genuine pass', c.reason, verdict, opts);

  // -- Steps 3 & 4: the freshness clauses ------------------------------------
  const head = opts.head || pr.headRefOid;
  if (opts.fetch) {
    try {
      git(opts.repo, ['fetch', 'origin', opts.base.replace(/^origin\//, ''), '--quiet']);
      const fetched = git(opts.repo, ['fetch', 'origin', `pull/${pr.number}/head`, '--quiet']) || '';
      void fetched;
    } catch (err) {
      console.error(`git fetch failed: ${err.message}`);
      return finish(EXIT.INTERNAL, verdict, opts, false);
    }
  }

  let baseSha;
  try {
    baseSha = git(opts.repo, ['merge-base', opts.base, head]);
  } catch (err) {
    console.error(`Could not compute merge-base(${opts.base}, ${head}): ${err.message}`);
    console.error('The PR head may not be fetched locally. Re-run without --no-fetch.');
    return finish(EXIT.INTERNAL, verdict, opts, false);
  }

  const moved = gitLines(opts.repo, ['diff', '--name-only', `${baseSha}..${opts.base}`]);
  const branchChanged = gitLines(opts.repo, ['diff', '--name-only', `${baseSha}..${head}`]);

  const unreadable = [];
  const importsOf = (file) => {
    let text;
    try {
      text = execFileSync('git', ['show', `${head}:${file}`], {
        cwd: opts.repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      });
    } catch {
      return []; // deleted on the branch - it imports nothing now
    }
    try {
      return importSpecifiers(text, file);
    } catch (err) {
      unreadable.push({ file, error: err.message });
      return [];
    }
  };

  const s = evaluateStaleness({ moved, branchChanged, importsOf, scanImports: opts.scanImports });
  verdict.steps.freshness = { ...s, baseSha, base: opts.base, head, unreadable };

  say();
  say(`STEP 3/4  freshness   merge-base ${baseSha.slice(0, 8)}`);
  say(`          ${moved.length} file(s) moved on ${opts.base} since that base; branch changes ${branchChanged.length}`);
  if (!opts.scanImports) {
    say('          !! IMPORT HALF NOT EVALUATED (--no-import-scan): clause 2 covers DIRECT OVERLAP ONLY.');
    say('          !! A change on main to a file this branch merely IMPORTS will NOT be detected.');
  }
  if (unreadable.length) {
    say(`          !! ${unreadable.length} branch file(s) could not be parsed for imports: ` +
        unreadable.map((u) => u.file).join(', '));
  }
  for (const cl of s.clauses) {
    say(`          ${cl.fired ? 'FIRED  ' : 'clear  '}${cl.id}: ${cl.title}`);
    if (cl.paths?.length) say(`                   paths: ${cl.paths.join(', ')}`);
    if (cl.overlap?.length) say(`                   overlap: ${cl.overlap.join(', ')}`);
    for (const e of cl.importEdges ?? []) {
      say(`                   import: ${e.from} -> ${e.to}  (as '${e.specifier}')`);
    }
    if (cl.fired) say(`                   why: ${cl.why}`);
  }

  if (s.required) {
    const fired = s.clauses.filter((cl) => cl.fired).map((cl) => cl.id).join(', ');
    return refuse(
      EXIT.STALE,
      `this PR's green is stale - ${fired} fired`,
      'The remedy is the same for every clause: rebase the branch onto the current base, push,\n' +
      'let CI run again against what would actually be merged, then re-run this gate.\n' +
      `  git fetch origin && git rebase ${opts.base} && git push --force-with-lease`,
      verdict, opts
    );
  }

  say();
  say(HR);
  say('PASS - every clause clear. This green is still evidence about the merge that would happen now.');
  if (!opts.scanImports) say('       (with REDUCED coverage: the import half of clause 2 was not evaluated)');
  say('Run the merge as a SEPARATE step, chained on this exit code:');
  say(`  node scripts/ops/merge-if-current.mjs ${pr.number} && gh pr merge ${pr.number} --squash`);
  say(HR);
  return finish(EXIT.PASS, verdict, opts, false);
}

main(process.argv.slice(2));
