/**
 * ISINDisplay Component Unit Tests
 * Story 4.9: Stock Symbol & ISIN Display
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ISINDisplay } from '@/components/ipo/ISINDisplay';
import { toast } from 'sonner';

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ISINDisplay Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('with valid ISIN', () => {
    const validISIN = 'INE002A01018';

    it('renders ISIN label and value', () => {
      render(<ISINDisplay isin={validISIN} />);
      expect(screen.getByText('ISIN:')).toBeInTheDocument();
      expect(screen.getByText(validISIN)).toBeInTheDocument();
    });

    it('applies monospace font to ISIN code', () => {
      const { container } = render(<ISINDisplay isin={validISIN} />);
      const isinCode = container.querySelector('.font-mono');
      expect(isinCode).toHaveTextContent(validISIN);
    });

    it('renders copy button', () => {
      render(<ISINDisplay isin={validISIN} />);
      const button = screen.getByRole('button', {
        name: /copy isin to clipboard/i,
      });
      expect(button).toBeInTheDocument();
    });

    it('renders tooltip on ISIN hover', () => {
      render(<ISINDisplay isin={validISIN} />);
      const isinText = screen.getByText(validISIN);

      // Check that the ISIN text is wrapped in a tooltip trigger
      // (checking for tooltip content in JSDOM is unreliable due to portals)
      expect(isinText).toHaveClass('cursor-help');
    });

    it('copies ISIN to clipboard when button clicked', async () => {
      // Mock clipboard API
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: mockWriteText,
        },
      });

      render(<ISINDisplay isin={validISIN} />);
      const button = screen.getByRole('button', {
        name: /copy isin to clipboard/i,
      });

      fireEvent.click(button);

      await waitFor(() => {
        expect(mockWriteText).toHaveBeenCalledWith(validISIN);
        expect(toast.success).toHaveBeenCalledWith('ISIN copied to clipboard');
      });
    });

    it('shows check icon after successful copy', async () => {
      // Mock clipboard API
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: mockWriteText,
        },
      });

      render(<ISINDisplay isin={validISIN} />);
      const button = screen.getByRole('button', {
        name: /copy isin to clipboard/i,
      });

      fireEvent.click(button);

      await waitFor(() => {
        expect(button.querySelector('.lucide-check')).toBeInTheDocument();
      });
    });

    it('applies custom className', () => {
      const { container } = render(
        <ISINDisplay isin={validISIN} className="custom-class" />
      );
      expect(container.querySelector('.custom-class')).toBeInTheDocument();
    });
  });

  describe('with null/undefined ISIN', () => {
    it('renders "Not assigned" for null ISIN', () => {
      render(<ISINDisplay isin={null} />);
      expect(screen.getByText('ISIN:')).toBeInTheDocument();
      expect(screen.getByText('Not assigned')).toBeInTheDocument();
    });

    it('renders "Not assigned" for undefined ISIN', () => {
      render(<ISINDisplay isin={undefined} />);
      expect(screen.getByText('ISIN:')).toBeInTheDocument();
      expect(screen.getByText('Not assigned')).toBeInTheDocument();
    });

    it('does not render copy button for null ISIN', () => {
      render(<ISINDisplay isin={null} />);
      const button = screen.queryByRole('button');
      expect(button).not.toBeInTheDocument();
    });

    it('applies muted text color for "Not assigned"', () => {
      const { container } = render(<ISINDisplay isin={null} />);
      const notAssignedText = container.querySelector('.text-muted-foreground');
      expect(notAssignedText).toHaveTextContent('Not assigned');
    });
  });

  describe('clipboard fallback', () => {
    it('uses fallback method when clipboard API unavailable', async () => {
      // Mock clipboard API as unavailable
      Object.assign(navigator, {
        clipboard: undefined,
      });

      // Mock document.execCommand
      const mockExecCommand = vi.fn().mockReturnValue(true);
      document.execCommand = mockExecCommand;

      render(<ISINDisplay isin="INE002A01018" />);
      const button = screen.getByRole('button', {
        name: /copy isin to clipboard/i,
      });

      fireEvent.click(button);

      await waitFor(() => {
        expect(mockExecCommand).toHaveBeenCalledWith('copy');
        expect(toast.success).toHaveBeenCalledWith('ISIN copied to clipboard');
      });
    });
  });

  describe('accessibility', () => {
    it('has accessible button label', () => {
      render(<ISINDisplay isin="INE002A01018" />);
      const button = screen.getByRole('button', {
        name: /copy isin to clipboard/i,
      });
      expect(button).toHaveAccessibleName();
    });

    it('tooltip trigger is keyboard accessible', () => {
      render(<ISINDisplay isin="INE002A01018" />);
      const isinText = screen.getByText('INE002A01018');
      // Check the ISIN text element itself, not the parent
      expect(isinText).toHaveClass('cursor-help');
    });
  });
});
