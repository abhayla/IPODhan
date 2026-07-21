import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AllotmentCheckerCard } from '@/components/ipo/AllotmentCheckerCard';
import * as gtag from '@/lib/analytics/gtag';

// Mock window.open
const mockWindowOpen = vi.fn();
global.window.open = mockWindowOpen;

// Mock gtag module
vi.mock('@/lib/analytics/gtag', () => ({
  trackAllotmentCheck: vi.fn(),
}));

describe('AllotmentCheckerCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not render for UPCOMING status', () => {
    const { container } = render(
      <AllotmentCheckerCard
        status="UPCOMING"
        registrar="Link Intime"
        registrarUrl="https://example.com"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('should not render for OPEN status', () => {
    const { container } = render(
      <AllotmentCheckerCard
        status="OPEN"
        registrar="Link Intime"
        registrarUrl="https://example.com"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('should render for CLOSED status', () => {
    render(
      <AllotmentCheckerCard
        status="CLOSED"
        registrar="Link Intime"
        registrarUrl="https://example.com"
      />
    );
    expect(screen.getByText('Check Allotment Status')).toBeInTheDocument();
  });

  it('should render for LISTED status', () => {
    render(
      <AllotmentCheckerCard
        status="LISTED"
        registrar="KFin Technologies"
        registrarUrl="https://example.com"
      />
    );
    expect(screen.getAllByText(/KFin Technologies/)[0]).toBeInTheDocument();
  });

  it('should validate PAN format correctly', () => {
    render(
      <AllotmentCheckerCard
        status="CLOSED"
        registrar="Link Intime"
        registrarUrl="https://example.com"
      />
    );

    const input = screen.getByPlaceholderText('ABCDE1234F');

    // Invalid PAN - too short: component validates on change and shows the
    // length error for any input that isn't exactly 10 characters.
    fireEvent.change(input, { target: { value: 'ABC12' } });
    expect(screen.getByText('PAN must be 10 characters')).toBeInTheDocument();

    // Invalid PAN - wrong format (error shown when 10 characters)
    fireEvent.change(input, { target: { value: '1234567890' } });
    expect(
      screen.getByText('Invalid PAN format (e.g., ABCDE1234F)')
    ).toBeInTheDocument();
  });

  it('should accept valid PAN format', () => {
    render(
      <AllotmentCheckerCard
        status="CLOSED"
        registrar="Link Intime"
        registrarUrl="https://example.com"
      />
    );

    const input = screen.getByPlaceholderText('ABCDE1234F');

    fireEvent.change(input, { target: { value: 'ABCDE1234F' } });
    expect(screen.queryByText(/Invalid PAN/)).not.toBeInTheDocument();
  });

  it('should convert PAN to uppercase', () => {
    render(
      <AllotmentCheckerCard
        status="CLOSED"
        registrar="Link Intime"
        registrarUrl="https://example.com"
      />
    );

    const input = screen.getByPlaceholderText('ABCDE1234F') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'abcde1234f' } });
    expect(input.value).toBe('ABCDE1234F');
  });

  it('should disable button when PAN is invalid', () => {
    render(
      <AllotmentCheckerCard
        status="CLOSED"
        registrar="Link Intime"
        registrarUrl="https://example.com"
      />
    );

    const button = screen.getByRole('button', { name: /Check Status/ });
    expect(button).toBeDisabled();
  });

  it('should enable button when PAN is valid', () => {
    render(
      <AllotmentCheckerCard
        status="CLOSED"
        registrar="Link Intime"
        registrarUrl="https://example.com"
      />
    );

    const input = screen.getByPlaceholderText('ABCDE1234F');
    fireEvent.change(input, { target: { value: 'ABCDE1234F' } });

    const button = screen.getByRole('button', { name: /Check Status/ });
    expect(button).not.toBeDisabled();
  });

  it('should show privacy notice', () => {
    render(
      <AllotmentCheckerCard
        status="CLOSED"
        registrar="Link Intime"
        registrarUrl="https://example.com"
      />
    );

    expect(screen.getByText(/Your PAN is not stored/)).toBeInTheDocument();
  });

  it('should show a quiet registrars-directory fallback when registrar URL is missing (R28 #3 — no CTA + error pair)', () => {
    render(
      <AllotmentCheckerCard
        status="CLOSED"
        registrar="Link Intime"
        registrarUrl={null}
      />
    );

    expect(
      screen.getByText(/Direct link for Link Intime isn't available yet/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'registrars directory' })
    ).toHaveAttribute('href', '/registrars');
  });

  it('should not render a Check Status button when registrarUrl is null (R28 #3)', () => {
    render(
      <AllotmentCheckerCard
        status="LISTED"
        registrar="N/A"
        registrarUrl={null}
      />
    );

    const input = screen.getByPlaceholderText('ABCDE1234F');
    fireEvent.change(input, { target: { value: 'ABCDE1234F' } });

    expect(
      screen.queryByRole('button', { name: /Check Status/ })
    ).not.toBeInTheDocument();
  });

  it('should track analytics event on valid submission', async () => {
    render(
      <AllotmentCheckerCard
        status="CLOSED"
        registrar="Link Intime"
        registrarUrl="https://example.com"
        companyName="TechCorp"
      />
    );

    const input = screen.getByPlaceholderText('ABCDE1234F');
    fireEvent.change(input, { target: { value: 'ABCDE1234F' } });

    const button = screen.getByRole('button', { name: /Check Status/ });
    fireEvent.click(button);

    await waitFor(() => {
      expect(gtag.trackAllotmentCheck).toHaveBeenCalledWith('TechCorp', 'Link Intime');
    });
  });

  it('should not track analytics when companyName is missing', async () => {
    render(
      <AllotmentCheckerCard
        status="CLOSED"
        registrar="Link Intime"
        registrarUrl="https://example.com"
      />
    );

    const input = screen.getByPlaceholderText('ABCDE1234F');
    fireEvent.change(input, { target: { value: 'ABCDE1234F' } });

    const button = screen.getByRole('button', { name: /Check Status/ });
    fireEvent.click(button);

    await waitFor(() => {
      expect(gtag.trackAllotmentCheck).not.toHaveBeenCalled();
    });
  });

  it('should redirect to registrar URL with PAN parameter', async () => {
    render(
      <AllotmentCheckerCard
        status="CLOSED"
        registrar="Link Intime"
        registrarUrl="https://example.com/check"
        companyName="TechCorp"
      />
    );

    const input = screen.getByPlaceholderText('ABCDE1234F');
    fireEvent.change(input, { target: { value: 'ABCDE1234F' } });

    const button = screen.getByRole('button', { name: /Check Status/ });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockWindowOpen).toHaveBeenCalledWith(
        'https://example.com/check?pan=ABCDE1234F',
        '_blank'
      );
    });
  });
});
