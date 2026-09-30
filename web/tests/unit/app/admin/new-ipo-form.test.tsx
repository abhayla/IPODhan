/**
 * The admin "New IPO" form (spec §9.2 item 15, OD-111): what it sends, where it goes after a create,
 * and how it shows a refusal (no identifier; an identifier another row already has).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { NewIpoForm } from '@/app/admin/(protected)/ipos/new/new-ipo-form';

const TYPES = ['IPO', 'FPO', 'BUYBACK'];

function fill(name: string, idValue: string, opts: { kind?: string; segment?: string; type?: string } = {}) {
  fireEvent.change(screen.getByLabelText('Company name'), { target: { value: name } });
  if (opts.type) fireEvent.change(screen.getByLabelText('Offering type'), { target: { value: opts.type } });
  if (opts.segment !== undefined) fireEvent.change(screen.getByLabelText(/^Segment/), { target: { value: opts.segment } });
  if (opts.kind) fireEvent.change(screen.getByLabelText('Identifier 1 kind'), { target: { value: opts.kind } });
  fireEvent.change(screen.getByLabelText('Identifier 1 value'), { target: { value: idValue } });
}

describe('NewIpoForm', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    push.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('offers every offering type it is given and every identifier kind OD-89 allows, no SEBI number', () => {
    render(<NewIpoForm offeringTypes={TYPES} />);
    const types = Array.from((screen.getByLabelText('Offering type') as HTMLSelectElement).options).map((o) => o.value);
    expect(types).toEqual(TYPES);
    const kinds = Array.from((screen.getByLabelText('Identifier 1 kind') as HTMLSelectElement).options).map((o) => o.value);
    expect(kinds).toEqual(['CIN', 'NSE_SYMBOL', 'BSE_SYMBOL', 'BSE_IPO_NO', 'NSE_ISSUE', 'CG_PAGE_ID']);
  });

  it('refuses locally with no identifier and sends nothing', async () => {
    render(<NewIpoForm offeringTypes={TYPES} />);
    fill('Acme Ltd', '', { segment: 'SME' });
    fireEvent.submit(screen.getByRole('form', { name: 'New IPO' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one identifier/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts name, type, segment and the filled identifiers, then opens the IPO editor', async () => {
    fetchMock.mockResolvedValue({
      status: 201,
      json: async () => ({ success: true, data: { kind: 'CREATED', ipoId: 'x', slug: 'acme-ltd', offeringType: 'IPO', editorPath: '/ipos/acme-ltd?edit=' } }),
    });
    render(<NewIpoForm offeringTypes={TYPES} />);
    fill('Acme Ltd', 'ACME', { kind: 'NSE_SYMBOL', segment: 'MAINBOARD' });
    fireEvent.submit(screen.getByRole('form', { name: 'New IPO' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/ipos/acme-ltd?edit='));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/ipos');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(JSON.parse(init.body)).toEqual({
      companyName: 'Acme Ltd', offeringType: 'IPO', segment: 'MAINBOARD',
      identifiers: [{ kind: 'NSE_SYMBOL', value: 'ACME' }], sourceNote: null,
    });
  });

  it('a non-IPO type with no detail page says so instead of redirecting', async () => {
    fetchMock.mockResolvedValue({
      status: 201,
      json: async () => ({ success: true, data: { kind: 'CREATED', ipoId: 'y', slug: 'acme-buyback', offeringType: 'BUYBACK', editorPath: null } }),
    });
    render(<NewIpoForm offeringTypes={TYPES} />);
    fill('Acme Buyback', '7123', { kind: 'BSE_IPO_NO', type: 'BUYBACK' });
    fireEvent.submit(screen.getByRole('form', { name: 'New IPO' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/no detail page yet/);
    expect(push).not.toHaveBeenCalled();
  });

  it('shows the server refusal naming the existing row, with a link to edit it', async () => {
    fetchMock.mockResolvedValue({
      status: 409,
      json: async () => ({ error: { code: 'CONFLICT', message: 'Not created: this offering already exists as "Acme Ltd" (acme-ltd)', details: { existingSlug: 'acme-ltd' } } }),
    });
    render(<NewIpoForm offeringTypes={TYPES} />);
    fill('Acme Limited', 'ACME', { kind: 'NSE_SYMBOL', segment: 'MAINBOARD' });
    fireEvent.submit(screen.getByRole('form', { name: 'New IPO' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('already exists as "Acme Ltd" (acme-ltd)');
    expect(screen.getByRole('link', { name: /existing row/ })).toHaveAttribute('href', '/ipos/acme-ltd?edit=');
    expect(push).not.toHaveBeenCalled();
  });
});
