#!/usr/bin/env node
/**
 * check-migration-snapshot-chain — drizzle's migration snapshots must form ONE
 * straight line, with every journal entry backed by a snapshot.
 *
 * WHY THIS EXISTS (2026-09-10). Two migrations reached main claiming the same
 * parent snapshot:
 *
 *   20260910043758_salty_shen   (idx 36)  prevId 02d8a6d4…   adds row_key
 *   20260910121813_cooing_manta (idx 37)  prevId 02d8a6d4…   adds heading_hash
 *
 * The second was generated from a branch cut before the first landed. Both
 * merged green, because nothing compares snapshots to each other. Two things
 * then happened, and the SECOND is the dangerous one:
 *
 *   1. `npm run db:generate` began refusing to run at all, for everyone, with
 *      "are pointing to a parent snapshot … which is a collision". No new
 *      migration can be created in this repository until the chain is straight.
 *   2. The head snapshot no longer describes the real schema. cooing_manta's
 *      snapshot has no `row_key` on field_sources or data_conflicts, because it
 *      was generated before that column existed. drizzle generates by diffing
 *      schema.ts (desired) against the head snapshot (believed current), so the
 *      next migration generated from that head would try to reconcile a column
 *      schema.ts has and the snapshot does not — i.e. emit `ADD COLUMN row_key`
 *      with no IF NOT EXISTS, which fails on every slot that already has the
 *      column. A broken deploy on all slots, not silent data loss.
 *
 *      CORRECTION, recorded rather than edited away: this docblock first said
 *      the migration would emit DROP COLUMN, and a reviewer caught it. That was
 *      a consequence nobody had run — the same class this whole evening's
 *      corrections were about. The severity is deploy-blocking, not data-losing.
 *      The exact SQL is being confirmed by generating against a scratch copy of
 *      pre-fix main; the direction above follows from how drizzle diffs.
 *
 * So a broken chain is not a tidiness problem. It stops every lane from creating
 * a migration, and the head it leaves behind misdescribes the database.
 *
 * Four rules, all mechanical:
 *
 *   unique-parent   — no two snapshots may share a prevId. This is the exact
 *                     collision drizzle refuses on, caught at PR time instead.
 *   parent-exists   — every prevId is either the documented root sentinel or the
 *                     id of another snapshot in this directory.
 *   single-head     — exactly one snapshot is nobody's parent. Two heads means
 *                     two divergent histories were merged.
 *   journal-order   — where a snapshot's tag prefix IS in the journal, its parent
 *                     must sit at a LOWER idx. A parent with a higher idx means a
 *                     migration was inserted behind one that already shipped.
 *
 * Deliberately NOT a rule: "every journal entry has a snapshot". Fourteen of this
 * repository's 38 entries are hand-written repair migrations that never had one,
 * and 20260909200044 is a snapshot with no journal entry at all. Demanding a
 * one-to-one mapping would fire 24 times on a healthy repository and be switched
 * off within the week — a check nobody can act on is worse than no check.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const META = 'web/drizzle/migrations/meta';
const JOURNAL = join(META, '_journal.json');
// drizzle writes this fixed uuid as the parent of the very first snapshot.
const ROOT_SENTINEL = '00000000-0000-0000-0000-000000000000';

function die(msg) {
  console.error(`check-migration-snapshot-chain: FAIL (check error) — ${msg}`);
  process.exit(2);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    die(`${path} is not readable JSON: ${err.message}`);
  }
}

export function analyze(snapshots, journalEntries) {
  const problems = [];
  const byId = new Map();
  for (const s of snapshots) {
    if (!s.id) problems.push({ rule: 'parent-exists', detail: `${s.file} has no id` });
    if (byId.has(s.id)) {
      problems.push({
        rule: 'unique-parent',
        detail: `two snapshots share the id ${s.id}: ${byId.get(s.id).file} and ${s.file}`,
      });
    }
    byId.set(s.id, s);
  }

  const byParent = new Map();
  for (const s of snapshots) {
    if (!byParent.has(s.prevId)) byParent.set(s.prevId, []);
    byParent.get(s.prevId).push(s);
  }
  for (const [parent, kids] of byParent) {
    if (kids.length > 1) {
      problems.push({
        rule: 'unique-parent',
        detail:
          `${kids.length} snapshots claim the same parent ${parent}: ` +
          `${kids.map(k => k.file).join(', ')}. The later one was generated from a branch ` +
          `cut before the earlier one landed, so it does not contain the earlier one's columns.`,
      });
    }
  }

  for (const s of snapshots) {
    if (s.prevId !== ROOT_SENTINEL && !byId.has(s.prevId)) {
      problems.push({
        rule: 'parent-exists',
        detail: `${s.file} names parent ${s.prevId}, which is no snapshot in ${META}`,
      });
    }
  }

  const parents = new Set(snapshots.map(s => s.prevId));
  const heads = snapshots.filter(s => !parents.has(s.id));
  if (snapshots.length > 0 && heads.length !== 1) {
    problems.push({
      rule: 'single-head',
      detail:
        `${heads.length} head snapshot(s) (a head is one nobody names as parent): ` +
        `${heads.map(h => h.file).join(', ') || '(none — the chain is a cycle)'}`,
    });
  }

  // Chain order must agree with journal order: walking parents from the head
  // should visit tags in decreasing idx.
  if (heads.length === 1 && problems.every(p => p.rule !== 'unique-parent')) {
    // A snapshot file is named after the tag's FIRST token: journal tag
    // "20260910043758_salty_shen" is stored as "20260910043758_snapshot.json".
    const idxOfTag = new Map(journalEntries.map(e => [`${String(e.tag).split('_')[0]}_snapshot.json`, e.idx]));
    let cur = heads[0];
    let guard = snapshots.length + 1;
    while (cur && guard-- > 0) {
      const parent = byId.get(cur.prevId);
      if (!parent) break;
      const a = idxOfTag.get(cur.file);
      const b = idxOfTag.get(parent.file);
      if (a !== undefined && b !== undefined && b >= a) {
        problems.push({
          rule: 'journal-order',
          detail: `${cur.file} (idx ${a}) names ${parent.file} (idx ${b}) as parent — a parent must have a LOWER idx`,
        });
      }
      cur = parent;
    }
  }

  return problems;
}

function main() {
  if (!existsSync(META)) die(`${META} not found — wrong working directory?`);
  const journal = readJson(JOURNAL);
  const entries = Array.isArray(journal.entries) ? journal.entries : [];
  const files = readdirSync(META).filter(f => f.endsWith('_snapshot.json'));

  // Hollow-observable floors: this check must not be able to pass by measuring
  // nothing, which is the same failure mode it exists to catch.
  if (files.length === 0) die(`scanned 0 snapshots in ${META} — a zero-file scan cannot fail`);
  if (entries.length === 0) die(`${JOURNAL} lists zero migrations — an empty journal cannot fail`);

  const snapshots = files.map(f => {
    const s = readJson(join(META, f));
    return { file: f, id: s.id, prevId: s.prevId };
  });

  const problems = analyze(snapshots, entries);

  console.log(
    `check-migration-snapshot-chain: ${snapshots.length} snapshot(s), ${entries.length} journal entry/entries`
  );

  if (problems.length > 0) {
    console.error(`check-migration-snapshot-chain: FAIL — ${problems.length} problem(s) in the migration chain:`);
    for (const p of problems) console.error(`  [${p.rule}] ${p.detail}`);
    console.error(
      '\nA branch that adds a migration must be rebased onto main and its migration REGENERATED ' +
        '(delete the .sql and the _snapshot.json, then `npm run db:generate`), not merged with the ' +
        'snapshot it produced against the older base.'
    );
    process.exit(1);
  }

  console.log('check-migration-snapshot-chain: PASS — one straight chain, one head, every parent present');
}

if (process.argv[1] && process.argv[1].endsWith('check-migration-snapshot-chain.mjs')) main();
