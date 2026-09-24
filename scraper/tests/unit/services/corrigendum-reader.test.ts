/**
 * Item 9 (OD-90), PR #989 review MINOR 4: a corrigendum read that yields no suggestion must not
 * pass as a silent success — it is logged at warn with the document id so a human looks at it.
 * MUTATION: drop the `parsed === 0` warn in buildCorrigendumSuggestionRunner -> RED.
 */
import { describe, it, expect, vi } from 'vitest';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { buildCorrigendumSuggestionRunner } from '../../../src/services/corrigendum-reader.js';

describe('buildCorrigendumSuggestionRunner — zero suggestions', () => {
  it('warns with the document id when a corrigendum yields no suggestion, and writes nothing', async () => {
    const db = new Proxy({}, { get: () => { throw new Error('no DB access expected'); } });
    const run = buildCorrigendumSuggestionRunner(
      async () => [{ page: 1, text: 'Notice to investors. No change of any kind is announced here.', ocr: false }] as never,
      db as never
    );
    const result = await run({ ipoId: 'ipo-1', documentId: 'doc-zero-1', pdfPath: 'x.pdf' });
    expect(result.parsed).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({ ipoId: 'ipo-1', documentId: 'doc-zero-1', pageCount: 1 });
  });
});
