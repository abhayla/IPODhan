/**
 * Peer Comparison Service
 *
 * Service layer for processing peer company comparison data.
 * Calculates industry averages and prepares comparison data for UI display.
 *
 * Story 4.8: Peer Comparison Tab
 */

import type { PeerCompany, FinancialData } from '@ipodhan/shared/types/types';

// ==================== TYPES ====================

/**
 * Comparison row data structure
 */
export interface ComparisonRow {
  companyName: string;
  sector: string | null;
  listedStatus: string;
  peRatio: number | null;
  eps: number | null;
  dilutedEps: number | null;
  ronw: number | null;
  nav: number | null;
  pbvRatio: number | null;
  financialStatementType: string | null;
  isIPO: boolean;
  isIndustryAverage: boolean;
}

/**
 * Complete peer comparison data
 */
export interface PeerComparisonData {
  ipoRow: ComparisonRow;
  peerRows: ComparisonRow[];
  industryAverageRow: ComparisonRow;
  dataSource: string;
  lastUpdated: Date | null;
  financialStatementType: string | null;
}

// ==================== SERVICE FUNCTIONS ====================

/**
 * Calculate industry average from peer company data
 * Excludes null values from calculation
 */
function calculateIndustryAverage(
  peerCompanies: PeerCompany[]
): Omit<ComparisonRow, 'companyName' | 'sector' | 'listedStatus' | 'isIPO' | 'isIndustryAverage'> {
  const metrics = {
    peRatio: [] as number[],
    eps: [] as number[],
    dilutedEps: [] as number[],
    ronw: [] as number[],
    nav: [] as number[],
    pbvRatio: [] as number[],
  };

  // Collect non-null values
  peerCompanies.forEach((peer) => {
    if (peer.peRatio !== null) metrics.peRatio.push(Number(peer.peRatio));
    if (peer.eps !== null) metrics.eps.push(Number(peer.eps));
    if (peer.dilutedEps !== null) metrics.dilutedEps.push(Number(peer.dilutedEps));
    if (peer.ronw !== null) metrics.ronw.push(Number(peer.ronw));
    if (peer.nav !== null) metrics.nav.push(Number(peer.nav));
    if (peer.pbvRatio !== null) metrics.pbvRatio.push(Number(peer.pbvRatio));
  });

  // Calculate averages
  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((sum, val) => sum + val, 0) / arr.length : null;

  // Determine most common financial statement type
  const statementTypes = peerCompanies
    .map((p) => p.financialStatementType)
    .filter((t) => t !== null);
  const financialStatementType =
    statementTypes.length > 0
      ? statementTypes.sort(
          (a, b) =>
            statementTypes.filter((t) => t === a).length -
            statementTypes.filter((t) => t === b).length
        )[statementTypes.length - 1] || null
      : null;

  return {
    peRatio: avg(metrics.peRatio),
    eps: avg(metrics.eps),
    dilutedEps: avg(metrics.dilutedEps),
    ronw: avg(metrics.ronw),
    nav: avg(metrics.nav),
    pbvRatio: avg(metrics.pbvRatio),
    financialStatementType,
  };
}

/**
 * Convert PeerCompany to ComparisonRow
 */
function peerToComparisonRow(peer: PeerCompany): ComparisonRow {
  return {
    companyName: peer.companyName,
    sector: peer.sector,
    listedStatus: peer.isListed ? 'Listed' : 'Unlisted',
    peRatio: peer.peRatio ? Number(peer.peRatio) : null,
    eps: peer.eps ? Number(peer.eps) : null,
    dilutedEps: peer.dilutedEps ? Number(peer.dilutedEps) : null,
    ronw: peer.ronw ? Number(peer.ronw) : null,
    nav: peer.nav ? Number(peer.nav) : null,
    pbvRatio: peer.pbvRatio ? Number(peer.pbvRatio) : null,
    financialStatementType: peer.financialStatementType,
    isIPO: false,
    isIndustryAverage: false,
  };
}

/**
 * Get peer comparison data for an IPO
 *
 * @param ipoCompanyName - Name of the IPO company
 * @param ipoSector - Sector of the IPO
 * @param ipoFinancialData - Financial data for the IPO
 * @param peerCompanies - Array of peer companies
 * @returns Structured peer comparison data
 */
export function getPeerComparison(
  ipoCompanyName: string,
  ipoSector: string | null,
  ipoFinancialData: FinancialData | null,
  peerCompanies: PeerCompany[]
): PeerComparisonData | null {
  // Return null if no peer data
  if (!peerCompanies || peerCompanies.length === 0) {
    return null;
  }

  // Create IPO row from financial data
  const ipoRow: ComparisonRow = {
    companyName: ipoCompanyName,
    sector: ipoSector,
    listedStatus: 'IPO',
    peRatio: ipoFinancialData?.peRatio ? Number(ipoFinancialData.peRatio) : null,
    eps: ipoFinancialData?.eps ? Number(ipoFinancialData.eps) : null,
    dilutedEps: null, // Not available in financialData table
    ronw: ipoFinancialData?.roe ? Number(ipoFinancialData.roe) : null, // Using ROE as RONW proxy
    nav: null, // Not available in financialData table
    pbvRatio: null, // Not available in financialData table
    financialStatementType: null,
    isIPO: true,
    isIndustryAverage: false,
  };

  // Convert peer companies to comparison rows
  const peerRows = peerCompanies.map(peerToComparisonRow);

  // Calculate industry average
  const industryAvgMetrics = calculateIndustryAverage(peerCompanies);
  const industryAverageRow: ComparisonRow = {
    companyName: 'Industry Average',
    sector: ipoSector,
    listedStatus: '-',
    ...industryAvgMetrics,
    isIPO: false,
    isIndustryAverage: true,
  };

  // Determine data source and last updated
  const dataSource = peerCompanies[0]?.dataSource || 'Multiple Sources';
  const lastUpdated = peerCompanies.reduce((latest, peer) => {
    if (!peer.lastUpdated) return latest;
    if (!latest) return peer.lastUpdated;
    return peer.lastUpdated > latest ? peer.lastUpdated : latest;
  }, null as Date | null);

  // Determine most common financial statement type
  const financialStatementType = industryAvgMetrics.financialStatementType;

  return {
    ipoRow,
    peerRows,
    industryAverageRow,
    dataSource,
    lastUpdated,
    financialStatementType,
  };
}
