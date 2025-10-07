import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AllotmentCheckerCard } from '@/components/ipo/AllotmentCheckerCard';

// Mock window.open
const mockWindowOpen = vi.fn();
global.window.open = mockWindowOpen;

describe('AllotmentCheckerCard', () => {
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

    // Invalid PAN - too short
    fireEvent.change(input, { target: { value: 'ABC12' } });
    expect(screen.getByText('PAN must be 10 characters')).toBeInTheDocument();

    // Invalid PAN - wrong format
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

  it('should show error when registrar URL is missing', () => {
    render(
      <AllotmentCheckerCard
        status="CLOSED"
        registrar="Link Intime"
        registrarUrl={null}
      />
    );

    expect(
      screen.getByText(/Registrar website URL is not available/)
    ).toBeInTheDocument();
  });
});
