#!/usr/bin/env node
/**
 * Pre-commit secret scan — blocks commits whose ADDED lines contain
 * credential-shaped content. Deterministic gate behind GitHub issue #1
 * (leaked VPS Postgres password). Append `secret-scan:allow` to a line
 * to deliberately exempt it (e.g. documented dummy values).
 */
const { execSync } = require('child_process');

// Placeholder shapes that are NOT secrets: <db-password>, ${VAR}, %VAR%,
// process.env.X, your_password-style docs values, asterisk masking.
const PLACEHOLDER = /<[^>]+>|\$\{[^}]+\}|%[A-Z_]+%|process\.env|your_|example|changeme|\*{3,}/i;

const RULES = [
  {
    name: 'connection string with embedded password',
    re: /(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^/\s:'"]+:([^@\s'"]{4,})@/i,
    secretGroup: 2,
  },
  {
    name: 'PGPASSWORD literal',
    re: /PGPASSWORD\s*=\s*["']?([^\s"';|&]{4,})/,
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

const diff = execSync('git diff --cached --unified=0 --no-color', {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

let file = '';
const hits = [];
for (const line of diff.split('\n')) {
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
    if (candidate && PLACEHOLDER.test(candidate)) continue;
    if (PLACEHOLDER.test(added) && !candidate) continue;
    hits.push({ file, rule: rule.name });
  }
}

if (hits.length) {
  console.error('\nSECRET SCAN FAILED — commit blocked. Suspected credentials in staged changes:');
  for (const h of hits) console.error(`  - ${h.file}: ${h.rule}`);
  console.error(
    '\nMove the value to an env var (.env is gitignored). For a deliberate dummy value,\nappend `secret-scan:allow` to the line. Never commit real credentials — see issue #1.'
  );
  process.exit(1);
}
process.exit(0);
