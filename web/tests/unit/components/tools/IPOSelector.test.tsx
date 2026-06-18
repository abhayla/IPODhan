/**
 * Unit Tests for IPOSelector Component
 *
 * Tests:
 * - IPO selection and removal
 * - Maximum 3 IPO limit enforcement
 * - Empty state rendering
 * - Selected IPO badge display
 * - Clear all functionality
 * - Callback invocation on selection change
 * - Slug validation (ISS-027)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IPO } from '@/lib/repositories/types';
import { mockIPO } from '@/lib/db/types';

// IPOSelector keeps a module-level slug-validation cache. Re-import it per test
// (vi.resetModules in beforeEach) so the cache doesn't leak across tests.
let IPOSelector: typeof import('@/components/tools/IPOSelector')['IPOSelector'];

// Mock global fetch
global.fetch = vi.fn();

// ==================== TEST DATA ====================

const mockIPOs: IPO[] = [
  mockIPO({
    id: 'ipo-1',
    companyName: 'Alpha Tech IPO',
    slug: 'alpha-tech-ipo',
    segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
    status: 'OPEN',
    sector: 'Technology',
    priceRangeMin: 300,
    priceRangeMax: 350,
    lotSize: 40,
    issueSize: '1000',
    openDate: '2024-01-01',
    closeDate: '2024-01-05',
    allotmentDate: null,
    listingDate: null,
    companyDescription: null,
    faceValue: null,
    listingExchanges: null,
    registrar: null,
    registrarId: null,
    leadManagers: null,
    rating: 4,
    ratingRationale: 'Good fundamentals',
    ratingOverride: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastScrapedAt: null,
  }),
  mockIPO({
    id: 'ipo-2',
    companyName: 'Beta Finance IPO',
    slug: 'beta-finance-ipo',
    segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
    status: 'UPCOMING',
    sector: 'Finance',
    priceRangeMin: 500,
    priceRangeMax: 600,
    lotSize: 25,
    issueSize: '2000',
    openDate: '2024-02-01',
    closeDate: '2024-02-05',
    allotmentDate: null,
    listingDate: null,
    companyDescription: null,
    faceValue: null,
    listingExchanges: null,
    registrar: null,
    registrarId: null,
    leadManagers: null,
    rating: 3,
    ratingRationale: null,
    ratingOverride: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastScrapedAt: null,
  }),
  mockIPO({
    id: 'ipo-3',
    companyName: 'Gamma Industries IPO',
    slug: 'gamma-industries-ipo',
    segment: 'SME' as const,
  offeringType: 'IPO' as const,
    status: 'CLOSED',
    sector: 'Manufacturing',
    priceRangeMin: 150,
    priceRangeMax: 180,
    lotSize: 75,
    issueSize: '500',
    openDate: '2024-01-10',
    closeDate: '2024-01-15',
    allotmentDate: null,
    listingDate: null,
    companyDescription: null,
    faceValue: null,
    listingExchanges: null,
    registrar: null,
    registrarId: null,
    leadManagers: null,
    rating: 5,
    ratingRationale: 'Excellent opportunity',
    ratingOverride: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastScrapedAt: null,
  }),
  mockIPO({
    id: 'ipo-4',
    companyName: 'Delta Energy IPO',
    slug: 'delta-energy-ipo',
    segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
    status: 'OPEN',
    sector: 'Energy',
    priceRangeMin: 400,
    priceRangeMax: 450,
    lotSize: 30,
    issueSize: '3000',
    openDate: '2024-01-20',
    closeDate: '2024-01-25',
    allotmentDate: null,
    listingDate: null,
    companyDescription: null,
    faceValue: null,
    listingExchanges: null,
    registrar: null,
    registrarId: null,
    leadManagers: null,
    rating: 4,
    ratingRationale: 'Strong potential',
    ratingOverride: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastScrapedAt: null,
  }),
];

// ==================== TESTS ====================

describe('IPOSelector Component', () => {
  const mockOnSelectionChange = vi.fn();

  beforeEach(async () => {
    // Fresh module → fresh slugValidationCache, so per-test fetch behavior isn't
    // masked by a cached validation result from a previous test.
    vi.resetModules();
    vi.clearAllMocks();
    // Mock successful validation by default (set before importing the component)
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    ({ IPOSelector } = await import('@/components/tools/IPOSelector'));
  });

  it('should render with empty state when no IPOs selected', async () => {
    render(
      <IPOSelector
        selectedSlugs={[]}
        onSelectionChange={mockOnSelectionChange}
        availableIPOs={mockIPOs}
      />
    );

    // Wait for validation to complete
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    expect(screen.getByText(/Select IPOs to Compare/i)).toBeInTheDocument();
    expect(
      screen.getByText(/No IPOs selected yet/i)
    ).toBeInTheDocument();
  });

  it('should display selection counter showing 0/3', () => {
    render(
      <IPOSelector
        selectedSlugs={[]}
        onSelectionChange={mockOnSelectionChange}
        availableIPOs={mockIPOs}
      />
    );

    expect(screen.getByText(/0 \/ 3 selected/i)).toBeInTheDocument();
  });

  it('should display selected IPOs as badges', async () => {
    const selectedSlugs = ['alpha-tech-ipo', 'beta-finance-ipo'];

    render(
      <IPOSelector
        selectedSlugs={selectedSlugs}
        onSelectionChange={mockOnSelectionChange}
        availableIPOs={mockIPOs}
      />
    );

    // Selected badges render only after async slug validation completes.
    await waitFor(() => {
      expect(screen.getByText('Alpha Tech IPO')).toBeInTheDocument();
    });
    expect(screen.getByText('Beta Finance IPO')).toBeInTheDocument();
    expect(screen.getByText(/2 \/ 3 selected/i)).toBeInTheDocument();
  });

  it('should call onSelectionChange when IPO is selected', async () => {
    const user = userEvent.setup();

    render(
      <IPOSelector
        selectedSlugs={[]}
        onSelectionChange={mockOnSelectionChange}
        availableIPOs={mockIPOs}
      />
    );

    // Open dropdown
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    // Wait for dropdown to open and select an option
    await waitFor(() => {
      const option = screen.getByText(/Alpha Tech IPO/i);
      expect(option).toBeInTheDocument();
    });

    const option = screen.getByText(/Alpha Tech IPO/i);
    await user.click(option);

    expect(mockOnSelectionChange).toHaveBeenCalledWith(['alpha-tech-ipo']);
  });

  it('should remove IPO when remove button is clicked', async () => {
    const user = userEvent.setup();
    const selectedSlugs = ['alpha-tech-ipo'];

    render(
      <IPOSelector
        selectedSlugs={selectedSlugs}
        onSelectionChange={mockOnSelectionChange}
        availableIPOs={mockIPOs}
      />
    );

    // Badges render after async slug validation — wait for the remove button.
    const removeButton = await screen.findByLabelText(/Remove Alpha Tech IPO/i);
    await user.click(removeButton);

    expect(mockOnSelectionChange).toHaveBeenCalledWith([]);
  });

  it('should enforce maximum 3 IPO limit', () => {
    const selectedSlugs = [
      'alpha-tech-ipo',
      'beta-finance-ipo',
      'gamma-industries-ipo',
    ];

    render(
      <IPOSelector
        selectedSlugs={selectedSlugs}
        onSelectionChange={mockOnSelectionChange}
        availableIPOs={mockIPOs}
        maxSelection={3}
      />
    );

    // Check that selector is disabled when max reached
    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeDisabled();
    expect(screen.getByText(/3 \/ 3 selected/i)).toBeInTheDocument();
  });

  it('should show "Clear All" button when IPOs are selected', async () => {
    const user = userEvent.setup();
    const selectedSlugs = ['alpha-tech-ipo', 'beta-finance-ipo'];

    render(
      <IPOSelector
        selectedSlugs={selectedSlugs}
        onSelectionChange={mockOnSelectionChange}
        availableIPOs={mockIPOs}
      />
    );

    const clearButton = screen.getByRole('button', { name: /Clear All/i });
    expect(clearButton).toBeInTheDocument();

    await user.click(clearButton);
    expect(mockOnSelectionChange).toHaveBeenCalledWith([]);
  });

  it('should not show "Clear All" button when no IPOs selected', () => {
    render(
      <IPOSelector
        selectedSlugs={[]}
        onSelectionChange={mockOnSelectionChange}
        availableIPOs={mockIPOs}
      />
    );

    const clearButton = screen.queryByRole('button', { name: /Clear All/i });
    expect(clearButton).not.toBeInTheDocument();
  });

  it('should filter out already selected IPOs from dropdown', async () => {
    const user = userEvent.setup();
    const selectedSlugs = ['alpha-tech-ipo'];

    render(
      <IPOSelector
        selectedSlugs={selectedSlugs}
        onSelectionChange={mockOnSelectionChange}
        availableIPOs={mockIPOs}
      />
    );

    // Open dropdown
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    // Alpha Tech IPO should not be in dropdown (already selected)
    await waitFor(() => {
      expect(screen.queryByText(/Alpha Tech IPO.*Lot Size/)).not.toBeInTheDocument();
      expect(screen.getByText(/Beta Finance IPO/)).toBeInTheDocument();
    });
  });

  it('should show validation message when only 1 IPO selected', () => {
    const selectedSlugs = ['alpha-tech-ipo'];

    render(
      <IPOSelector
        selectedSlugs={selectedSlugs}
        onSelectionChange={mockOnSelectionChange}
        availableIPOs={mockIPOs}
      />
    );

    expect(
      screen.getByText(/Please select at least one more IPO/i)
    ).toBeInTheDocument();
  });

  it('should respect custom maxSelection prop', () => {
    const selectedSlugs = ['alpha-tech-ipo', 'beta-finance-ipo'];

    render(
      <IPOSelector
        selectedSlugs={selectedSlugs}
        onSelectionChange={mockOnSelectionChange}
        availableIPOs={mockIPOs}
        maxSelection={2}
      />
    );

    // Should show 2/2 selected
    expect(screen.getByText(/2 \/ 2 selected/i)).toBeInTheDocument();

    // Selector should be disabled
    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeDisabled();
  });

  it('should handle empty availableIPOs array', () => {
    render(
      <IPOSelector
        selectedSlugs={[]}
        onSelectionChange={mockOnSelectionChange}
        availableIPOs={[]}
      />
    );

    expect(screen.getByText(/Select IPOs to Compare/i)).toBeInTheDocument();
  });

  // ==================== VALIDATION TESTS (ISS-027) ====================

  describe('Slug Validation', () => {
    it('should validate IPO slugs on mount', async () => {
      render(
        <IPOSelector
          selectedSlugs={[]}
          onSelectionChange={mockOnSelectionChange}
          availableIPOs={mockIPOs}
        />
      );

      // Wait for validation to complete
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(mockIPOs.length);
      });

      // Verify HEAD requests were made for each IPO
      mockIPOs.forEach((ipo) => {
        expect(global.fetch).toHaveBeenCalledWith(
          `/api/ipos/${ipo.slug}`,
          { method: 'HEAD' }
        );
      });
    });

    it('should filter out invalid IPOs from dropdown', async () => {
      const user = userEvent.setup();

      // Mock fetch to return 404 for specific slug
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
        if (url.includes('alpha-tech-ipo')) {
          return Promise.resolve({ ok: false, status: 404 } as Response);
        }
        return Promise.resolve({ ok: true } as Response);
      });

      render(
        <IPOSelector
          selectedSlugs={[]}
          onSelectionChange={mockOnSelectionChange}
          availableIPOs={mockIPOs}
        />
      );

      // Wait for validation to complete
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      // Open dropdown
      const trigger = screen.getByRole('combobox');
      await user.click(trigger);

      // Alpha Tech IPO should not be in dropdown (invalid slug)
      await waitFor(() => {
        expect(screen.queryByText(/Alpha Tech IPO/)).not.toBeInTheDocument();
        // Other IPOs should still be available
        expect(screen.getByText(/Beta Finance IPO/)).toBeInTheDocument();
      });
    });

    it('should display warning alert when IPOs are filtered', async () => {
      // Mock fetch to return 404 for 2 IPOs
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
        if (url.includes('alpha-tech-ipo') || url.includes('beta-finance-ipo')) {
          return Promise.resolve({ ok: false, status: 404 } as Response);
        }
        return Promise.resolve({ ok: true } as Response);
      });

      render(
        <IPOSelector
          selectedSlugs={[]}
          onSelectionChange={mockOnSelectionChange}
          availableIPOs={mockIPOs}
        />
      );

      // Wait for validation and alert to appear
      await waitFor(() => {
        expect(screen.getByText(/2 IPOs filtered due to invalid slugs/i)).toBeInTheDocument();
      });

      // Alert should have destructive variant styling
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
    });

    it('should use cached validation results', async () => {
      const { rerender } = render(
        <IPOSelector
          selectedSlugs={[]}
          onSelectionChange={mockOnSelectionChange}
          availableIPOs={mockIPOs}
        />
      );

      // Wait for initial validation
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(mockIPOs.length);
      });

      const initialCallCount = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

      // Re-render with same IPOs
      rerender(
        <IPOSelector
          selectedSlugs={[]}
          onSelectionChange={mockOnSelectionChange}
          availableIPOs={mockIPOs}
        />
      );

      // Wait a bit to ensure no new calls are made
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Fetch should use cached results (no additional calls)
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(initialCallCount);
    });

    it('should handle validation errors gracefully', async () => {
      // Mock fetch to throw error
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(
        <IPOSelector
          selectedSlugs={[]}
          onSelectionChange={mockOnSelectionChange}
          availableIPOs={mockIPOs}
        />
      );

      // Wait for validation to complete
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      // Graceful = no crash + the error is logged. (On a validation error the
      // component deliberately marks slugs invalid "to be safe", so the affected
      // IPOs are filtered out rather than shown.)
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(screen.getByRole('combobox')).toBeInTheDocument();

      consoleErrorSpy.mockRestore();
    });

    it('should show loading state during validation', async () => {
      // Mock fetch with delay
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({ ok: true } as Response);
          }, 100);
        });
      });

      render(
        <IPOSelector
          selectedSlugs={[]}
          onSelectionChange={mockOnSelectionChange}
          availableIPOs={mockIPOs}
        />
      );

      // Should show loading placeholder
      const trigger = screen.getByRole('combobox');
      expect(trigger).toHaveTextContent(/Validating IPOs.../i);

      // Wait for validation to complete
      await waitFor(() => {
        expect(trigger).not.toHaveTextContent(/Validating IPOs.../i);
      });
    });

    it('should log warning for invalid slugs to console', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Mock fetch to return 404 for one IPO
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
        if (url.includes('alpha-tech-ipo')) {
          return Promise.resolve({ ok: false, status: 404 } as Response);
        }
        return Promise.resolve({ ok: true } as Response);
      });

      render(
        <IPOSelector
          selectedSlugs={[]}
          onSelectionChange={mockOnSelectionChange}
          availableIPOs={mockIPOs}
        />
      );

      // Wait for validation
      await waitFor(() => {
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('[IPO Compare] Invalid slug detected: alpha-tech-ipo')
        );
      });

      consoleWarnSpy.mockRestore();
    });

    it('should handle single invalid slug alert correctly', async () => {
      // Mock fetch to return 404 for one IPO
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
        if (url.includes('alpha-tech-ipo')) {
          return Promise.resolve({ ok: false, status: 404 } as Response);
        }
        return Promise.resolve({ ok: true } as Response);
      });

      render(
        <IPOSelector
          selectedSlugs={[]}
          onSelectionChange={mockOnSelectionChange}
          availableIPOs={mockIPOs}
        />
      );

      // Wait for validation and alert
      await waitFor(() => {
        // Should use singular "IPO" not "IPOs"
        expect(screen.getByText(/1 IPO filtered due to invalid slugs/i)).toBeInTheDocument();
      });
    });
  });
});
