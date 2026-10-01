/**
 * #1348: the admin editor showed nothing the admin could see when a save was refused. On staging two
 * PATCH /api/admin/update-field calls returned 400 ("unknown listing exchange") and the admin believed
 * the save worked: the reason was printed in grey at the very bottom of the field editor, below the
 * delete form, off screen on a phone. A 500 printed "[object Object]", and a network failure printed
 * nothing at all and left the buttons disabled.
 *
 * Class: every admin save the editor makes (field typed / pick / delete, rating override, scraper lock,
 * list add / edit / remove, unhide) x every failure (400, 401, 403, 409, 500, network). For each,
 * the admin sees the API's reason in an alert NEXT TO the field (before its save form), nothing says
 * "Saved", and the field is not reported saved.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { FieldEditor, HiddenBanner } from '@/components/admin/ipo-editor/IpoPageEditor';
import { ListEditor } from '@/components/admin/ipo-editor/ListEditor';
import { editorFieldCatalog, PLAN_REBUILD_NOTICE } from '@/lib/admin/ipo-editor-fields';
import type { EditorField } from '@/lib/admin/ipo-editor-data';

const IPO = '00000000-0000-4000-8000-000000000001';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The bodies the real routes send (adminWriteResponse, unauthorizedResponse, apiErrorResponse). */
const FAILURES: Array<{ name: string; respond: () => Promise<Response>; shows: RegExp }> = [
  {
    name: '400 INVALID',
    respond: async () => json(400, { success: false, error: 'INVALID', reason: 'ipos.listingExchanges: unknown listing exchange "MCX" (NSE or BSE)' }),
    shows: /unknown listing exchange "MCX"/,
  },
  { name: '401 session ended', respond: async () => json(401, { error: 'Unauthorized', message: 'Admin authentication required' }), shows: /Admin authentication required/ },
  { name: '403 forbidden', respond: async () => json(403, { error: 'Forbidden', message: 'Request origin not allowed' }), shows: /Request origin not allowed/ },
  {
    name: '409 hidden',
    respond: async () => json(409, { success: false, error: 'IPO_HIDDEN', reason: 'This IPO is hidden. Unhide it to edit.' }),
    shows: /This IPO is hidden/,
  },
  {
    name: '500 server error',
    respond: async () => json(500, { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', timestamp: '2026-10-01T00:00:00Z' } }),
    shows: /An unexpected error occurred/,
  },
  { name: '502 with no JSON body', respond: async () => new Response('<html>Bad gateway</html>', { status: 502 }), shows: /HTTP 502/ },
  {
    name: 'network failure',
    respond: async () => {
      throw new TypeError('Failed to fetch');
    },
    shows: /did not reach the server/,
  },
];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function field(key: string, overrides: Partial<EditorField> = {}): EditorField {
  const spec = editorFieldCatalog('MAINBOARD').find((f) => f.key === key);
  if (!spec) throw new Error(`no editor field ${key}`);
  return {
    ...spec,
    fieldName: spec.column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
    rowKey: '',
    currentValue: ['NSE', 'BSE'],
    version: 'v1',
    setBy: 'NSE',
    setAt: null,
    currentSource: 'NSE',
    admin: null,
    witnesses: [],
    e1Rule: null,
    planRebuildNotice: spec.planRebuild ? PLAN_REBUILD_NOTICE : null,
    notApplicable: false,
    ...overrides,
  } as EditorField;
}

function expectFailureShownNextToField(container: HTMLElement, shows: RegExp, formInput?: HTMLElement) {
  const alert = within(container).getByRole('alert');
  expect(alert.textContent).toMatch(shows);
  expect(alert.textContent).toMatch(/Not saved/);
  expect(container.textContent).not.toMatch(/Saved\./);
  if (formInput) {
    // Next to the field: the alert comes before the save form, not after the delete form.
    expect(alert.compareDocumentPosition(formInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
}

describe('#1348 field editor: a refused save is shown next to the field and the field is not saved', () => {
  it.each(FAILURES)('typed save, $name', async ({ respond, shows }) => {
    vi.stubGlobal('fetch', vi.fn(respond));
    const onSaved = vi.fn();
    const { container } = render(<FieldEditor ipoId={IPO} field={field('ipos.listing_exchanges')} onSaved={onSaved} />);
    fireEvent.change(container.querySelector('input[name=typed-value]')!, { target: { value: 'MCX' } });
    fireEvent.change(container.querySelector('input[name=source-note]')!, { target: { value: 'RHP p.12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save typed value' }));
    await waitFor(() => expect(within(container).getByRole('alert')).toBeTruthy());
    expectFailureShownNextToField(container, shows, container.querySelector('input[name=typed-value]') as HTMLElement);
    expect(onSaved).not.toHaveBeenCalled();
    // The buttons work again after a failure (a network failure used to leave them disabled).
    expect((screen.getByRole('button', { name: 'Save typed value' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(FAILURES)('pick save, $name', async ({ respond, shows }) => {
    vi.stubGlobal('fetch', vi.fn(respond));
    const onSaved = vi.fn();
    const f = field('ipos.listing_exchanges', {
      witnesses: [{ source: 'NSE', rank: 1, status: 'value', value: ['NSE'], current: false, pickLabel: 'NSE', readAt: null } as never],
    });
    const { container } = render(<FieldEditor ipoId={IPO} field={f} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    await waitFor(() => expect(within(container).getByRole('alert')).toBeTruthy());
    expectFailureShownNextToField(container, shows);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it.each(FAILURES)('delete save, $name', async ({ respond, shows }) => {
    vi.stubGlobal('fetch', vi.fn(respond));
    const onSaved = vi.fn();
    const { container } = render(<FieldEditor ipoId={IPO} field={field('ipos.listing_exchanges')} onSaved={onSaved} />);
    fireEvent.change(container.querySelector('input[name=delete-reason]')!, { target: { value: 'not applicable' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete value' }));
    await waitFor(() => expect(within(container).getByRole('alert')).toBeTruthy());
    expectFailureShownNextToField(container, shows);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it.each(FAILURES)('scraper lock, $name', async ({ respond, shows }) => {
    vi.stubGlobal('fetch', vi.fn(respond));
    const onSaved = vi.fn();
    const { container } = render(
      <FieldEditor ipoId={IPO} field={field('ipos.scraper_locked', { currentValue: false, mode: 'setting' } as Partial<EditorField>)} onSaved={onSaved} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Turn the lock/ }));
    await waitFor(() => expect(within(container).getByRole('alert')).toBeTruthy());
    expectFailureShownNextToField(container, shows);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it.each(FAILURES)('rating override, $name', async ({ respond, shows }) => {
    vi.stubGlobal('fetch', vi.fn(respond));
    const onSaved = vi.fn();
    const { container } = render(
      <FieldEditor ipoId={IPO} field={field('ipos.rating_override', { currentValue: false, mode: 'setting' } as Partial<EditorField>)} onSaved={onSaved} />
    );
    fireEvent.change(container.querySelector('input[name=source-note]')!, { target: { value: 'owner call' } });
    fireEvent.click(screen.getByRole('button', { name: /Turn the override/ }));
    await waitFor(() => expect(within(container).getByRole('alert')).toBeTruthy());
    expectFailureShownNextToField(container, shows);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('a later success clears the failure and says Saved', async () => {
    const responses = [
      json(400, { success: false, error: 'INVALID', reason: 'ipos.listingExchanges: unknown listing exchange "MCX" (NSE or BSE)' }),
      json(200, { success: true, data: { value: ['NSE'], version: 'v2' } }),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => responses.shift()!));
    const onSaved = vi.fn();
    const { container } = render(<FieldEditor ipoId={IPO} field={field('ipos.listing_exchanges')} onSaved={onSaved} />);
    fireEvent.change(container.querySelector('input[name=typed-value]')!, { target: { value: 'MCX' } });
    fireEvent.change(container.querySelector('input[name=source-note]')!, { target: { value: 'RHP p.12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save typed value' }));
    await waitFor(() => expect(within(container).getByRole('alert')).toBeTruthy());
    fireEvent.change(container.querySelector('input[name=typed-value]')!, { target: { value: 'NSE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save typed value' }));
    await waitFor(() => expect(container.textContent).toMatch(/Saved\./));
    expect(within(container).queryByRole('alert')).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});

describe('#1348 list editor: a refused add / edit / remove is shown next to the row', () => {
  const LIST_URL = `/api/admin/ipos/${IPO}/lists/promoters`;
  const listRows = [{ key: 'ramesh kumar', label: 'Ramesh Kumar', row: { name: 'Ramesh Kumar', sharesHeld: 1000 } }];

  function stubList(respond: () => Promise<Response>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe(LIST_URL);
        if (!init?.method || init.method === 'GET') return json(200, { success: true, data: { rows: listRows, version: 'v1', owned: false } });
        return respond();
      })
    );
  }

  it.each(FAILURES.filter((f) => f.name !== '409 hidden'))('add, $name', async ({ respond, shows }) => {
    stubList(respond);
    const { container } = render(<ListEditor ipoId={IPO} list="promoters" />);
    await waitFor(() => expect(screen.getAllByTestId('list-row')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Add a row' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Promoter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    await waitFor(() => expect(within(container).getByRole('alert')).toBeTruthy());
    expectFailureShownNextToField(container, shows);
    // The form stays open with what was typed, so the admin can correct it.
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('New Promoter');
  });

  it.each(FAILURES.filter((f) => f.name !== '409 hidden'))('edit, $name', async ({ respond, shows }) => {
    stubList(respond);
    render(<ListEditor ipoId={IPO} list="promoters" />);
    await waitFor(() => expect(screen.getAllByTestId('list-row')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save row' }));
    const row = screen.getByTestId('list-row');
    await waitFor(() => expect(within(row).getByRole('alert')).toBeTruthy());
    expectFailureShownNextToField(row, shows);
  });

  it.each(FAILURES.filter((f) => f.name !== '409 hidden'))('remove, $name', async ({ respond, shows }) => {
    stubList(respond);
    render(<ListEditor ipoId={IPO} list="promoters" />);
    await waitFor(() => expect(screen.getAllByTestId('list-row')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.change(screen.getByLabelText(/Why remove it/), { target: { value: 'duplicate row' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove row' }));
    const row = screen.getByTestId('list-row');
    await waitFor(() => expect(within(row).getByRole('alert')).toBeTruthy());
    expectFailureShownNextToField(row, shows);
  });
});

describe('#1348 hidden banner: a refused unhide is shown', () => {
  it.each(FAILURES.filter((f) => f.name !== '409 hidden'))('unhide, $name', async ({ respond, shows }) => {
    vi.stubGlobal('fetch', vi.fn(respond));
    const onUnhidden = vi.fn();
    const { container } = render(<HiddenBanner ipoId={IPO} hidden={{ at: '2026-09-30T10:00:00Z', reason: 'duplicate' }} onUnhidden={onUnhidden} />);
    fireEvent.click(screen.getByRole('button', { name: 'Unhide to edit' }));
    await waitFor(() => expect(within(container).getByRole('alert')).toBeTruthy());
    expect(within(container).getByRole('alert').textContent).toMatch(shows);
    expect(onUnhidden).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Unhide to edit' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
