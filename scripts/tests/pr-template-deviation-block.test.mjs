// Item 31: the PR template must carry the Spec-deviation block with all four
// fields and all four class values, so a later edit that quietly drops one
// goes red rather than unnoticed. See
// docs/design/build-cards/item-31-pr-deviation-field.md and
// docs/design/spec-deviation-guideline.md §8 mechanism 3.
//
// This does not assert that any real PR body carries the block filled in —
// that is the card's own Staging-proof-equivalent ("the rendered body of the
// first pull request opened after the merge"), read back from GitHub, not
// asserted here. This test only proves the TEMPLATE renders the block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, '..', '..', '.github', 'pull_request_template.md');

function readTemplate() {
  return readFileSync(TEMPLATE_PATH, 'utf8');
}

test('template contains the Spec deviation heading', () => {
  const text = readTemplate();
  assert.match(text, /^## Spec deviation$/m);
});

test('template contains all four required field labels', () => {
  const text = readTemplate();
  assert.match(text, /\*\*Class:\*\*/);
  assert.match(text, /\*\*Spec section:\*\*/);
  assert.match(text, /\*\*IPOs proven on \(class 2 only\):\*\*/);
  assert.match(text, /\*\*Card corrected in this PR:\*\*/);
});

test('template names all four class values, including none as a valid answer', () => {
  const text = readTemplate();
  const classLine = text.split('\n').find((l) => l.includes('**Class:**'));
  assert.ok(classLine, 'Class field line must exist');
  assert.match(classLine, /\bnone\b/);
  assert.match(classLine, /\b1 \(card defect\)/);
  assert.match(classLine, /\b2 \(minor\)/);
  assert.match(classLine, /\b3 \(major/);
});

test('Spec deviation block appears after Test plan and before Checklist', () => {
  const text = readTemplate();
  const testPlanIdx = text.indexOf('## Test plan');
  const deviationIdx = text.indexOf('## Spec deviation');
  const checklistIdx = text.indexOf('## Checklist');
  assert.ok(testPlanIdx >= 0 && deviationIdx >= 0 && checklistIdx >= 0, 'all three headings must exist');
  assert.ok(testPlanIdx < deviationIdx, 'Spec deviation must come after Test plan');
  assert.ok(deviationIdx < checklistIdx, 'Spec deviation must come before Checklist');
});
