/**
 * W-158 — reset-document CLI. All fakes, no real DB/Redis: `RunDeps` is
 * fully overridden in every test, so `run()` never touches `@ipodhan/shared`'s
 * live db/redis (see `buildDefaultDepsLazy`'s short-circuit in the script).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DocumentRow, RunDeps } from '../../../scripts/reset-document';

const IPO_ID = '0b7e81cd-3426-4376-9bc8-1b3b07fa9a93';
const DOC_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeDoc(overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: DOC_ID,
    ipoId: IPO_ID,
    type: 'RHP',
    title: 'RHP',
    extractionStatus: 'FAILED',
    extractionError: 'HARD_FAILURE:2:killed',
    retryCount: 3,
    ...overrides,
  };
}

/** A fake store + spy-wrapped RunDeps built around one document row. */
function makeFakeDeps(initial: DocumentRow) {
  let store: DocumentRow = { ...initial };
  const deletedKeys: string[][] = [];
  const updateCalls: Array<{ id: string; patch: unknown }> = [];

  const deps: RunDeps = {
    resolveIpoId: vi.fn(async (needle: string) => (needle === initial.ipoId ? initial.ipoId : IPO_ID)),
    getDocumentById: vi.fn(async (id: string) => (id === store.id ? { ...store } : null)),
    listDocumentsForIpo: vi.fn(async (ipoId: string, docType: string) =>
      ipoId === store.ipoId && docType === store.type ? [{ ...store }] : []
    ),
    updateDocument: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      updateCalls.push({ id, patch });
      store = {
        ...store,
        extractionStatus: patch.extractionStatus as string,
        ...(patch.retryCount !== undefined ? { retryCount: patch.retryCount as number } : {}),
        ...(patch.extractionError !== undefined
          ? { extractionError: patch.extractionError as string | null }
          : {}),
      };
      return { ...store };
    }),
    invalidateKeys: vi.fn(async (keys: string[]) => {
      deletedKeys.push(keys);
    }),
    rereadDocuments: vi.fn(async (ipoId: string) => (ipoId === store.ipoId ? [{ ...store }] : [])),
  };

  return { deps, deletedKeys, updateCalls, getStore: () => store };
}

describe('reset-document CLI', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it('dry run (no --apply): writes nothing and deletes no cache key', async () => {
    const { run } = await import('../../../scripts/reset-document');
    const { deps, deletedKeys, updateCalls } = makeFakeDeps(makeDoc());

    await run(['node', 'reset-document.ts', '--document-id', DOC_ID], deps);

    expect(updateCalls).toHaveLength(0);
    expect(deletedKeys).toHaveLength(0);
    expect(deps.rereadDocuments).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('--apply updates the row (retry_count=0, extraction_error=null by default for PENDING) and DELs exactly the documents:<ipoId> key', async () => {
    const { run } = await import('../../../scripts/reset-document');
    const { deps, deletedKeys, updateCalls, getStore } = makeFakeDeps(makeDoc());

    await run(['node', 'reset-document.ts', '--document-id', DOC_ID, '--apply'], deps);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].patch).toMatchObject({
      extractionStatus: 'PENDING',
      retryCount: 0,
      extractionError: null,
    });
    expect(deletedKeys).toEqual([[`documents:${IPO_ID}`]]);
    // The W-137 HARD_FAILURE marker lived in extraction_error — clearing it
    // is exactly what wipes the marker; no separate code path needed.
    expect(getStore().extractionError).toBeNull();
    expect(deps.rereadDocuments).toHaveBeenCalledWith(IPO_ID);
  });

  it('--to MANUAL_REVIEW defaults --clear-retries to OFF (retry history preserved)', async () => {
    const { run } = await import('../../../scripts/reset-document');
    const { deps, updateCalls } = makeFakeDeps(makeDoc());

    await run(
      ['node', 'reset-document.ts', '--document-id', DOC_ID, '--to', 'MANUAL_REVIEW', '--apply'],
      deps
    );

    expect(updateCalls[0].patch).toMatchObject({ extractionStatus: 'MANUAL_REVIEW' });
    expect(updateCalls[0].patch).not.toHaveProperty('retryCount');
    expect(updateCalls[0].patch).not.toHaveProperty('extractionError');
  });

  it('--to MANUAL_REVIEW --clear-retries explicitly still clears retry state', async () => {
    const { run } = await import('../../../scripts/reset-document');
    const { deps, updateCalls } = makeFakeDeps(makeDoc());

    await run(
      [
        'node',
        'reset-document.ts',
        '--document-id',
        DOC_ID,
        '--to',
        'MANUAL_REVIEW',
        '--clear-retries',
        '--apply',
      ],
      deps
    );

    expect(updateCalls[0].patch).toMatchObject({ retryCount: 0, extractionError: null });
  });

  it('resolves via --ipo + --doc-type when no --document-id is given', async () => {
    const { run } = await import('../../../scripts/reset-document');
    const { deps, updateCalls } = makeFakeDeps(makeDoc());

    await run(['node', 'reset-document.ts', '--ipo', IPO_ID, '--doc-type', 'RHP', '--apply'], deps);

    expect(deps.resolveIpoId).toHaveBeenCalledWith(IPO_ID);
    expect(deps.listDocumentsForIpo).toHaveBeenCalledWith(IPO_ID, 'RHP');
    expect(updateCalls).toHaveLength(1);
  });

  it('refuses an unknown --document-id: no writes, exit 1', async () => {
    const { run } = await import('../../../scripts/reset-document');
    const { deps, updateCalls, deletedKeys } = makeFakeDeps(makeDoc());

    await expect(
      run(['node', 'reset-document.ts', '--document-id', 'ffffffff-ffff-ffff-ffff-ffffffffffff', '--apply'], deps)
    ).rejects.toThrow('process.exit:1');

    expect(updateCalls).toHaveLength(0);
    expect(deletedKeys).toHaveLength(0);
  });

  it('refuses an ambiguous --ipo + --doc-type match: no writes, exit 1', async () => {
    const { run } = await import('../../../scripts/reset-document');
    const doc1 = makeDoc({ id: 'id-1' });
    const doc2 = makeDoc({ id: 'id-2' });
    const updateCalls: unknown[] = [];
    const deps: RunDeps = {
      resolveIpoId: vi.fn(async () => IPO_ID),
      getDocumentById: vi.fn(async () => null),
      listDocumentsForIpo: vi.fn(async () => [doc1, doc2]),
      updateDocument: vi.fn(async (id, patch) => {
        updateCalls.push({ id, patch });
        return doc1;
      }),
      invalidateKeys: vi.fn(async () => {}),
      rereadDocuments: vi.fn(async () => [doc1, doc2]),
    };

    await expect(
      run(['node', 'reset-document.ts', '--ipo', IPO_ID, '--doc-type', 'RHP', '--apply'], deps)
    ).rejects.toThrow('process.exit:1');

    expect(updateCalls).toHaveLength(0);
    expect(deps.updateDocument).not.toHaveBeenCalled();
  });

  it('prod guard: refuses when NODE_ENV=production without --allow-prod', async () => {
    process.env.NODE_ENV = 'production';
    const { run } = await import('../../../scripts/reset-document');
    const { deps, updateCalls } = makeFakeDeps(makeDoc());

    await expect(
      run(['node', 'reset-document.ts', '--document-id', DOC_ID, '--apply'], deps)
    ).rejects.toThrow('process.exit:1');

    expect(updateCalls).toHaveLength(0);
    expect(deps.getDocumentById).not.toHaveBeenCalled();
  });

  it('prod guard: proceeds when NODE_ENV=production WITH --allow-prod', async () => {
    process.env.NODE_ENV = 'production';
    const { run } = await import('../../../scripts/reset-document');
    const { deps, updateCalls } = makeFakeDeps(makeDoc());

    await run(['node', 'reset-document.ts', '--document-id', DOC_ID, '--apply', '--allow-prod'], deps);

    expect(updateCalls).toHaveLength(1);
  });

  it('rejects an unknown --to value before touching storage', async () => {
    const { run } = await import('../../../scripts/reset-document');
    const { deps, updateCalls } = makeFakeDeps(makeDoc());

    await expect(
      run(['node', 'reset-document.ts', '--document-id', DOC_ID, '--to', 'BOGUS', '--apply'], deps)
    ).rejects.toThrow('process.exit:2');

    expect(updateCalls).toHaveLength(0);
    expect(deps.getDocumentById).not.toHaveBeenCalled();
  });

  it('usage error when neither --document-id nor --ipo+--doc-type is given', async () => {
    const { run } = await import('../../../scripts/reset-document');
    const { deps } = makeFakeDeps(makeDoc());

    await expect(run(['node', 'reset-document.ts'], deps)).rejects.toThrow('process.exit:2');
  });
});
