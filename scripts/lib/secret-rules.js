/**
 * Shared secret-detection rules used by both the pre-commit staged-diff scan
 * (scripts/check-staged-secrets.js --staged, via .husky/pre-commit) and the
 * CI added-lines range scan (scripts/check-staged-secrets.js --range, via
 * .github/workflows/secret-scan.yml). One rule set, two call sites — see
 * .claude/rules/defect-fix-contract.md: a check that exists in only one path
 * catches only the writers that go through that one path.
 */

// Placeholder shapes that are NOT secrets: <db-password>, ${VAR}, %VAR%,
// process.env.X, your_password-style docs values, asterisk masking, shell/PS
// variable references ($VAR, $env:X), and the usual docs filler words.
const PLACEHOLDER =
  /<[^>]+>|\$\{[^}]+\}|%[A-Z_]+%|process\.env|your_|example|changeme|\*{3,}|^\$|^`|placeholder|redacted|dummy|REPLACE[_-]?ME|^x{3,}$/i;

// Case-SENSITIVE: a value made only of lowercase letters (`something`, `secret`,
// `yourpassword`) is docs filler, not a credential — real credentials mix
// character classes. Trades a little detection (an all-lowercase weak password
// slips through) for a gate that does not block routine documentation edits.
const FILLER_WORD = /^[a-z]+$/;

function isPlaceholder(value) {
  return PLACEHOLDER.test(value) || FILLER_WORD.test(value);
}

const RULES = [
  {
    name: 'connection string with embedded password',
    re: /(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^/\s:'"]+:([^@\s'"]{4,})@/i,
    secretGroup: 2,
  },
  {
    name: 'PGPASSWORD literal',
    // `(`/`)`/`$` excluded so code like `PGPASSWORD=unquote(u.password or "")`
    // is not mistaken for a literal.
    re: /PGPASSWORD\s*=\s*["']?([^\s"';|&()$]{4,})(?![^\s"';|&$]*\()/,
    secretGroup: 1,
  },
  {
    // The shape of the original leak (issue #1): `password: 'literal'` in a
    // client config. The connection-string rule never covered it, so the gate
    // built in response to that leak would not have caught the leak itself.
    name: 'hardcoded password assignment (quoted literal)',
    re: /\b(?:db|pg|admin|root|user)?[_-]?(?:password|passwd|pwd)\b["']?\s*[:=]\s*["']([^"'\s]{6,})["']/i,
    secretGroup: 1,
  },
  {
    // Env/shell style: `DB_PASSWORD=literal` on its own. Uppercase-anchored so
    // ordinary code (`const password = value`) is not swept up.
    name: 'hardcoded password assignment (env style)',
    re: /^[A-Z0-9_]*(?:PASSWORD|PASSWD|PWD)\s*=\s*([^\s"'#=]{6,})\s*$/,
    secretGroup: 1,
  },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    name: 'hardcoded api key/token/secret',
    re: /\b(?:api[_-]?key|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']([A-Za-z0-9_\-]{20,})["']/i,
    secretGroup: 1,
  },
];

/**
 * Scan `diff --unified=0`-shaped text (from either a staged diff or a
 * `base..head` range diff) for added lines that match a RULES entry and are
 * not a placeholder. Returns [{ file, rule }] hits; never the matched value.
 */
function scanAddedLines(diffText) {
  let file = '';
  const hits = [];
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const added = line.slice(1);
    if (added.includes('secret-scan:allow')) continue;
    for (const rule of RULES) {
      const m = added.match(rule.re);
      if (!m) continue;
      const candidate = rule.secretGroup ? m[rule.secretGroup] : null;
      if (candidate && isPlaceholder(candidate)) continue;
      if (PLACEHOLDER.test(added) && !candidate) continue;
      hits.push({ file, rule: rule.name });
    }
  }
  return hits;
}

module.exports = { RULES, PLACEHOLDER, FILLER_WORD, isPlaceholder, scanAddedLines };
