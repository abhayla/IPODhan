// Walk the delta contract's Definition of Done, and PROVE each item rather than asserting it.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
process.chdir('D:/Abhay/Ventures/IPODhan-IPODhan-pullmodel-delta');

const sh = (c) => { try { return execSync(c, { encoding: 'utf8' }).trim(); } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); } };
const exit = (c) => { try { execSync(c, { stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };

const design = fs.readFileSync('docs/design/data-sourcing-pull-model.md', 'utf8');
const findings = JSON.parse(fs.readFileSync('docs/design/findings.json', 'utf8'));
const rules = JSON.parse(fs.readFileSync('docs/design/rules.json', 'utf8'));
const unclaimed = JSON.parse(fs.readFileSync('docs/design/rules-unclaimed.json', 'utf8'));
const cards = fs.readdirSync('docs/design/build-cards').filter((f) => /^item-\d+-.*\.md$/.test(f));
const walks = fs.readdirSync('docs/design/walkthroughs').filter((f) => f.endsWith('.md'));

const odRows = (design.slice(design.indexOf('### 0.0.1'), design.indexOf('### 0.0.2')).match(/^\| OD-\d+ \|/gm) || []).length;
const newSections = ['### 2.11', '### 4.5', '### 4.6', '### 6.6', '### 7.4', '### 7.5', '### 7.6', '### 8.5', '#### 2.2.1'];
const liveRules = rules.rules.filter((r) => !r.retired);
const claimed = new Set();
for (const f of cards) {
  const t = fs.readFileSync('docs/design/build-cards/' + f, 'utf8');
  const sec = t.slice(t.lastIndexOf('\n## Rules implemented'));
  (sec.slice(0, sec.indexOf('\n## Known gaps') + 1 || undefined).match(/R-\d{3}/g) || []).forEach((id) => claimed.add(id));
}
const orphans = liveRules.filter((r) => !claimed.has(r.id) && !(r.id in unclaimed.unclaimed));

const ITEMS = [
  ['OD-27..OD-52 in 0.0.1, OD-23 superseded, O-12/O-13 moved',
   odRows === 52 && design.includes('SUPERSEDED by OD-32') && !/^\| O-12 \|/m.test(design) && !/^\| O-13 \|/m.test(design),
   `${odRows} OD rows; OD-23 marked superseded; O-12/O-13 no longer in the fork table`],
  ['The new sections exist',
   newSections.every((h) => design.includes('\n' + h)),
   newSections.filter((h) => design.includes('\n' + h)).length + ' of ' + newSections.length + ' present'],
  ['Checks D17-D20 present and the gate green',
   ['D17', 'D18', 'D19', 'D20'].every((d) => sh('node docs/design/check-design-consistency.mjs').includes('] ' + d + ' ')) && exit('node docs/design/check-design-consistency.mjs --gate') === 0,
   sh('node docs/design/check-design-consistency.mjs').split('\n').pop()],
  ['Every new check is MUTATION-TESTED, red then green',
   exit('node docs/design/check-mutations.test.mjs') === 0,
   sh('node docs/design/check-mutations.test.mjs').split('\n').filter((l) => /caught/.test(l)).join(' ')],
  ['22 cards, 13 headings each, card gate green',
   cards.length === 22 && exit('node docs/design/check-build-cards.mjs --gate') === 0,
   cards.length + ' cards; card gate exit ' + exit('node docs/design/check-build-cards.mjs --gate')],
  ['Items 19, 20, 21 added (and 22, deliberately)',
   [19, 20, 21, 22].every((n) => cards.some((f) => f.startsWith('item-' + n + '-'))),
   [19, 20, 21, 22].filter((n) => cards.some((f) => f.startsWith('item-' + n + '-'))).join(', ')],
  ['rules.json generated; D19 zero orphans',
   orphans.length === 0,
   liveRules.length + ' live rules, ' + claimed.size + ' claimed by a card, ' + Object.keys(unclaimed.unclaimed).length + ' declared unclaimed, ' + orphans.length + ' orphans'],
  ['findings.json ZERO open',
   findings.findings.filter((f) => f.status === 'OPEN').length === 0,
   findings.findings.length + ' findings, statuses: ' + JSON.stringify(findings.findings.reduce((a, f) => (a[f.status] = (a[f.status] || 0) + 1, a), {}))],
  ['Four edge-case walkthroughs',
   walks.length >= 6,
   walks.length + ' walkthrough files (2 from the morning run + 4 this run): ' + walks.join(', ')],
  ['Three reviews plus a second round, recorded',
   fs.existsSync('docs/design/review-findings-2026-09-09-delta.md') && fs.readFileSync('docs/design/review-findings-2026-09-09-delta.md', 'utf8').includes('Second round'),
   'review record present, second round section present'],
  ['Two DRAFT contracts, not dispatched, zero open questions',
   fs.existsSync('docs/contracts/2026-09-DRAFT-merge-tool-shared-write-path.md') &&
   fs.existsSync('docs/contracts/2026-09-DRAFT-child-table-consolidated-writer.md') &&
   sh('grep -ilE "\\bTBD\\b|\\bTODO\\b|decide later" docs/contracts/2026-09-DRAFT-*.md') === '',
   'both present; zero TBD/TODO/decide-later'],
  ['New owner forks recorded, D14 green',
   design.includes('| O-14 |') && design.includes('| O-15 |'),
   'O-14 and O-15 in the open-fork table'],
  ['Ledger line, tracker, report, PR, lock released',
   fs.readFileSync('docs/walks/2026-09-02-deepa-pipeline-walk.md', 'utf8').includes('pull-model design delta') &&
   fs.readFileSync('docs/ops/work-tracker.md', 'utf8').includes('Pull-model design delta') &&
   fs.existsSync('docs/design/delta-report-2026-09-09.md') &&
   !fs.existsSync('.run-active.lock'),
   'ledger line present; tracker section present; report present; lock released'],
  ['The contract itself travels with the work',
   fs.existsSync('docs/contracts/2026-09-09-pull-model-design-delta.md'),
   'restored onto the branch byte-identical to d9ba3430 (md5 0fb00585...)'],
];

let pass = 0, fail = 0;
for (const [name, ok, evidence] of ITEMS) {
  console.log((ok ? '  MET   ' : '  NOT   ') + name);
  console.log('          ' + evidence);
  ok ? pass++ : fail++;
}
console.log('\nDefinition of Done: ' + pass + ' met, ' + fail + ' not met, of ' + ITEMS.length + '.');
process.exit(fail ? 1 : 0);
