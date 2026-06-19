import { describe, it, expect } from 'vitest';
import {
  calculateDataCompleteness,
  transformFinancialDataWithMargins,
  hasMinimumFinancialData,
} from '@/components/ipo/charts/FinancialPerformanceCharts/utils';
import type { FinancialDataFromDB } from '@/components/ipo/charts/FinancialPerformanceCharts/types';

// #54 catch-test: the compact Chittorgarh source stores "Total Income" but not
// "Revenue from operations", so ~132 IPOs have total_income_fy* populated and
// revenue_fy* null. The completeness counter and the chart top-line MUST treat
// total income as the top-line when revenue is absent — else the page falsely
// reports "No revenue data" over data that exists.

const incomeOnly = {
  revenueFy2022: null, revenueFy2023: null, revenueFy2024: null,
  totalIncomeFy2022: '100', totalIncomeFy2023: '150', totalIncomeFy2024: '200',
  profitFy2022: '10', profitFy2023: '15', profitFy2024: '20',
  ebitdaFy2022: null, ebitdaFy2023: null, ebitdaFy2024: null,
} as unknown as FinancialDataFromDB;

describe('#54 — total income counts as the top-line', () => {
  it('calculateDataCompleteness counts total income toward the 3 top-line fields', () => {
    const r = calculateDataCompleteness(incomeOnly);
    // 3 top-line (via total income) + 3 profit = 6 of 9 filled = 67%.
    expect(r.filledFields).toBe(6);
    expect(r.percentage).toBe(67);
    // the top-line fields are NOT reported missing just because revenue_fy* is null
    expect(r.missingFields).not.toContain('revenueFy2022');
    expect(r.missingFields).not.toContain('revenueFy2024');
  });

  it('still reports a genuinely empty top-line as missing', () => {
    const empty = { ...incomeOnly, totalIncomeFy2022: null, totalIncomeFy2023: null, totalIncomeFy2024: null } as unknown as FinancialDataFromDB;
    const r = calculateDataCompleteness(empty);
    expect(r.missingFields).toContain('revenueFy2022');
  });

  it('hasMinimumFinancialData passes income-only IPOs (sibling gate — caught via G-UI)', () => {
    // The whole Financial Performance section is gated on this; income-only IPOs (2+
    // years of total income, no revenue) MUST clear it so the chart renders.
    const incomeNoProfit = {
      revenueFy2022: null, revenueFy2023: null, revenueFy2024: null,
      totalIncomeFy2022: null, totalIncomeFy2023: '150', totalIncomeFy2024: '200',
      profitFy2022: null, profitFy2023: null, profitFy2024: null,
    } as unknown as FinancialDataFromDB;
    expect(hasMinimumFinancialData(incomeNoProfit)).toBe(true);
    // a single year of only total income is still insufficient
    const oneYear = { ...incomeNoProfit, totalIncomeFy2023: null } as unknown as FinancialDataFromDB;
    expect(hasMinimumFinancialData(oneYear)).toBe(false);
  });

  it('transformFinancialDataWithMargins surfaces totalIncome per year (chart can plot it)', () => {
    const rows = transformFinancialDataWithMargins(incomeOnly);
    expect(rows).toHaveLength(3);
    expect(rows[0].revenue).toBeNull();
    expect(rows[0].totalIncome).toBe(100);
    expect(rows[2].totalIncome).toBe(200);
  });
});
