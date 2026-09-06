#!/usr/bin/env node
// scripts/audit-findings-to-issues.mjs — recurrence loop, part 2.
//
// Reads scripts/audit-detection-floor.mjs's findings-latest.json (every FAIL
// and UNVERIFIABLE check from tonight's run) and syncs ONE GitHub issue per
// check: create on first sighting, comment only when the failing row-key set
// actually changed, close-with-comment when the check goes back to PASS. A
// human-closed issue (won't-fix / accepted legacy) is never reopened or
// recreated — see planIssueSync() below.
//
// FAIL-OPEN BY DESIGN. This runs as a step in scripts/vps-data-audit-cron.sh
// AFTER the audit itself has already run and already paged the Notifier. If
// `gh` is missing, not logged in, the network is down, or the API cap is
// reached, this script prints a one-line reason and exits 0 — it must never
// turn a healthy (or already-alerted) audit run into a failed cron run.
//
// Usage:
//   node scripts/audit-findings-to-issues.mjs [--dry-run] [--repo owner/name]
//     [--max-issues 30] [findings-file-path]
//
//   --dry-run     print every `gh` command this run WOULD execute, make no
//                 real calls, exit 0, and leave issues-sync-state.json
//                 UNTOUCHED (a dry run must not desync state from reality).
//                 Use for the first night on the box (AUDIT_ISSUES_DRY_RUN=1
//                 sets this from the cron script).
//   --repo        override the repo slug (default: read from git remote,
//                 falling back to abhayla/IPODhan)
//   --max-issues  safety cap on how many checks get a create/comment/close
//                 action in one run (default 30); extra checks are logged,
//                 not filed, so a single bad night cannot open dozens of
//                 issues in one shot.
//
// State: <STATE_DIR>/issues-sync-state.json — { [checkId]: { issueNumber,
// firstSeen, lastRowKeys, closedAt? } }. Lives next to findings-latest.json so
// the two files travel together on the box. A closed entry is KEPT (never
// deleted) — deleting it on close was the M1 bug: it made a PASS->FAIL flap
// open a brand-new issue every cycle instead of recognizing the same check.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

export const NIGHTLY_AUDIT_LABEL = 'nightly-audit';
export const NEEDS_DECISION_LABEL = 'needs-decision';
export const PIPELINE_FAILURE_LABEL = 'pipeline-failure';
export const DEFAULT_MAX_ISSUES = 30;
export const TOP_ROWS_IN_BODY = 20;

// ---------------------------------------------------------------------------
// Pure planning function — NO side effects. Given tonight's findings, EVERY
// nightly-audit-labeled issue regardless of state (open AND closed — M1: a
// human-closed "won't fix" issue must never be silently recreated), and
// yesterday's sync state, decide what to do for every check. The runner below
// is the only thing that actually calls `gh`.
//
//   findings         — { [checkId]: { status, name, detail, rows: [{rowKey,
//                        title, body}], registryRow, severity } }
//   issues           — [{ number, title, state: 'OPEN'|'CLOSED' }] (from
//                        `gh issue list --state all`)
//   previousState    — { [checkId]: { issueNumber, firstSeen, lastRowKeys,
//                        closedAt? } }
//   today            — 'YYYY-MM-DD' (for firstSeen / "PASS on <date>")
//
// Returns: [{ type: 'create'|'comment'|'close'|'skip', checkId, ...}]
// A 'comment' action carries `targetState: 'OPEN'|'CLOSED'` so the runner
// renders the right body and never issues a reopen.
export function planIssueSync({ findings, issues, openIssues, previousState, today, maxIssues = DEFAULT_MAX_ISSUES }) {
  // Back-compat: earlier tests/callers may still pass `openIssues` (an
  // open-only list). Prefer the new `issues` (all states) when given.
  const allIssues = issues || openIssues || [];
  const actions = [];
  const titleFor = (checkId, name) => `[nightly-audit] ${checkId}: ${name}`;
  const findIssueByTitle = (title) => allIssues.find((i) => i.title === title);

  let budget = maxIssues;
  const checkIds = Object.keys(findings).sort();

  for (const checkId of checkIds) {
    const finding = findings[checkId];
    const prevEntry = previousState[checkId];
    const title = titleFor(checkId, finding.name);
    const issue = findIssueByTitle(title) || (prevEntry?.issueNumber
      ? allIssues.find((i) => i.number === prevEntry.issueNumber)
      : undefined);
    const rowKeys = (finding.rows || []).map((r) => r.rowKey).sort();
    const isBad = finding.status === 'FAIL' || finding.status === 'UNVERIFIABLE';

    if (!isBad) {
      // Now PASS. Close an OPEN issue if one exists. A CLOSED issue (already
      // resolved, by us or by a human) needs nothing further.
      if (issue && issue.state === 'OPEN') {
        actions.push({
          type: 'close', checkId, issueNumber: issue.number,
          comment: `PASS on ${today}.`,
        });
      } else {
        actions.push({ type: 'skip', checkId, reason: issue ? 'PASS, issue already closed' : 'PASS, no issue' });
      }
      continue;
    }

    // FAIL or UNVERIFIABLE from here.
    if (budget <= 0) {
      actions.push({ type: 'skip', checkId, reason: `max-issues cap (${maxIssues}) reached` });
      continue;
    }

    if (!issue) {
      actions.push({
        type: 'create', checkId, title,
        firstSeen: prevEntry?.firstSeen || today,
        rowKeys, finding,
      });
      budget -= 1;
      continue;
    }

    const prevRowKeys = prevEntry?.lastRowKeys || [];
    const prevSet = new Set(prevRowKeys);
    const nowSet = new Set(rowKeys);
    const newKeys = rowKeys.filter((k) => !prevSet.has(k));
    const resolvedKeys = prevRowKeys.filter((k) => !nowSet.has(k));
    const unchanged = newKeys.length === 0 && resolvedKeys.length === 0;

    if (issue.state === 'CLOSED') {
      // M1: never reopen a human-closed issue. Only speak up when the row-key
      // set actually moved since the state we last recorded for it.
      if (unchanged) {
        actions.push({ type: 'skip', checkId, reason: 'still failing, issue closed by a human, rows unchanged — not reopening', issueNumber: issue.number });
      } else {
        actions.push({
          type: 'comment', checkId, issueNumber: issue.number, targetState: 'CLOSED',
          newKeys, resolvedKeys, rowKeys, finding,
        });
        budget -= 1;
      }
      continue;
    }

    // OPEN issue.
    if (unchanged) {
      actions.push({ type: 'skip', checkId, reason: 'unchanged row-key set', issueNumber: issue.number });
      continue;
    }

    actions.push({
      type: 'comment', checkId, issueNumber: issue.number, targetState: 'OPEN',
      newKeys, resolvedKeys, rowKeys, finding,
    });
    budget -= 1;
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Body rendering (pure, testable independent of gh).

function classifyLabel(checkId, registry) {
  const entry = registry?.[checkId];
  return entry?.fixType === 'data-repair' ? NEEDS_DECISION_LABEL : PIPELINE_FAILURE_LABEL;
}

function resolveClassifyLabel(checkId, finding, registry) {
  if (finding.status === 'UNVERIFIABLE') return NEEDS_DECISION_LABEL;
  return classifyLabel(checkId, registry);
}

function renderRows(rows) {
  if (!rows || rows.length === 0) return '_(no row detail captured)_';
  return rows.slice(0, TOP_ROWS_IN_BODY).map((r) => `- **${r.title}**${r.body ? ` — ${r.body}` : ''}`).join('\n');
}

export function renderIssueBody({ checkId, finding, firstSeen, runDate, logPath, registryRow, severity }) {
  const lines = [];
  lines.push(`**Check:** \`${checkId}\` — ${finding.name}`);
  lines.push(`**Status:** ${finding.status}${severity ? ` (severity ${severity})` : ''}`);
  lines.push(`**Detail:** ${finding.detail || '(none)'}`);
  if (finding.status === 'UNVERIFIABLE') {
    lines.push('');
    lines.push('This check was BLIND on the run below (its dependency or oracle was unreachable) — the audit could not confirm PASS or FAIL, which is not the same as healthy.');
  }
  lines.push('');
  lines.push(`**First seen:** ${firstSeen}`);
  lines.push(`**Run date:** ${runDate}`);
  if (registryRow) lines.push(`**Failure-class registry:** ${registryRow}`);
  lines.push('');
  lines.push(`**Top ${Math.min(TOP_ROWS_IN_BODY, (finding.rows || []).length)} of ${(finding.rows || []).length} row(s):**`);
  lines.push(renderRows(finding.rows));
  if (logPath) {
    lines.push('');
    lines.push(`**Run log:** \`${logPath}\``);
  }
  lines.push('');
  lines.push('Closed automatically when the check passes.');
  return lines.join('\n');
}

export function renderCommentBody({ newKeys, resolvedKeys, finding, runDate, targetState }) {
  const lines = targetState === 'CLOSED'
    ? [`Still failing on ${runDate} (status: ${finding.status}) — rows changed since this issue was closed. NOT reopening automatically; a human closed this.`]
    : [`Row-key set changed on ${runDate} (status: ${finding.status}).`];
  if (newKeys.length) lines.push(`\n**New (${newKeys.length}):**\n` + newKeys.map((k) => `- \`${k}\``).join('\n'));
  if (resolvedKeys.length) lines.push(`\n**Resolved (${resolvedKeys.length}):**\n` + resolvedKeys.map((k) => `- \`${k}\``).join('\n'));
  lines.push(`\n${finding.detail || ''}`.trimEnd());
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Runner — the only place that touches `gh`. Every invocation is an argv
// array via execFile, never a shell string (security-baseline.md: never
// concatenate untrusted strings into an interpreted context). Issue/comment
// BODIES go through a temp file + `--body-file`, never `--body <string>` —
// bodies carry DB content (company names, dates, values) and a `--body`
// argv value is visible in `ps` output and gets echoed verbatim into any
// execFile error message; `--body-file` avoids both.

function log(msg) { console.log(`[audit-findings-to-issues] ${msg}`); }

async function ghAvailable() {
  try {
    await execFileAsync('gh', ['auth', 'status'], { timeout: 10000 });
    return true;
  } catch (e) {
    return false;
  }
}

async function withBodyFile(body, fn) {
  const path = join(tmpdir(), `audit-issue-body-${process.pid}-${randomBytes(6).toString('hex')}.md`);
  writeFileSync(path, body, 'utf8');
  try {
    return await fn(path);
  } finally {
    try { unlinkSync(path); } catch { /* best-effort cleanup */ }
  }
}

const MANAGED_LABELS = [
  { name: NIGHTLY_AUDIT_LABEL, color: 'B60205', description: 'Filed by the nightly data-integrity audit cron' },
  { name: NEEDS_DECISION_LABEL, color: '5319E7', description: 'A human decides the fix (e.g. a data repair), not a straight code change' },
  { name: PIPELINE_FAILURE_LABEL, color: 'D93F0B', description: 'Broken pipeline machinery — fixable in code' },
];

// M2: all three labels this script ever attaches must be ensured up front —
// `needs-decision` and `pipeline-failure` are pre-existing repo labels, but
// nothing previously guaranteed they exist, so a deleted/renamed label made
// every `gh issue create --label <that>` fail silently, forever. Returns the
// number of labels that failed to ensure (0 in the healthy case) so main()
// can report an aggregate ISSUES-DEGRADED line without failing the run.
async function ensureLabels(repo, dryRun) {
  let failures = 0;
  for (const l of MANAGED_LABELS) {
    const args = ['label', 'create', l.name, '--repo', repo, '--color', l.color, '--description', l.description, '--force'];
    if (dryRun) { log(`DRY-RUN: gh ${args.join(' ')}`); continue; }
    try { await execFileAsync('gh', args, { timeout: 15000 }); }
    catch (e) { failures += 1; log(`label ensure failed for "${l.name}" (non-fatal): ${e.message}`); }
  }
  return failures;
}

// M1: `--state all` — an issue a human closed must still be found by title so
// it is never recreated. `state` in the returned JSON is what planIssueSync
// uses to tell OPEN from CLOSED.
async function listIssues(repo) {
  const { stdout } = await execFileAsync('gh',
    ['issue', 'list', '--repo', repo, '--label', NIGHTLY_AUDIT_LABEL, '--state', 'all',
      '--json', 'number,title,state', '--limit', '200'],
    { timeout: 20000 });
  return JSON.parse(stdout);
}

async function resolveRepoSlug(cliRepo) {
  if (cliRepo) return cliRepo;
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url'], { cwd: REPO_ROOT, timeout: 5000 });
    const m = stdout.trim().match(/[:/]([^/]+\/[^/]+?)(\.git)?$/);
    if (m) return m[1];
  } catch { /* fall through to default */ }
  return 'abhayla/IPODhan';
}

// Returns true on success, false on failure (caller aggregates into the
// ISSUES-DEGRADED count) — never throws, so one bad action never stops the
// rest of the run.
async function applyAction(action, { repo, dryRun, registry, runDate, logPath }) {
  if (action.type === 'skip') { log(`SKIP ${action.checkId}: ${action.reason}`); return true; }

  try {
    if (action.type === 'create') {
      const label = resolveClassifyLabel(action.checkId, action.finding, registry);
      const registryRow = registry?.[action.checkId]?.registryRow;
      const severity = registry?.[action.checkId]?.severity;
      const body = renderIssueBody({
        checkId: action.checkId, finding: action.finding, firstSeen: action.firstSeen,
        runDate, logPath, registryRow, severity,
      });
      if (dryRun) { log(`DRY-RUN: gh issue create --repo ${repo} --title "${action.title}" --label ${NIGHTLY_AUDIT_LABEL} --label ${label} --body-file <tmp> (body ${body.length} chars)`); return true; }
      await withBodyFile(body, async (bodyFile) => {
        const args = ['issue', 'create', '--repo', repo, '--title', action.title,
          '--label', NIGHTLY_AUDIT_LABEL, '--label', label, '--body-file', bodyFile];
        const { stdout } = await execFileAsync('gh', args, { timeout: 20000 });
        log(`created issue for ${action.checkId}: ${stdout.trim()}`);
      });
      return true;
    }

    if (action.type === 'comment') {
      const body = renderCommentBody({
        newKeys: action.newKeys, resolvedKeys: action.resolvedKeys, finding: action.finding, runDate,
        targetState: action.targetState,
      });
      if (dryRun) { log(`DRY-RUN: gh issue comment ${action.issueNumber} --repo ${repo} --body-file <tmp> (body ${body.length} chars)`); return true; }
      await withBodyFile(body, async (bodyFile) => {
        const args = ['issue', 'comment', String(action.issueNumber), '--repo', repo, '--body-file', bodyFile];
        await execFileAsync('gh', args, { timeout: 20000 });
        log(`commented on #${action.issueNumber} (${action.targetState}) for ${action.checkId} (${action.newKeys.length} new, ${action.resolvedKeys.length} resolved)`);
      });
      return true;
    }

    if (action.type === 'close') {
      const args = ['issue', 'close', String(action.issueNumber), '--repo', repo, '--comment', action.comment];
      if (dryRun) { log(`DRY-RUN: gh ${args.join(' ')}`); return true; }
      await execFileAsync('gh', args, { timeout: 20000 });
      log(`closed #${action.issueNumber} for ${action.checkId}: ${action.comment}`);
      return true;
    }
  } catch (e) {
    log(`action failed for ${action.checkId} (${action.type}): ${e.message} — continuing with remaining checks`);
    return false;
  }
  return true;
}

function loadFindingsFile(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  // Normalize into { [checkId]: { status, name, detail, rows } }
  const byId = {};
  for (const r of raw.results || []) {
    byId[r.id] = { status: r.status, name: r.name, detail: r.detail, rows: raw.findings?.[r.id] || [] };
  }
  return { runDate: raw.runDate, findings: byId };
}

function loadRegistry(path) {
  if (!existsSync(path)) return {};
  try {
    const json = JSON.parse(readFileSync(path, 'utf8'));
    const out = {};
    for (const c of json.checks || []) {
      out[c.id] = {
        severity: c.severity,
        registryRow: c.registryRow || null,
        // No project-wide "fix type" taxonomy exists yet in detection-checks.json
        // (only one row currently carries `registryRow`). Until that lands,
        // classify conservatively: a check whose finding is about DATA ALREADY
        // STORED wrong (issue_size/lot-band/corporate-action-shape/segment/
        // sector rows) is a data-repair decision for a human; a check about the
        // PIPELINE MACHINERY (routes, freshness, step ledger, pm2, wire-or-retire,
        // NSE cross-check, document-state) is a pipeline-failure a worker fixes
        // in code. UNVERIFIABLE always needs a human decision regardless of id.
        fixType: DATA_REPAIR_CHECK_IDS.has(c.id) ? 'data-repair' : 'pipeline',
      };
    }
    return out;
  } catch (e) {
    log(`could not parse ${path}: ${e.message} — proceeding with no registry metadata`);
    return {};
  }
}

// See loadRegistry() comment above for the rationale. A test asserts every id
// here is a real check in docs/reviews/detection-checks.json.
export const DATA_REPAIR_CHECK_IDS = new Set([
  'c_issue_size_floor', 'c_issue_size_consistency',
  'd_lot_band_window', 'd_corporate_action_shape',
  'j_sector_populated', 'j_segment_not_null',
  'j_dead_source_retire_by',
  'm_brlm_count', 'm_document_type_classifier',
]);

function parseArgs(argv) {
  const opts = { dryRun: process.env.AUDIT_ISSUES_DRY_RUN === '1', maxIssues: DEFAULT_MAX_ISSUES, repo: null, findingsPath: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--repo') opts.repo = argv[++i];
    else if (a === '--max-issues') opts.maxIssues = parseInt(argv[++i], 10);
    else if (!a.startsWith('--')) opts.findingsPath = a;
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const available = await ghAvailable();
  if (!available) {
    console.log('ISSUES-SKIP: gh not installed or not authenticated — see `gh auth status`');
    process.exit(0);
  }

  const STATE_DIR = process.env.DETECTION_FLOOR_STATE_DIR
    || (existsSync('/root/data-audit-ipodhan/state') ? '/root/data-audit-ipodhan/state' : tmpdir());
  const findingsPath = opts.findingsPath || join(STATE_DIR, 'findings-latest.json');
  const syncStatePath = join(STATE_DIR, 'issues-sync-state.json');
  const registryPath = join(REPO_ROOT, 'docs', 'reviews', 'detection-checks.json');

  if (!existsSync(findingsPath)) {
    console.log(`ISSUES-SKIP: no findings file at ${findingsPath} — audit-detection-floor.mjs has not run yet tonight`);
    process.exit(0);
  }

  let loaded;
  try {
    loaded = loadFindingsFile(findingsPath);
  } catch (e) {
    console.log(`ISSUES-SKIP: could not parse ${findingsPath}: ${e.message}`);
    process.exit(0);
  }

  // M3: a findings file from a PRIOR run (e.g. tonight's audit crashed before
  // it could rewrite the file) must never be synced as if it were tonight's
  // result — that can close an issue on a stale PASS that no longer holds.
  const today = new Date().toISOString().slice(0, 10);
  if (loaded.runDate !== today) {
    console.log(`ISSUES-SKIP: findings runDate ${loaded.runDate} is not today (${today})`);
    process.exit(0);
  }

  const registry = loadRegistry(registryPath);
  const previousState = existsSync(syncStatePath)
    ? JSON.parse(readFileSync(syncStatePath, 'utf8'))
    : {};

  const repo = await resolveRepoSlug(opts.repo);

  let degradedCount = 0;
  let issues;
  try {
    degradedCount += await ensureLabels(repo, opts.dryRun);
    issues = opts.dryRun ? [] : await listIssues(repo);
  } catch (e) {
    console.log(`ISSUES-SKIP: gh call failed: ${e.message}`);
    process.exit(0);
  }

  // Only FAIL/UNVERIFIABLE checks are candidates for create, but a check that
  // WAS bad and is now PASS still needs to be considered for close — so pass
  // every check's finding through, planIssueSync() decides.
  const actions = planIssueSync({
    findings: loaded.findings,
    issues,
    previousState,
    today: loaded.runDate,
    maxIssues: opts.maxIssues,
  });

  const logPath = join(STATE_DIR, `run-${loaded.runDate}.log`);
  for (const action of actions) {
    const ok = await applyAction(action, { repo, dryRun: opts.dryRun, registry, runDate: loaded.runDate, logPath });
    if (!ok) degradedCount += 1;
  }

  // Minor (a): a dry run must not mutate state — it is a preview, not a sync.
  if (opts.dryRun) {
    console.log(`[audit-findings-to-issues] done: ${actions.length} action(s) planned [dry-run, state untouched]`);
    if (degradedCount > 0) console.log(`ISSUES-DEGRADED: ${degradedCount} action(s) failed`);
    process.exit(0);
  }

  // Persist next state from the actions actually taken. Closed entries are
  // KEPT (M1) with a closedAt stamp, never deleted — deleting them was what
  // made a PASS->FAIL flap open a brand-new issue every cycle.
  const nextState = { ...previousState };
  for (const action of actions) {
    if (action.type === 'create') {
      nextState[action.checkId] = { issueNumber: null, firstSeen: action.firstSeen, lastRowKeys: action.rowKeys };
    } else if (action.type === 'comment') {
      nextState[action.checkId] = { ...nextState[action.checkId], lastRowKeys: action.rowKeys };
    } else if (action.type === 'close') {
      nextState[action.checkId] = { ...nextState[action.checkId], issueNumber: action.issueNumber, closedAt: loaded.runDate };
    }
  }
  // Re-resolve real issue numbers for creates from a fresh list.
  try {
    const refreshed = await listIssues(repo);
    for (const checkId of Object.keys(nextState)) {
      if (nextState[checkId]?.issueNumber == null) {
        const finding = loaded.findings[checkId];
        const title = `[nightly-audit] ${checkId}: ${finding?.name || ''}`;
        const match = refreshed.find((i) => i.title === title);
        if (match) nextState[checkId].issueNumber = match.number;
      }
    }
  } catch (e) {
    log(`could not refresh issue numbers after sync: ${e.message}`);
  }

  try {
    writeFileSync(syncStatePath, JSON.stringify(nextState, null, 2));
  } catch (e) {
    log(`could not persist ${syncStatePath}: ${e.message} — next run may re-create/re-comment`);
  }

  console.log(`[audit-findings-to-issues] done: ${actions.length} action(s) (${actions.filter((a) => a.type !== 'skip').length} applied to GitHub)`);
  if (degradedCount > 0) console.log(`ISSUES-DEGRADED: ${degradedCount} action(s) failed`);
  process.exit(0);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMain || process.argv[1]?.endsWith('audit-findings-to-issues.mjs')) {
  main().catch((e) => { console.log(`ISSUES-SKIP: unexpected error: ${e.stack || e.message}`); process.exit(0); });
}
