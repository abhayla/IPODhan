/**
 * Writes scraper/config/writer-source-ranking.json — the writer's own source ranking for the OD-73
 * settled fields, read by scripts/audit-detection-floor.mjs (s_settled_field_rewritten).
 * `--check` exits 1 when the committed file differs from what the writer answers today.
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildWriterRankingSnapshot } from '../src/config/writer-source-ranking.js';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'writer-source-ranking.json');
const text = JSON.stringify(buildWriterRankingSnapshot(), null, 2) + '\n';
if (process.argv.includes('--check')) {
  let committed = '';
  try { committed = readFileSync(out, 'utf8').replace(/\r\n/g, '\n'); } catch { /* missing = drift */ }
  if (committed !== text) {
    console.error(`writer-source-ranking.json is stale — run: cd scraper && npx tsx scripts/build-writer-ranking-snapshot.ts`);
    process.exit(1);
  }
  console.log('writer-source-ranking.json matches the writer');
} else {
  writeFileSync(out, text);
  console.log(`wrote ${out}`);
}
