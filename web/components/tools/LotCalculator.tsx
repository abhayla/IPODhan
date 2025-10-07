'use client';

/**
 * Lot Size Calculator Component
 *
 * Allows users to calculate number of lots they can buy with their investment amount
 * Features:
 * - Real-time calculation with debouncing (300ms)
 * - Input validation with Zod
 * - Currency formatting (₹ with comma separators)
 * - Dropdown to select IPO (standalone mode)
 * - Pre-filled IPO data (embedded mode)
 * - localStorage to remember last used IPO
 * - Mobile-responsive design
 *
 * @component
 */

import React, { useState, useEffect, useCallback } from 'react';
import { z } from 'zod';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

// ==================== TYPES ====================

interface IPOOption {
  id: string;
  companyName: string;
  slug: string;
  category: string;
  status: string;
  priceRangeMin: number | null;
  priceRangeMax: number | null;
  lotSize: number | null;
  openDate: string | null;
  closeDate: string | null;
}

interface LotCalculatorProps {
  /**
   * Mode: 'embedded' for IPO detail page, 'standalone' for dedicated page
   */
  mode?: 'embedded' | 'standalone';

  /**
   * Pre-filled IPO data (for embedded mode)
   */
  ipoData?: {
    id: string;
    companyName: string;
    slug: string;
    priceRangeMax: number;
    lotSize: number;
  };

  /**
   * Custom title (optional)
   */
  title?: string;

  /**
   * Custom description (optional)
   */
  description?: string;
}

interface CalculationResult {
  lots: number;
  totalShares: number;
  totalAmount: number;
}

// ==================== VALIDATION SCHEMA ====================

const investmentAmountSchema = z
  .number()
  .positive('Investment amount must be positive')
  .min(1, 'Investment amount must be at least ₹1');

// ==================== UTILITY FUNCTIONS ====================

/**
 * Format number as Indian Rupee with comma separators
 */
const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
};

/**
 * Format number with comma separators (no currency symbol)
 */
const formatNumber = (value: number): string => {
  return new Intl.NumberFormat('en-IN').format(value);
};

/**
 * Parse formatted currency string to number
 */
const parseCurrency = (value: string): number => {
  return Number(value.replace(/[^0-9]/g, ''));
};

/**
 * Calculate lots, shares, and total amount
 */
const calculateLots = (
  investmentAmount: number,
  pricePerShare: number,
  lotSize: number
): CalculationResult => {
  const lots = Math.floor(investmentAmount / (pricePerShare * lotSize));
  const totalShares = lots * lotSize;
  const totalAmount = lots * lotSize * pricePerShare;

  return {
    lots,
    totalShares,
    totalAmount,
  };
};

// ==================== COMPONENT ====================

export function LotCalculator({
  mode = 'standalone',
  ipoData,
  title = 'Lot Size Calculator',
  description = 'Calculate how many lots you can buy with your investment amount',
}: LotCalculatorProps) {
  // State
  const [investmentAmount, setInvestmentAmount] = useState<string>('');
  const [selectedIPOId, setSelectedIPOId] = useState<string>('');
  const [ipoOptions, setIPOOptions] = useState<IPOOption[]>([]);
  const [loading, setLoading] = useState<boolean>(mode === 'standalone');
  const [error, setError] = useState<string>('');
  const [validationError, setValidationError] = useState<string>('');
  const [result, setResult] = useState<CalculationResult | null>(null);

  // Debounce timer ref
  const debounceTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  // ==================== FETCH IPO OPTIONS ====================

  useEffect(() => {
    if (mode === 'standalone') {
      fetchIPOOptions();
    } else if (mode === 'embedded' && ipoData) {
      // In embedded mode, use provided IPO data
      setSelectedIPOId(ipoData.id);
    }
  }, [mode, ipoData]);

  const fetchIPOOptions = async () => {
    try {
      setLoading(true);
      setError('');

      const response = await fetch('/api/tools/lot-calculator');

      if (!response.ok) {
        throw new Error('Failed to fetch IPO data');
      }

      const data = await response.json();
      setIPOOptions(data.ipos || []);

      // Load last selected IPO from localStorage
      const lastIPOId = localStorage.getItem('lastSelectedIPO');
      if (lastIPOId && data.ipos.some((ipo: IPOOption) => ipo.id === lastIPOId)) {
        setSelectedIPOId(lastIPOId);
      } else if (data.ipos.length > 0) {
        setSelectedIPOId(data.ipos[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load IPO data');
    } finally {
      setLoading(false);
    }
  };

  // ==================== GET SELECTED IPO ====================

  const getSelectedIPO = useCallback((): {
    pricePerShare: number;
    lotSize: number;
    companyName: string;
  } | null => {
    if (mode === 'embedded' && ipoData) {
      return {
        pricePerShare: ipoData.priceRangeMax,
        lotSize: ipoData.lotSize,
        companyName: ipoData.companyName,
      };
    }

    const selectedIPO = ipoOptions.find((ipo) => ipo.id === selectedIPOId);
    if (selectedIPO && selectedIPO.priceRangeMax && selectedIPO.lotSize) {
      return {
        pricePerShare: selectedIPO.priceRangeMax,
        lotSize: selectedIPO.lotSize,
        companyName: selectedIPO.companyName,
      };
    }

    return null;
  }, [mode, ipoData, ipoOptions, selectedIPOId]);

  // ==================== HANDLE CALCULATION ====================

  const performCalculation = useCallback((amount: string) => {
    const selectedIPO = getSelectedIPO();

    if (!selectedIPO) {
      setValidationError('Please select an IPO');
      setResult(null);
      return;
    }

    const numericAmount = parseCurrency(amount);

    // Validate investment amount
    const validation = investmentAmountSchema.safeParse(numericAmount);

    if (!validation.success) {
      setValidationError(validation.error.issues[0].message);
      setResult(null);
      return;
    }

    // Check minimum investment (1 lot)
    const minInvestment = selectedIPO.pricePerShare * selectedIPO.lotSize;
    if (numericAmount < minInvestment) {
      setValidationError(
        `Minimum investment is ${formatCurrency(minInvestment)} (1 lot)`
      );
      setResult(null);
      return;
    }

    // Calculate
    const calculationResult = calculateLots(
      numericAmount,
      selectedIPO.pricePerShare,
      selectedIPO.lotSize
    );

    setValidationError('');
    setResult(calculationResult);
  }, [getSelectedIPO]);

  // ==================== HANDLE INPUT CHANGE (DEBOUNCED) ====================

  const handleInvestmentChange = (value: string) => {
    // Allow only numbers and format with commas
    const numericValue = value.replace(/[^0-9]/g, '');

    if (numericValue === '') {
      setInvestmentAmount('');
      setResult(null);
      setValidationError('');
      return;
    }

    const formatted = formatNumber(Number(numericValue));
    setInvestmentAmount(formatted);

    // Debounce calculation
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      performCalculation(formatted);
    }, 300);
  };

  // ==================== HANDLE IPO SELECTION ====================

  const handleIPOChange = (ipoId: string) => {
    setSelectedIPOId(ipoId);

    // Save to localStorage
    if (mode === 'standalone') {
      localStorage.setItem('lastSelectedIPO', ipoId);
    }

    // Recalculate if investment amount exists
    if (investmentAmount) {
      // Wait for state update, then recalculate
      setTimeout(() => {
        performCalculation(investmentAmount);
      }, 0);
    }
  };

  // ==================== CLEANUP ====================

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // ==================== RENDER ====================

  const selectedIPO = getSelectedIPO();

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Error Alert */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            {/* IPO Selection (Standalone Mode) */}
            {mode === 'standalone' && (
              <div className="space-y-2">
                <Label htmlFor="ipo-select">Select IPO</Label>
                <Select value={selectedIPOId} onValueChange={handleIPOChange}>
                  <SelectTrigger id="ipo-select">
                    <SelectValue placeholder="Choose an IPO" />
                  </SelectTrigger>
                  <SelectContent>
                    {ipoOptions.map((ipo) => (
                      <SelectItem key={ipo.id} value={ipo.id}>
                        {ipo.companyName} ({ipo.category})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* IPO Details (Embedded Mode) */}
            {mode === 'embedded' && selectedIPO && (
              <div className="rounded-lg bg-muted p-4">
                <p className="text-sm font-medium">{selectedIPO.companyName}</p>
                <p className="text-xs text-muted-foreground">
                  Price: {formatCurrency(selectedIPO.pricePerShare)} | Lot Size:{' '}
                  {formatNumber(selectedIPO.lotSize)} shares
                </p>
              </div>
            )}

            {/* Investment Amount Input */}
            <div className="space-y-2">
              <Label htmlFor="investment-amount">Investment Amount</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  ₹
                </span>
                <Input
                  id="investment-amount"
                  type="text"
                  placeholder="Enter amount (e.g., 15,000)"
                  value={investmentAmount}
                  onChange={(e) => handleInvestmentChange(e.target.value)}
                  className="pl-8"
                />
              </div>
              {validationError && (
                <p className="text-sm text-destructive">{validationError}</p>
              )}
            </div>

            {/* Calculation Result */}
            {result && result.lots > 0 && (
              <div className="space-y-4 rounded-lg border bg-accent/50 p-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Number of Lots</p>
                    <p className="text-2xl font-bold">{result.lots}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Shares</p>
                    <p className="text-2xl font-bold">
                      {formatNumber(result.totalShares)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Total Investment
                    </p>
                    <p className="text-2xl font-bold">
                      {formatCurrency(result.totalAmount)}
                    </p>
                  </div>
                </div>

                {selectedIPO && (
                  <div className="border-t pt-4">
                    <p className="text-xs text-muted-foreground">
                      Calculation:{' '}
                      <span className="font-mono">
                        {result.lots} lots × {formatNumber(selectedIPO.lotSize)}{' '}
                        shares × {formatCurrency(selectedIPO.pricePerShare)} ={' '}
                        {formatCurrency(result.totalAmount)}
                      </span>
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* No Lots Available */}
            {result && result.lots === 0 && (
              <Alert>
                <AlertDescription>
                  Investment amount is too low. Minimum required:{' '}
                  {selectedIPO &&
                    formatCurrency(
                      selectedIPO.pricePerShare * selectedIPO.lotSize
                    )}{' '}
                  (1 lot)
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
