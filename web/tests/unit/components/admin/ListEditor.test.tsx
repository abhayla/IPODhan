/**
 * Spec §9.2 items 8, 20, 28(b) (OD-107): the list editor adds, edits and removes rows through the one
 * list route, carries the version token it opened with, and a remove needs a reason.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { ListEditor } from '@/components/admin/ipo-editor/ListEditor';

const IPO = '00000000-0000-4000-8000-000000000001';
const URL = `/api/admin/ipos/${IPO}/lists/promoters`;

let posts: Array<{ op: Record<string, unknown>; expectedVersion: string }>;
let version: number;
let rows: Array<{ key: string; label: string; row: Record<string, unknown> }>;
let conflictNext: boolean;

beforeEach(() => {
  posts = [];
  version = 1;
  conflictNext = false;
  rows = [
    { key: 'ramesh kumar', label: 'Ramesh Kumar', row: { name: 'Ramesh Kumar', sharesHeld: 1000 } },
    { key: 'suresh kumar', label: 'Suresh Kumar', row: { name: 'Suresh Kumar', sharesHeld: 500 } },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(URL);
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify({ success: true, data: { rows, version: `v${version}`, owned: posts.length > 0 } }), { status: 200 });
      }
      const body = JSON.parse(String(init.body));
      posts.push(body);
      if (conflictNext) {
        conflictNext = false;
        version++;
        return new Response(JSON.stringify({ success: false, error: 'CONFLICT', reason: 'someone else changed this list' }), { status: 409 });
      }
      version++;
      return new Response(JSON.stringify({ success: true, data: { kind: 'OK' } }), { status: 200 });
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

async function openEditor() {
  render(<ListEditor ipoId={IPO} list="promoters" />);
  await waitFor(() => expect(screen.getAllByTestId('list-row')).toHaveLength(2));
}

describe('ListEditor (OD-107)', () => {
  it('adds a row with the version token the list was opened with', async () => {
    await openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Add a row' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mahesh Kumar' } });
    fireEvent.change(screen.getByLabelText('Shares held'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ op: { kind: 'add', row: { name: 'Mahesh Kumar', sharesHeld: 250 } }, expectedVersion: 'v1' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Saved/));
  });

  it('edits a row by its key', async () => {
    await openEditor();
    const first = screen.getAllByTestId('list-row')[0];
    fireEvent.click(within(first).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(first).getByLabelText('Shares held'), { target: { value: '1200' } });
    fireEvent.click(within(first).getByRole('button', { name: 'Save row' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].op).toEqual({ kind: 'edit', rowKey: 'ramesh kumar', row: { name: 'Ramesh Kumar', sharesHeld: 1200 } });
  });

  it('a remove cannot be sent without a reason; with one it removes that row', async () => {
    await openEditor();
    const second = screen.getAllByTestId('list-row')[1];
    fireEvent.click(within(second).getByRole('button', { name: 'Remove' }));
    const removeBtn = within(second).getByRole('button', { name: 'Remove row' });
    expect(removeBtn).toHaveProperty('disabled', true);
    fireEvent.change(within(second).getByLabelText(/Why remove it/), { target: { value: 'ceased to be a promoter per the RHP' } });
    expect(removeBtn).toHaveProperty('disabled', false);
    fireEvent.click(removeBtn);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].op).toEqual({ kind: 'remove', rowKeys: ['suresh kumar'], reason: 'ceased to be a promoter per the RHP' });
  });

  it('a save refused because another admin changed the list reloads it and says so (item 20)', async () => {
    await openEditor();
    conflictNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Add a row' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Late Kumar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/someone else changed this list/));
    // the next save carries the reloaded token
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].expectedVersion).toBe('v2');
  });
});
