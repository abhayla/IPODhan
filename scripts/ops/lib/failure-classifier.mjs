// Classifies scraper pm2 log lines into a stable errorClass, keyed by
// (ipoId, docType, errorClass) so a tick can diff today's failure set
// against yesterday's instead of reporting a bare count (signal-ownership
// R1/R2, T-496).
//
// Ordered table: first matching rule wins. Each rule is a predicate over
// the parsed pino JSON line (not a raw-text regex) so a message rewording
// doesn't silently reclassify a failure as "other".

const RULES = [
  {
    errorClass: 'persist-insert-failed',
    match: (l) => l.msg === 'Filing persist failed (non-fatal)' && typeof l.error === 'string' && /insert into/i.test(l.error),
  },
  {
    errorClass: 'unit-unparseable',
    match: (l) => l.msg === 'W-45 cross-document agreement refused the paired persist — nothing written' && typeof l.reason === 'string' && /no parseable unit/i.test(l.reason),
  },
  {
    errorClass: 'spawn-timeout-hard',
    match: (l) => typeof l.error === 'string' && /ETIMEDOUT/i.test(l.error) && /spawn/i.test(l.error) && l.hardFailure === true,
  },
  {
    errorClass: 'spawn-timeout-soft',
    match: (l) => typeof l.error === 'string' && /ETIMEDOUT/i.test(l.error) && /spawn/i.test(l.error) && l.hardFailure !== true,
  },
  {
    errorClass: 'anchor-deterministic-refusal',
    match: (l) => typeof l.msg === 'string' && /^Anchor allocation report failed/.test(l.msg) && l.deterministic === true,
  },
  {
    // Scope per T-496 dod: level 40/50 lines carrying one of the named markers
    // (hardFailure / "persist failed" / "refused" / "spawn failed" / "report failed"),
    // or an explicit hardFailure:true. This deliberately excludes document-discovery
    // noise like "Document BLOCKED_ALL — every source failed" (a different, already
    // budget-tracked signal, not a write-path failure) from swamping the tick.
    errorClass: 'other',
    match: (l) =>
      (l.level === 50 || l.level === 40) &&
      typeof l.msg === 'string' &&
      (l.hardFailure === true || /persist failed|refused|spawn failed|report failed/i.test(l.msg)),
  },
];

/**
 * @param {object} line - a parsed pino JSON log line
 * @returns {{ipoId: string|null, docType: string|null, errorClass: string, hardFailure: boolean, company: string|null, time: string|null, raw: object}|null}
 *   null when the line is not a failure line at all (level < 40).
 */
export function classifyLine(line) {
  if (!line || typeof line !== 'object') return null;
  if (typeof line.level !== 'number' || line.level < 40) return null;

  const rule = RULES.find((r) => r.match(line));
  if (!rule) return null;

  return {
    ipoId: line.ipoId ?? null,
    docType: line.docType ?? null,
    errorClass: rule.errorClass,
    hardFailure: line.hardFailure === true,
    company: line.company ?? line.companyName ?? null,
    time: line.time ?? null,
    raw: line,
  };
}

/**
 * Parses raw pm2 log text (one JSON object per line; pm2 sometimes prefixes
 * a timestamp before the JSON, and non-JSON lines must be skipped, never
 * thrown on).
 * @param {string} text
 * @returns {object[]}
 */
export function parseLogLines(text) {
  const out = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const jsonStart = line.indexOf('{');
    if (jsonStart === -1) continue;
    try {
      out.push(JSON.parse(line.slice(jsonStart)));
    } catch {
      // Not a parseable JSON log line (pm2 banner, stack trace continuation) — skip.
    }
  }
  return out;
}

/**
 * Resolves failures to identities by cross-referencing the per-IPO summary
 * line ("Filing auto-persist complete for one IPO", level 30) for company
 * name, since individual failure lines don't always carry `company`.
 * @param {object[]} parsedLines
 * @returns {Map<string, {ipoId: string, docType: string|null, errorClass: string, hardFailure: boolean, company: string, firstSeen: string}>}
 *   keyed by `${ipoId}::${docType}::${errorClass}`
 */
export function extractFailures(parsedLines) {
  const companyByIpoId = new Map();
  for (const l of parsedLines) {
    const ipoId = l.ipoId;
    const company = l.company ?? l.companyName;
    if (ipoId && company && !companyByIpoId.has(ipoId)) {
      companyByIpoId.set(ipoId, company);
    }
  }

  const failures = new Map();
  for (const l of parsedLines) {
    const classified = classifyLine(l);
    if (!classified || !classified.ipoId) continue;

    const key = `${classified.ipoId}::${classified.docType ?? '-'}::${classified.errorClass}`;
    const company = classified.company ?? companyByIpoId.get(classified.ipoId) ?? 'unknown';
    const existing = failures.get(key);
    if (!existing || (classified.time && classified.time < existing.firstSeen)) {
      failures.set(key, {
        ipoId: classified.ipoId,
        docType: classified.docType,
        errorClass: classified.errorClass,
        hardFailure: classified.hardFailure,
        company,
        firstSeen: classified.time ?? existing?.firstSeen ?? null,
      });
    }
  }
  return failures;
}

export const ERROR_CLASSES = RULES.map((r) => r.errorClass);
