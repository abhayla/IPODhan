import { describe, it, expect, afterEach } from 'vitest';
import { z } from 'zod';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadValidatedConfig } from '../../../src/config/validated-config-loader';

const tmpFiles: string[] = [];

function writeTmpFile(content: string): string {
  const filePath = path.join(os.tmpdir(), `validated-config-loader-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(filePath, content, 'utf-8');
  tmpFiles.push(filePath);
  return filePath;
}

afterEach(() => {
  while (tmpFiles.length) {
    const f = tmpFiles.pop()!;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

const simpleSchema = z
  .object({
    name: z.string(),
    rank: z.number(),
  })
  .strict();

describe('loadValidatedConfig', () => {
  it('returns the typed object for a well-formed config matching the schema', () => {
    const filePath = writeTmpFile(JSON.stringify({ name: 'nse', rank: 1 }));
    const result = loadValidatedConfig(filePath, simpleSchema);
    expect(result).toEqual({ name: 'nse', rank: 1 });
  });

  it('throws with the file path AND the offending key path when schema validation fails', () => {
    const filePath = writeTmpFile(JSON.stringify({ name: 'nse', rank: 'not-a-number' }));
    let thrown: Error | undefined;
    try {
      loadValidatedConfig(filePath, simpleSchema);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown!.message).toContain(filePath);
    expect(thrown!.message).toContain('rank');
  });

  it('throws when the config has an unknown key against a .strict() schema', () => {
    const filePath = writeTmpFile(JSON.stringify({ name: 'nse', rank: 1, extra: 'nope' }));
    let thrown: Error | undefined;
    try {
      loadValidatedConfig(filePath, simpleSchema);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown!.message).toContain(filePath);
    expect(thrown!.message.toLowerCase()).toMatch(/extra|unrecognized|unknown/);
  });

  it('throws a message naming the path when the file is missing', () => {
    const missingPath = path.join(os.tmpdir(), `validated-config-loader-test-missing-${Date.now()}.json`);
    let thrown: Error | undefined;
    try {
      loadValidatedConfig(missingPath, simpleSchema);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown!.message).toContain(missingPath);
  });

  it('throws a message naming the path and identifying malformed JSON as a parse failure', () => {
    const filePath = writeTmpFile('{ "name": "nse", "rank": 1, ');
    let thrown: Error | undefined;
    try {
      loadValidatedConfig(filePath, simpleSchema);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown!.message).toContain(filePath);
    expect(thrown!.message.toLowerCase()).toMatch(/parse|json/);
  });

  it('reports ALL simultaneous violations, not just the first', () => {
    const filePath = writeTmpFile(JSON.stringify({ name: 42, rank: 'not-a-number' }));
    let thrown: Error | undefined;
    try {
      loadValidatedConfig(filePath, simpleSchema);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown!.message).toContain('name');
    expect(thrown!.message).toContain('rank');
  });
});
