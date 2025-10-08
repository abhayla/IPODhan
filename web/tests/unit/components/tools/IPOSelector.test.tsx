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
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IPOSelector } from '@/components/tools/IPOSelector';
import type { IPO } from '@/lib/repositories/types';

// ==================== TEST DATA ====================

const mockIPOs: IPO[] = [
  {
    id: 'ipo-1',
    companyName: 'Alpha Tech IPO',
    slug: 'alpha-tech-ipo',
    category: 'MAINBOARD',
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
  },
  {
    id: 'ipo-2',
    companyName: 'Beta Finance IPO',
    slug: 'beta-finance-ipo',
    category: 'MAINBOARD',
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
  },
  {
    id: 'ipo-3',
    companyName: 'Gamma Industries IPO',
    slug: 'gamma-industries-ipo',
    category: 'SME',
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
  },
  {
    id: 'ipo-4',
    companyName: 'Delta Energy IPO',
    slug: 'delta-energy-ipo',
    category: 'MAINBOARD',
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
  },
];

// ==================== TESTS ====================

describe('IPOSelector Component', () => {
  const mockOnSelectionChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render with empty state when no IPOs selected', () => {
    render(
      <IPOSelector
        selectedSlugs={[]}
        onSelectionChange={mockOnSelectionChange}
        availableIPOs={mockIPOs}
      />
    );

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

  it('should display selected IPOs as badges', () => {
    const selectedSlugs = ['alpha-tech-ipo', 'beta-finance-ipo'];

    render(
      <IPOSelector
        selectedSlugs={selectedSlugs}
        onSelectionChange={mockOnSelectionChange}
        availableIPOs={mockIPOs}
      />
    );

    expect(screen.getByText('Alpha Tech IPO')).toBeInTheDocument();
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

    // Find and click the remove button
    const removeButton = screen.getByLabelText(/Remove Alpha Tech IPO/i);
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
});
