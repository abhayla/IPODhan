// local-gate-shell-allowlist.mjs — decides whether a pr-gate.yml `run:` block is
// safe to execute on a developer machine (run-discipline B8: a structural
// allow-list, not a deny-list). A block is runnable ONLY if every simple
// command in it starts with an allowed program form. Anything else is
// UNCLASSIFIED: local-pr-gate.mjs refuses to run it and the drift test fails
// until someone classifies the step.
//
// Why an allow-list: CI runs on a throwaway runner, so a step may freely do
// `git config user.email`, `gh pr comment`, `curl -X POST .../deploy`. Run on the
// owner's machine, the same lines act on the owner's git identity, GitHub login
// and servers. A deny-list needs a new entry per new danger; an allow-list
// fails closed on the dangers nobody has thought of yet.
//
// The parser is deliberately small and fail-closed: any shell feature it does
// not model (heredoc, subshell, process substitution, arithmetic, unterminated
// quote) is reported as a problem, never skipped.

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)=/;

// ---- parser ------------------------------------------------------------------
// Returns { cmds, problems, end }. cmd = { words:[{text,subs}], redirs:[{target}], line }.
// `subs` holds the parsed commands of every $( ) / backtick inside the word.
function parseShell(src, start = 0, inParen = false, baseLine = 1) {
  const cmds = [];
  const problems = [];
  let i = start;
  let line = baseLine;
  let words = [];
  let redirs = [];
  let cur = null;
  let pending = null;
  let cmdLine = line;

  const problem = (reason) => problems.push({ line, text: src.slice(Math.max(0, i - 20), i + 20).replace(/\s+/g, ' '), reason });
  const begin = () => {
    if (!cur) {
      if (!words.length && !redirs.length) cmdLine = line;
      cur = { text: '', subs: [] };
    }
    return cur;
  };
  const endWord = () => {
    if (!cur) return;
    if (pending) { redirs.push({ target: cur }); pending = null; } else words.push(cur);
    cur = null;
  };
  const endCmd = () => {
    endWord();
    if (pending) { problem('redirect without a target'); pending = null; }
    if (words.length || redirs.length) cmds.push({ words, redirs, line: cmdLine });
    words = [];
    redirs = [];
  };
  const sub = (from) => {
    const r = parseShell(src, from, true, line);
    problems.push(...r.problems);
    begin().subs.push(r.cmds);
    cur.text += '$(...)';
    for (let k = from; k < r.end; k++) if (src[k] === '\n') line++;
    return r.end;
  };
  const backtick = (from) => {
    let j = from + 1;
    while (j < src.length && src[j] !== '`') j += src[j] === '\\' ? 2 : 1;
    if (j >= src.length) { problem('unterminated backtick'); return src.length; }
    const r = parseShell(src.slice(from + 1, j), 0, false, line);
    problems.push(...r.problems);
    begin().subs.push(r.cmds);
    cur.text += '`...`';
    return j + 1;
  };

  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      if (src[i + 1] === '\n') { i += 2; line++; continue; }
      if (src[i + 1] === '\r' && src[i + 2] === '\n') { i += 3; line++; continue; }
      begin().text += src[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') { endWord(); i++; continue; }
    if (c === '\n') { endCmd(); line++; i++; continue; }
    if (c === '#' && !cur) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === ';') { endCmd(); i++; continue; }
    if (c === ')') {
      if (inParen) { endCmd(); return { cmds, problems, end: i + 1 }; }
      problem('unmatched )'); i++; continue;
    }
    if (c === '(') {
      if (cur || words.length) { problem('function definition or array'); i++; continue; }
      // A ( ) group at command position: its commands are checked like any other.
      const r = parseShell(src, i + 1, true, line);
      problems.push(...r.problems);
      cmds.push(...r.cmds);
      for (let k = i; k < r.end; k++) if (src[k] === '\n') line++;
      i = r.end;
      continue;
    }
    if (c === '&' && src[i + 1] === '>') {
      endWord();
      i += src[i + 2] === '>' ? 3 : 2;
      pending = '>';
      continue;
    }
    if (c === '&' || c === '|') {
      endCmd();
      i += src[i + 1] === c || (c === '|' && src[i + 1] === '&') ? 2 : 1;
      continue;
    }
    if (c === '>' || c === '<') {
      if (cur && /^\d+$/.test(cur.text) && !cur.subs.length) cur = null; else endWord();
      i++;
      if (src[i] === '(') { problem('process substitution'); i++; continue; }
      if (c === '<' && src[i] === '<') { problem('heredoc or here-string'); return { cmds, problems, end: src.length }; }
      if (c === '>' && (src[i] === '>' || src[i] === '|')) i++;
      if (c === '>' && src[i] === '&') {
        const m = /^&(\d+|-)/.exec(src.slice(i, i + 12));
        if (m) { i += m[0].length; continue; } // 2>&1, >&2: an fd duplication, not a file
        i++;
      }
      pending = c;
      continue;
    }
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      if (j < 0) { problem('unterminated single quote'); return { cmds, problems, end: src.length }; }
      const body = src.slice(i + 1, j);
      begin().text += body;
      line += body.split('\n').length - 1;
      i = j + 1;
      continue;
    }
    if (c === '"') {
      begin();
      i++;
      let closed = false;
      while (i < src.length) {
        const d = src[i];
        if (d === '"') { closed = true; i++; break; }
        if (d === '\\') {
          if (src[i + 1] === '\n') { line++; i += 2; continue; }
          cur.text += /[$`"\\]/.test(src[i + 1] ?? '') ? src[i + 1] : `\\${src[i + 1] ?? ''}`;
          i += 2;
          continue;
        }
        if (d === '$' && src[i + 1] === '(') {
          if (src[i + 2] === '(') { problem('arithmetic expansion'); i += 3; continue; }
          i = sub(i + 2);
          continue;
        }
        if (d === '`') { i = backtick(i); continue; }
        if (d === '\n') line++;
        cur.text += d;
        i++;
      }
      if (!closed) { problem('unterminated double quote'); return { cmds, problems, end: src.length }; }
      continue;
    }
    if (c === '$' && src[i + 1] === '(') {
      if (src[i + 2] === '(') { problem('arithmetic expansion'); i += 3; continue; }
      i = sub(i + 2);
      continue;
    }
    if (c === '`') { i = backtick(i); continue; }
    begin().text += c;
    i++;
  }
  endCmd();
  if (inParen) problem('unterminated $(');
  return { cmds, problems, end: i };
}

// ---- argument predicates ------------------------------------------------------
const hasDotDot = (p) => /(^|\/)\.\.(\/|$)/.test(p);
const repoRel = (p) => typeof p === 'string' && p !== '' && !/^([/~\-]|[A-Za-z]:)/.test(p) && !/[$`]/.test(p) && !hasDotDot(p);
const tmpPath = (p) => /^\/tmp\//.test(p) && !/[$`]/.test(p) && !hasDotDot(p);
const repoOrTmp = (p) => repoRel(p) || tmpPath(p);
// Environment keys a step (or `export` / `X=1 cmd`) may set on a developer
// machine: an ALLOW-list of keys, each with the values it may take (round 3).
// Every other key is refused, so an honest new `env:` in pr-gate.yml turns the
// drift test red until someone lists it here. Named for the reader: GIT_* (an
// external diff or config injection runs a program), npm_config_* (npm reads
// node-options and scripts from it), NODE_OPTIONS beyond a heap size, PATH,
// LD_*, and anything shaped like a credential are never allowed.
export const ENV_ALLOW = {
  CI: /^(true|1)$/,
  NODE_OPTIONS: /^--max-old-space-size=\d+$/,
  PYTHONDONTWRITEBYTECODE: /^1$/,
  EXTRACTOR_MEMORY_CEILING: /^(off|\d+)$/,
  BOARD_OWED_NO_REGEN: /^1$/,
  SCHEMA_DRIFT_IGNORE_GATED: /^1$/,
  GH_PR_NUMBER: /^\d*$/,
  // ${{ github.token }} substitutes to '' here: the key is REMOVED from the child env.
  GH_TOKEN: /^$/,
};
const ENV_NAMED_DENY = /^(GIT_.*|npm_config_.*|NODE_OPTIONS|PATH|LD_.*|DYLD_.*|BASH_ENV|ENV|IFS|.*_(TOKEN|KEY|SECRET|PASSWORD))$/i;

// An env/assignment pair that is safe to apply on a developer machine.
export function envProblem(key, value) {
  const ok = Object.prototype.hasOwnProperty.call(ENV_ALLOW, key) ? ENV_ALLOW[key] : null;
  if (ok && ok.test(String(value))) return null;
  if (ok) return `${key}=${value} is not an allowed value for ${key}`;
  if (ENV_NAMED_DENY.test(key)) return `${key} is a secret-looking or process-hijacking variable`;
  return `${key} is not in the env allow-list (ENV_ALLOW in scripts/ci/local-gate-shell-allowlist.mjs)`;
}

// Path segments and scripts no local run may touch (round 3, honest-mistake checks).
const GIT_SEGMENT = /(^|[/\\])\.git([/\\]|$)/i;
// Repo scripts that act on remote hosts (deploy, VPS cron, DB tunnel). Refused
// wherever they appear in a run block, even in a step merged on main.
export const REMOTE_WRITERS = /(^|[/\\])(deploy-and-watch|deploy-linux|db-tunnel|staging-window-deploy|vps-[A-Za-z0-9_-]+)\.sh$/;
const GLOB_CHARS = /[{}*?~]/;

// ---- allowed program forms ----------------------------------------------------
export const NPM_SCRIPTS = new Set(['lint:ci', 'test:unit', 'type-check:scripts', 'test:tzcase', 'build']);
const NPX_TOOLS = new Set(['tsc', 'vitest', 'eslint', 'tsx']);
const GIT_READONLY = new Set(['diff', 'rev-parse', 'log', 'show', 'status', 'ls-files', 'merge-base', 'cat-file', 'rev-list', 'ls-tree', 'describe']);
// node flags allowed BEFORE the script (an explicit list: --import=, --require=,
// --eval and every flag nobody listed are refused).
const NODE_FLAGS = /^(--test|--max-old-space-size=\d+|--test-reporter=(spec|tap|dot))$/;
const SCRIPT_DIRS = /^(scripts|scraper\/scripts|\.claude\/hooks)\//;
const PY_DIRS = /^(\.claude\/hooks\/tests|scraper\/scripts|scripts)\//;

const nodeForm = (a) => {
  let i = 0;
  let test = false;
  for (; i < a.length && a[i].startsWith('-'); i++) {
    if (!NODE_FLAGS.test(a[i])) return `node ${a[i]} is not an allowed node flag (inline or injected code)`;
    if (a[i] === '--test') test = true;
  }
  const rest = a.slice(i);
  if (!test && !rest.length) return 'node without a script file';
  if (test) {
    const flag = rest.find((x) => x.startsWith('-') && !NODE_FLAGS.test(x));
    if (flag) return `node --test ${flag} is not an allowed node flag`;
  }
  const paths = test ? rest.filter((x) => !x.startsWith('-')) : rest.slice(0, 1);
  const bad = paths.find((p) => !repoRel(p));
  return bad ? `node path is not repo-relative: ${bad}` : null;
};
const npxForm = (a) => {
  let i = 0;
  while (a[i] === '--no-install') i++;
  const tool = a[i];
  if (!NPX_TOOLS.has(tool)) return `npx ${tool ?? ''} is not an allowed tool (${[...NPX_TOOLS].join(', ')})`;
  if (tool === 'tsx') {
    // tsx passes its flags to node; none is allowed before the script.
    const script = a[i + 1];
    if (script === undefined || script.startsWith('-')) return `npx tsx ${script ?? ''} - tsx takes no flags here (inline or injected code)`;
    if (!repoRel(script)) return `npx tsx path is not repo-relative: ${script}`;
  }
  return null;
};
const npmForm = (a) => {
  let i = 0;
  const skipFlags = () => { while (['--silent', '-s', '--if-present'].includes(a[i])) i++; };
  skipFlags();
  if (!['run', 'run-script'].includes(a[i])) return `npm ${a[i] ?? ''} is not 'npm run <script>'`;
  i++;
  skipFlags();
  return NPM_SCRIPTS.has(a[i]) ? null : `npm run ${a[i] ?? ''} is not in the script allow-list`;
};
const shellScriptForm = (name) => (a) => {
  let i = 0;
  while (i < a.length && a[i].startsWith('-')) {
    if (a[i] === '-o' && a[i + 1] === 'pipefail') { i += 2; continue; }
    if (!/^-[eux]+$/.test(a[i])) return `${name} ${a[i]} is not an allowed flag`;
    i++;
  }
  return repoRel(a[i]) && SCRIPT_DIRS.test(a[i]) ? null : `${name} must run a repo script under scripts/, scraper/scripts/ or .claude/hooks/ (got ${a[i] ?? 'nothing'})`;
};
const pythonForm = (a) => {
  let i = 0;
  while (['-u', '-B'].includes(a[i])) i++;
  if (a[i] === '-m') return ['unittest', 'pytest'].includes(a[i + 1]) ? null : `python -m ${a[i + 1] ?? ''} is not unittest or pytest`;
  return repoRel(a[i]) && /\.py$/.test(a[i]) && PY_DIRS.test(a[i]) ? null : `python must run a repo .py under .claude/hooks/tests/, scraper/scripts/ or scripts/ (got ${a[i] ?? 'nothing'})`;
};
const paths = (a, ok) => {
  const bad = a.find((x) => !x.startsWith('-') && !/^\d+$/.test(x) && !ok(x));
  return bad ? `path ${bad} is outside the repo` : null;
};

export const PROGRAMS = {
  node: nodeForm,
  npx: npxForm,
  npm: npmForm,
  bash: shellScriptForm('bash'),
  sh: shellScriptForm('sh'),
  python: pythonForm,
  python3: pythonForm,
  cd: (a) => (a.length === 1 && repoRel(a[0]) ? null : `cd must take one repo-relative directory (got ${a.join(' ') || 'nothing'})`),
  echo: () => null,
  printf: (a) => (a.some((x) => /^-/.test(x)) ? 'printf with an option (printf -v assigns a variable)' : null),
  true: () => null,
  false: () => null,
  test: () => null,
  '[': () => null,
  '[[': () => null,
  exit: (a) => (a.every((x) => /^\d+$/.test(x)) ? null : 'exit takes a number'),
  set: (a) => (a.every((x) => /^[-+][a-zA-Z]+$|^(pipefail|errexit|nounset|xtrace)$/.test(x)) ? null : 'set takes shell options only'),
  export: (a) => {
    for (const x of a) {
      const m = ASSIGN.exec(x);
      if (!m && !IDENT.test(x)) return `export ${x}`;
      if (!m && !Object.prototype.hasOwnProperty.call(ENV_ALLOW, x)) return `export ${x}: not in the env allow-list`;
      if (m) { const p = envProblem(m[1], x.slice(m[0].length)); if (p) return p; }
    }
    return null;
  },
  tee: (a) => paths(a, repoOrTmp),
  tail: (a) => paths(a, repoOrTmp),
  head: (a) => paths(a, repoOrTmp),
  grep: () => null,
  rm: (a) => {
    const flags = a.filter((x) => x.startsWith('-'));
    const targets = a.filter((x) => !x.startsWith('-'));
    if (flags.some((f) => !/^-[rfRv]+$/.test(f))) return 'rm takes -r/-f/-v only';
    if (!targets.length) return 'rm without a target';
    const bad = targets.find((t) => !(repoOrTmp(t) && !/[*?[\]{}]/.test(t) && t !== '.' && t !== './'));
    return bad ? `rm target ${bad} is not an exact repo-relative or /tmp path` : null;
  },
  git: (a) => {
    if (!GIT_READONLY.has(a[0])) return `git ${a[0] ?? ''} is not a read-only git subcommand`;
    return a.some((x) => /^(--output|-o$)/.test(x)) ? 'git --output writes a file' : null;
  },
};

const KEYWORD_PREFIX = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', 'time', '{']);
const KEYWORD_ALONE = new Set(['fi', 'done', 'esac', '}']);

function checkCommands(cmds, out) {
  for (const cmd of cmds) {
    for (const w of [...cmd.words, ...cmd.redirs.map((r) => r.target)]) for (const s of w.subs) checkCommands(s, out);
    const offend = (reason) => out.push({ line: cmd.line, text: cmd.words.map((w) => w.text).join(' ').slice(0, 120), reason });
    for (const w of cmd.words) if (/\$\{?GITHUB_[A-Z_]+|\$\{\{/.test(w.text)) offend(`uses runner-only state (${w.text.slice(0, 40)})`);
    for (const r of cmd.redirs) {
      const t = r.target.text;
      if (r.target.subs.length || !(t === '/dev/null' || repoOrTmp(t))) offend(`redirect to ${t.slice(0, 60)} (only /dev/null, /tmp or a repo-relative file)`);
    }
    for (const w of [...cmd.words, ...cmd.redirs.map((r) => r.target)]) {
      if (GIT_SEGMENT.test(w.text)) offend(`path ${w.text.slice(0, 60)} has a .git segment (git internals are never touched locally)`);
      if (REMOTE_WRITERS.test(w.text)) offend(`${w.text} acts on a remote host (deploy / VPS / DB tunnel); never run locally`);
    }
    {
      // Brace expansion, globs and ~ turn one written argument into others
      // (node {--eval,x}); a program or its arguments never carry them.
      let k = 0;
      while (k < cmd.words.length && (KEYWORD_PREFIX.has(cmd.words[k].text) || (ASSIGN.test(cmd.words[k].text) && !cmd.words[k].subs.length))) k++;
      const g = cmd.words.slice(k).find((w) => !KEYWORD_ALONE.has(w.text) && GLOB_CHARS.test(w.text));
      if (g) offend(`argument ${g.text.slice(0, 40)} contains one of { } * ? ~ (expansion)`);
    }
    let words = cmd.words;
    while (words.length && KEYWORD_PREFIX.has(words[0].text)) words = words.slice(1);
    if (!words.length) continue;
    if (words.length === 1 && KEYWORD_ALONE.has(words[0].text)) continue;
    if (words[0].text === 'for') continue; // loop header: no execution; its $( ) were checked above
    while (words.length && ASSIGN.test(words[0].text) && !words[0].subs.length) {
      const m = ASSIGN.exec(words[0].text);
      const p = envProblem(m[1], words[0].text.slice(m[0].length));
      if (p) offend(p);
      words = words.slice(1);
    }
    if (!words.length) continue;
    const [prog, ...args] = words;
    if (prog.subs.length) { offend('the command itself comes from a substitution'); continue; }
    const check = Object.prototype.hasOwnProperty.call(PROGRAMS, prog.text) ? PROGRAMS[prog.text] : null;
    if (!check) { offend(`'${prog.text}' is not an allowed program (node, npx, npm run, bash/sh scripts/, python tests, cd, builtins)`); continue; }
    const reason = check(args.map((x) => x.text));
    if (reason) offend(reason);
  }
}

// Every command line in `text` that is not an allowed program form.
// Empty array = the block may run locally.
export function unclassifiedCommands(text) {
  const parsed = parseShell(String(text));
  const out = parsed.problems.map((p) => ({ line: p.line, text: p.text, reason: `unmodelled shell syntax: ${p.reason}` }));
  checkCommands(parsed.cmds, out);
  return out;
}
