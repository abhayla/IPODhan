// implements: R-160

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Item 22 (OD-37) — the config layer (`scraper/src/config/**`) must stay
 * below the services layer: a config file may be READ by a service
 * (`company-host-source.ts` loads the allow-list), but the config loader
 * itself must never import FROM `../services/**` — that would be the
 * download allow-list depending on the exact module it is meant to bound.
 * `scripts/ci/check-module-boundaries.mjs` does not track this edge (the
 * `scraper/src/config` glob is unmapped in `module-map.json`, so an edge
 * touching it is silently ignored per that script's own contract) — this is
 * the real, source-of-truth-read test for the direction.
 */
describe('config layer import direction — download-allowlist', () => {
  it('download-allowlist-loader.ts imports nothing from ../services', () => {
    const src = readFileSync(
      join(__dirname, '../../../src/config/download-allowlist-loader.ts'),
      'utf-8'
    );
    const importLines = src.split('\n').filter((l) => l.trim().startsWith('import'));
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line).not.toMatch(/services\//);
    }
  });

  it('download-allowlist-schema.ts imports nothing from ../services', () => {
    const src = readFileSync(
      join(__dirname, '../../../src/config/download-allowlist-schema.ts'),
      'utf-8'
    );
    const importLines = src.split('\n').filter((l) => l.trim().startsWith('import'));
    for (const line of importLines) {
      expect(line).not.toMatch(/services\//);
    }
  });

  it('company-host-source.ts (services) is the one importing the config loader — not vice versa', () => {
    const src = readFileSync(
      join(__dirname, '../../../src/services/company-host-source.ts'),
      'utf-8'
    );
    expect(src).toMatch(/from ['"]\.\.\/config\/download-allowlist-loader\.js['"]/);
  });
});
