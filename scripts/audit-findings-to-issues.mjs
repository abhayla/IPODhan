#!/usr/bin/env node
// scripts/audit-findings-to-issues.mjs — recurrence loop, part 2.
//
// Reads scripts/audit-detection-floor.mjs's findings-latest.json (every FAIL
// and UNVERIFIABLE check from tonight's run) and syncs ONE GitHub issue per
// check: create on first sighting, comment only when the failing row-key set
// actually changed, close-with-comment when the check goes back to PASS.
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
//                 real calls, exit 0. Use for the first night on the box
//                 (AUDIT_ISSUES_DRY_RUN=1 sets this from the cron script).
//   --repo        override the repo slug (default: read from git remote,
//                 falling back to abhayla/IPODhan)
//   --max-issues  safety cap on how many checks get a create/comment/close
//                 action in one run (default 30); extra checks are logged,
//                 not filed, so a single bad night cannot open dozens of
//                 issues in one shot.
//
// State: <STATE_DIR>/issues-sync-state.json — { [checkId]: { issueNumber,
// firstSeen, lastRowKeys } }. Lives next to findings-latest.json so the two
// files travel together on the box.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

export const NIGHTLY_AUDIT_LABEL = 'nightly-audit';
export const DEFAULT_MAX_ISSUES = 30;
export const TOP_ROWS_IN_BODY = 20;

// ---------------------------------------------------------------------------
// Pure planning function — NO side effects. Given tonight's findings, the
// currently-open `nightly-audit`-labeled issues, and yesterday's sync state,
// decide what to do for every check. The runner below is the only thing that
// actually calls `gh`.
//
//   findings         — { [checkId]: { status, name, detail, rows: [{rowKey,
//                        title, body}], registryRow, severity } }
//   openIssues       — [{ number, title }] (from `gh issue list`)
//   previousState    — { [checkId]: { issueNumber, firstSeen, lastRowKeys } }
//   today            — 'YYYY-MM-DD' (for firstSeen / "PASS on <date>")
//
// Returns: [{ type: 'create'|'comment'|'close'|'skip', checkId, ...}]
export function planIssueSync({ findings, openIssues, previousState, today, maxIssues = DEFAULT_MAX_ISSUES }) {
  const actions = [];
  const titleFor = (checkId, name) => `[nightly-audit] ${checkId}: ${name}`;
  const findOpenIssueByTitle = (title) => openIssues.find((i) => i.title === title);

  let budget = maxIssues;
  const checkIds = Object.keys(findings).sort();

  for (const checkId of checkIds) {
    const finding = findings[checkId];
    const prevEntry = previousState[checkId];
    const title = titleFor(checkId, finding.name);
    const openIssue = findOpenIssueByTitle(title) || (prevEntry?.issueNumber
      ? openIssues.find((i) => i.number === prevEntry.issueNumber)
      : undefined);
    const rowKeys = (finding.rows || []).map((r) => r.rowKey).sort();
    const isBad = finding.status === 'FAIL' || finding.status === 'UNVERIFIABLE';

    if (!isBad) {
      // Now PASS. Close an open issue if one exists; otherwise nothing to do.
      if (openIssue) {
        actions.push({
          type: 'close', checkId, issueNumber: openIssue.number,
          comment: `PASS on ${today}.`,
        });
      } else {
        actions.push({ type: 'skip', checkId, reason: 'PASS, no open issue' });
      }
      continue;
    }

    // FAIL or UNVERIFIABLE from here.
    if (budget <= 0) {
      actions.push({ type: 'skip', checkId, reason: `max-issues cap (${maxIssues}) reached` });
      continue;
    }

    if (!openIssue) {
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

    if (newKeys.length === 0 && resolvedKeys.length === 0) {
      actions.push({ type: 'skip', checkId, reason: 'unchanged row-key set', issueNumber: openIssue.number });
      continue;
    }

    actions.push({
      type: 'comment', checkId, issueNumber: openIssue.number,
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
  return entry?.fixType === 'data-repair' ? 'needs-decision' : 'pipeline-failure';
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

export function renderCommentBody({ newKeys, resolvedKeys, finding, runDate }) {
  const lines = [`Row-key set changed on ${runDate} (status: ${finding.status}).`];
  if (newKeys.length) lines.push(`\n**New (${newKeys.length}):**\n` + newKeys.map((k) => `- \`${k}\``).join('\n'));
  if (resolvedKeys.length) lines.push(`\n**Resolved (${resolvedKeys.length}):**\n` + resolvedKeys.map((k) => `- \`${k}\``).join('\n'));
  lines.push(`\n${finding.detail || ''}`.trimEnd());
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Runner — the only place that touches `gh`. Every invocation is an argv
// array via execFile, never a shell string (security-baseline.md: never
// concatenate untrusted strings into an interpreted context).

function log(msg) { console.log(`[audit-findings-to-issues] ${msg}`); }

async function ghAvailable() {
  try {
    await execFileAsync('gh', ['auth', 'status'], { timeout: 10000 });
    return true;
  } catch (e) {
    return false;
  }
}

async function ensureLabel(repo, dryRun) {
  const args = ['label', 'create', NIGHTLY_AUDIT_LABEL, '--repo', repo, '--color', 'B60205',
    '--description', 'Filed by the nightly data-integrity audit cron', '--force'];
  if (dryRun) { log(`DRY-RUN: gh ${args.join(' ')}`); return; }
  try { await execFileAsync('gh', args, { timeout: 15000 }); }
  catch (e) { log(`label create/update failed (non-fatal): ${e.message}`); }
}

async function listOpenIssues(repo) {
  const { stdout } = await execFileAsync('gh',
    ['issue', 'list', '--repo', repo, '--label', NIGHTLY_AUDIT_LABEL, '--state', 'open',
      '--json', 'number,title', '--limit', '200'],
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

async function applyAction(action, { repo, dryRun, registry, runDate, logPath }) {
  if (action.type === 'skip') { log(`SKIP ${action.checkId}: ${action.reason}`); return; }

  if (action.type === 'create') {
    const label = resolveClassifyLabel(action.checkId, action.finding, registry);
    const registryRow = registry?.[action.checkId]?.registryRow;
    const severity = registry?.[action.checkId]?.severity;
    const body = renderIssueBody({
      checkId: action.checkId, finding: action.finding, firstSeen: action.firstSeen,
      runDate, logPath, registryRow, severity,
    });
    const args = ['issue', 'create', '--repo', repo, '--title', action.title,
      '--label', NIGHTLY_AUDIT_LABEL, '--label', label, '--body', body];
    if (dryRun) { log(`DRY-RUN: gh ${args.slice(0, 5).join(' ')} ... (body ${body.length} chars)`); return; }
    const { stdout } = await execFileAsync('gh', args, { timeout: 20000 });
    log(`created issue for ${action.checkId}: ${stdout.trim()}`);
    return;
  }

  if (action.type === 'comment') {
    const body = renderCommentBody({
      newKeys: action.newKeys, resolvedKeys: action.resolvedKeys, finding: action.finding, runDate,
    });
    const args = ['issue', 'comment', String(action.issueNumber), '--repo', repo, '--body', body];
    if (dryRun) { log(`DRY-RUN: gh ${args.slice(0, 3).join(' ')} ... (body ${body.length} chars)`); return; }
    await execFileAsync('gh', args, { timeout: 20000 });
    log(`commented on #${action.issueNumber} for ${action.checkId} (${action.newKeys.length} new, ${action.resolvedKeys.length} resolved)`);
    return;
  }

  if (action.type === 'close') {
    const args = ['issue', 'close', String(action.issueNumber), '--repo', repo, '--comment', action.comment];
    if (dryRun) { log(`DRY-RUN: gh ${args.join(' ')}`); return; }
    await execFileAsync('gh', args, { timeout: 20000 });
    log(`closed #${action.issueNumber} for ${action.checkId}: ${action.comment}`);
    return;
  }
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

// See loadRegistry() comment above for the rationale.
export const DATA_REPAIR_CHECK_IDS = new Set([
  'c_issue_size_floor', 'c_issue_size_consistency',
  'd_lot_band_window', 'd_corporate_action_shape',
  'j_sector_populated', 'j_segment_not_null',
  'j_dead_source_retire_by',
  'm_brlm_count', 'm_document_type_classifier',
]);

function resolveClassifyLabel(checkId, finding, registry) {
  if (finding.status === 'UNVERIFIABLE') return 'needs-decision';
  return classifyLabel(checkId, registry);
}

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

  const registry = loadRegistry(registryPath);
  const previousState = existsSync(syncStatePath)
    ? JSON.parse(readFileSync(syncStatePath, 'utf8'))
    : {};

  const repo = await resolveRepoSlug(opts.repo);

  let openIssues;
  try {
    await ensureLabel(repo, opts.dryRun);
    openIssues = opts.dryRun ? [] : await listOpenIssues(repo);
  } catch (e) {
    console.log(`ISSUES-SKIP: gh call failed: ${e.message}`);
    process.exit(0);
  }

  // Only FAIL/UNVERIFIABLE checks are candidates for create, but a check that
  // WAS bad and is now PASS still needs to be considered for close — so pass
  // every check's finding through, planIssueSync() decides.
  const actions = planIssueSync({
    findings: loaded.findings,
    openIssues,
    previousState,
    today: loaded.runDate || new Date().toISOString().slice(0, 10),
    maxIssues: opts.maxIssues,
  });

  const logPath = join(STATE_DIR, `run-${loaded.runDate}.log`);
  for (const action of actions) {
    try {
      await applyAction(action, { repo, dryRun: opts.dryRun, registry, runDate: loaded.runDate, logPath });
    } catch (e) {
      log(`action failed for ${action.checkId} (${action.type}): ${e.message} — continuing with remaining checks`);
    }
  }

  // Persist next state from the actions actually taken (or that would have
  // been taken, in dry-run — so a dry-run night doesn't desync state from a
  // real run the following night; dry-run is explicitly allowed to write
  // this bookkeeping file, it is local advisory state, not a GitHub call).
  const nextState = { ...previousState };
  for (const action of actions) {
    if (action.type === 'create') {
      nextState[action.checkId] = { issueNumber: opts.dryRun ? -1 : null, firstSeen: action.firstSeen, lastRowKeys: action.rowKeys };
    } else if (action.type === 'comment') {
      nextState[action.checkId] = { ...nextState[action.checkId], lastRowKeys: action.rowKeys };
    } else if (action.type === 'close') {
      delete nextState[action.checkId];
    }
  }
  // Re-resolve real issue numbers for creates from a fresh list (skip in dry-run).
  if (!opts.dryRun) {
    try {
      const refreshed = await listOpenIssues(repo);
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
  }

  try {
    writeFileSync(syncStatePath, JSON.stringify(nextState, null, 2));
  } catch (e) {
    log(`could not persist ${syncStatePath}: ${e.message} — next run may re-create/re-comment`);
  }

  console.log(`[audit-findings-to-issues] done: ${actions.length} action(s) (${actions.filter((a) => a.type !== 'skip').length} applied to GitHub${opts.dryRun ? ' [dry-run]' : ''})`);
  process.exit(0);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMain || process.argv[1]?.endsWith('audit-findings-to-issues.mjs')) {
  main().catch((e) => { console.log(`ISSUES-SKIP: unexpected error: ${e.stack || e.message}`); process.exit(0); });
}
