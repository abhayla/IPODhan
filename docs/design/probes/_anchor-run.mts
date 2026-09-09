// docs/design/probes/_anchor-run.mts — thin TS runner invoked via `tsx` by anchor-report-extract.mjs.
//
// The real extractor (`scraper/src/scrapers/anchor-investors-scraper.ts` /
// `anchor-report-parser.ts`) is TypeScript; the probe harness is plain `.mjs`. This file is the
// bridge: it imports the two REAL functions, runs them against a real PDF path given on argv, and
// prints one JSON line to stdout. It is not itself an extractor and adds no logic beyond wiring.
// A linked worktree has no `node_modules` of its own (git worktrees never carry it), so `tsx` runs
// this against the MAIN checkout's copy of the real extractor — same commit's code, dependencies
// actually resolvable — never a re-implementation living only in the worktree.
import { extractPageTexts, isSidecarFailure } from 'file:///D:/Abhay/Ventures/IPODhan/scraper/src/scrapers/anchor-investors-scraper.js';
import { parseAnchorReport } from 'file:///D:/Abhay/Ventures/IPODhan/scraper/src/scrapers/anchor-report-parser.js';

const pdfPath = process.argv[2];
if (!pdfPath) { console.error('usage: tsx _anchor-run.mts <pdf-path>'); process.exit(2); }

const sidecar = extractPageTexts(pdfPath);
if (isSidecarFailure(sidecar)) {
  console.log(JSON.stringify({ ok: false, stage: 'extractPageTexts', kind: sidecar.kind, reason: sidecar.reason ?? null }));
  process.exit(0);
}
const parsed = parseAnchorReport(sidecar.pages);
console.log(JSON.stringify({ ok: true, stage: 'parseAnchorReport', pageCount: sidecar.pages.length, result: parsed }));
