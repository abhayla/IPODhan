#!/usr/bin/env node
/**
 * Guard: fails when a `run:` step body (PowerShell or shell) in any GitHub
 * Actions workflow contains a non-ASCII character, OR when the workflow file
 * does not parse as valid YAML.
 *
 * Root cause this prevents (non-ASCII): the self-hosted deploy runner is
 * Windows PowerShell 5.1, which reads a generated `run:` script as ANSI. A
 * multi-byte character (e.g. U+2014 EM DASH) inside that script corrupts
 * string parsing and fails the whole step before any deploy work runs
 * (see T-217). YAML comments and other non-`run:` text are NOT scanned —
 * they never reach the generated script, so non-ASCII there is harmless.
 *
 * Root cause this prevents (invalid YAML): a plain scalar `run:` value
 * containing `: ` (e.g. quoted text with a colon-space inside it) is parsed
 * by YAML as a mapping indicator, silently invalidating the whole workflow
 * file. GitHub then creates a 0-second run with zero jobs on every trigger,
 * with no pre-commit signal (deploy-linux.yml, PR #268, 2026-09-02). This
 * check parses each workflow file with a YAML library and fails loudly on
 * any parse error, before it ever reaches GitHub.
 *
 * Usage: node scripts/check-workflow-ascii.js [file ...]
 *   No args -> scans every .yml/.yaml file under .github/workflows/.
 * Exit 0 = clean. Exit 1 = at least one non-ASCII char in a run block, or a
 *          workflow file that fails to parse as YAML.
 */

const fs = require('fs');
const path = require('path');

function loadYamlParser() {
  try {
    const YAML = require('yaml');
    return (text) => YAML.parse(text);
  } catch (e1) {
    try {
      const jsYaml = require('js-yaml');
      return (text) => jsYaml.load(text);
    } catch (e2) {
      return null;
    }
  }
}

/**
 * Returns { message } if `content` fails to parse as YAML, or null if it
 * parses cleanly (or if no YAML parser is available — see main()).
 */
function findYamlParseError(content, parse) {
  try {
    parse(content);
    return null;
  } catch (err) {
    return { message: err && err.message ? err.message : String(err) };
  }
}

function findWorkflowFiles() {
  const dir = path.join(__dirname, '..', '.github', 'workflows');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => path.join(dir, f));
}

function indentOf(line) {
  const m = line.match(/^[ \t]*/);
  return m ? m[0].length : 0;
}

/**
 * Returns an array of { line, col, char, codePoint } for every character in
 * `run:` step bodies (block scalar `|`/`>` or inline) that falls outside
 * printable ASCII (0x09 tab, 0x0A/0x0D newlines, and 0x20-0x7E are allowed).
 */
function findNonAsciiInRunBlocks(content) {
  const lines = content.split(/\r\n|\n/);
  const findings = [];
  const runLineRe = /^(\s*)run:\s*([|>][-+]?)?\s*(.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(runLineRe);
    if (!m) continue;
    // Only treat as a `run:` step key if "run:" starts the trimmed content
    // (avoids matching unrelated lines that merely contain "run:" as text).
    const trimmed = line.trim();
    if (!trimmed.startsWith('run:')) continue;

    const runIndent = m[1].length;
    const blockMarker = m[2];
    const inlineRest = m[3];

    const scanChars = (text, lineNo) => {
      for (let c = 0; c < text.length; c++) {
        const code = text.codePointAt(c);
        if (code > 0x7e && code !== undefined) {
          findings.push({ line: lineNo + 1, col: c + 1, char: text[c], codePoint: code });
        }
      }
    };

    if (blockMarker) {
      // Block scalar: consume subsequent lines indented deeper than `run:`.
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        if (next.trim() === '') {
          j++;
          continue;
        }
        if (indentOf(next) <= runIndent) break;
        scanChars(next, j);
        j++;
      }
      i = j - 1;
    } else if (inlineRest) {
      scanChars(inlineRest, i);
    }
  }
  return findings;
}

function main() {
  const args = process.argv.slice(2);
  const files = args.length > 0 ? args : findWorkflowFiles();

  if (files.length === 0) {
    console.log('[check-workflow-ascii] No workflow files found — nothing to check.');
    return 0;
  }

  const parseYaml = loadYamlParser();
  if (!parseYaml) {
    console.warn(
      '[check-workflow-ascii] WARN: no YAML parser resolvable (yaml / js-yaml) — YAML validity NOT checked.'
    );
  }

  let failed = false;
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');

    if (parseYaml) {
      const yamlError = findYamlParseError(content, parseYaml);
      if (yamlError) {
        failed = true;
        console.error(`[check-workflow-ascii] FAIL ${file}: invalid YAML: ${yamlError.message}`);
      }
    }

    const findings = findNonAsciiInRunBlocks(content);
    if (findings.length > 0) {
      failed = true;
      console.error(`[check-workflow-ascii] FAIL ${file}`);
      for (const f of findings) {
        console.error(
          `  line ${f.line}, col ${f.col}: non-ASCII character U+${f.codePoint
            .toString(16)
            .toUpperCase()
            .padStart(4, '0')} ("${f.char}") inside a run: block`
        );
      }
    }
  }

  if (failed) {
    console.error(
      '\n[check-workflow-ascii] A workflow file failed a check above: either a run: ' +
        'block contains a non-ASCII character (the self-hosted deploy runner reads ' +
        'generated scripts as ANSI / Windows PowerShell 5.1 — a multi-byte character ' +
        "corrupts parsing and fails the step; replace it with a plain-ASCII equivalent " +
        "(em dash -> ' - ')), or the file is not valid YAML (a plain scalar containing " +
        "': ' is parsed as a mapping indicator — GitHub silently runs a 0-job, 0-second " +
        'workflow; use a block scalar (`run: |`) instead).'
    );
    return 1;
  }

  console.log(
    '[check-workflow-ascii] OK — no non-ASCII characters in any run: block, and every workflow file parses as valid YAML.'
  );
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { findNonAsciiInRunBlocks, findYamlParseError, loadYamlParser };
