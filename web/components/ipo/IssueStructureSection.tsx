/**
 * IssueStructureSection Component (Story 4.11)
 *
 * Main container component that displays the complete issue structure breakdown
 * including issue type, Fresh Issue vs OFS breakdown, minimum investment,
 * cut-off price, and registrar portal link.
 */

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { IssueTypeBadge } from './IssueTypeBadge';
import { IssueBreakdownChart } from './IssueBreakdownChart';
import { MinimumInvestmentDisplay } from './MinimumInvestmentDisplay';
import type { IpoDetails } from '@/lib/repositories/types';

/**
 * Valuation figures extracted from the price-band advertisement / prospectus
 * (`ipo_valuation`). Every field is optional - a row with only a price band
 * renders only the price rows.
 */
export interface IssueValuation {
  pricingEvent: string;
  priceFloor: string | null;
  priceCap: string | null;
  sharesAtFloor: string | null;
  sharesAtCap: string | null;
  freshSharesAtFloor?: string | null;
  freshSharesAtCap?: string | null;
  ofsShares?: string | null;
  totalSharesAtFloor?: string | null;
  totalSharesAtCap?: string | null;
  mcapAtFloor: string | null;
  mcapAtCap: string | null;
  peAtFloor: string | null;
  peAtCap: string | null;
  peNotAscertainableReason: string | null;
  ronwWeighted3y: string | null;
  faceValueMultipleFloor: string | null;
  faceValueMultipleCap: string | null;
}

interface IssueStructureSectionProps {
  ipoDetails: IpoDetails | null | undefined;
  /** Valuation at the floor and cap of the band (`ipo_valuation`). */
  valuation?: IssueValuation | null;
  /** Face value per share, for the "price as a multiple of face value" row. */
  faceValue?: number | string | null;
  /** Average P/E of the listed peers, for reading the issue P/E in context. */
  peerAveragePe?: number | null;
  /** Shares per lot — lets the minimum investment be derived when unstored. */
  lotSize?: number | null;
  /** Cap of the price band — lets the minimum investment be derived when unstored. */
  priceRangeMax?: number | null;
  className?: string;
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

function fmtInt(v: number | null): string | null {
  return v === null ? null : v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/** Absolute rupees to crores, the unit every other number on this page uses. */
function fmtCrore(v: number | null): string | null {
  return v === null
    ? null
    : `₹${(v / 10000000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
}

function fmtNum(v: number | null, suffix = ''): string | null {
  return v === null ? null : `${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}${suffix}`;
}

export function IssueStructureSection({
  ipoDetails,
  valuation = null,
  faceValue = null,
  peerAveragePe = null,
  lotSize = null,
  priceRangeMax = null,
  className = '',
}: IssueStructureSectionProps) {
  // If no details available, show empty state
  if (!ipoDetails && !valuation) {
    return (
      <div
        className={`bg-white rounded-lg border border-gray-200 p-6 ${className}`}
      >
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          Issue Structure
        </h2>
        <div className="flex items-center justify-center h-64 bg-gray-50 rounded-lg">
          <p className="text-gray-500">Issue structure data not available</p>
        </div>
      </div>
    );
  }

  const {
    issueType,
    freshIssue,
    ofsIssue,
    minInvestment,
    cutOffPrice,
    registrarLink,
  } = ipoDetails ?? ({} as IpoDetails);

  const hasFreshIssue = freshIssue && parseFloat(freshIssue.toString()) > 0;
  const hasOfsIssue = ofsIssue && parseFloat(ofsIssue.toString()) > 0;

  return (
    <div
      className={`bg-white rounded-lg border border-gray-200 p-6 ${className}`}
    >
      {/* Section Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Issue Structure
        </h2>
        <p className="text-sm text-gray-600">
          Detailed breakdown of the IPO offering mechanics
        </p>
      </div>

      {/* Issue Type Badge */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Issue Type</h3>
        <div className="flex flex-wrap items-center gap-2">
          <IssueTypeBadge issueType={issueType} />
          {/* The SEBI ICDR regulation the offer is made under, as the price band
              advertisement cites it (`ipo_details.sebi_regulation_cited`). */}
          {ipoDetails?.sebiRegulationCited && (
            <span className="text-xs text-gray-600">
              SEBI ICDR {ipoDetails.sebiRegulationCited}
            </span>
          )}
        </div>
      </div>

      {/* Grid Layout: Chart + Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Fresh Issue vs OFS Breakdown Chart */}
        {(hasFreshIssue || hasOfsIssue) && (
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">
              Fresh Issue vs OFS Breakdown
            </h3>
            <IssueBreakdownChart
              freshIssue={freshIssue}
              ofsIssue={ofsIssue}
            />
          </div>
        )}

        {/* Key Investment Metrics */}
        <div className="space-y-6">
          {/* Minimum Investment */}
          <div className="border border-gray-200 rounded-lg p-4">
            <MinimumInvestmentDisplay
              minInvestment={minInvestment}
              lotSize={lotSize}
              priceRangeMax={priceRangeMax}
            />
          </div>

          {/* Cut-Off Price (for book building issues) */}
          {issueType === 'BOOK_BUILDING' && cutOffPrice && (
            <div className="border border-gray-200 rounded-lg p-4 text-center">
              <p className="text-sm text-gray-600 mb-1">Cut-Off Price</p>
              <p className="text-2xl font-bold text-blue-600">
                ₹{parseFloat(cutOffPrice.toString()).toLocaleString('en-IN')}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Bid at cut-off to get shares at the final discovered price
              </p>
            </div>
          )}

          {/* Registrar Portal Link */}
          {registrarLink && (
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                Registrar Portal
              </h3>
              <a
                href={registrarLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200 text-sm font-medium"
              >
                <span>Check Allotment Status</span>
                <ExternalLink className="w-4 h-4" />
              </a>
              <p className="text-xs text-gray-500 mt-2">
                Check your IPO application status on the registrar's website
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Valuation at the floor and the cap of the price band - the numbers the
          issuer itself published in the price-band ad / prospectus. Renders only
          the rows that actually have values. */}
      <ValuationAtBandTable
        valuation={valuation}
        faceValue={faceValue}
        peerAveragePe={peerAveragePe}
      />

      {/* Additional Information */}
      {!hasFreshIssue && !hasOfsIssue && (
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <p className="text-sm text-gray-600">
            Detailed issue breakdown information is not yet available for this IPO
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Two-column (floor / cap) valuation table. Rendered inside Issue Structure so
 * the offer's own arithmetic sits next to the offer's mechanics.
 */
function ValuationAtBandTable({
  valuation,
  faceValue,
  peerAveragePe,
}: {
  valuation: IssueValuation | null;
  faceValue: number | string | null;
  peerAveragePe: number | null;
}) {
  if (!valuation) return null;

  const floor = num(valuation.priceFloor);
  const cap = num(valuation.priceCap);
  const fv = num(faceValue);

  const rows: Array<{ label: string; floor: string | null; cap: string | null }> = [
    { label: 'Price per share', floor: fmtNum(floor), cap: fmtNum(cap) },
    {
      // W-88: the offer's three share legs are stored separately now. The fresh
      // leg still falls back to shares_at_floor/at_cap, which held the fresh
      // count before migration 0048 and keep that meaning for old rows.
      label: 'Fresh issue shares',
      floor: fmtInt(num(valuation.freshSharesAtFloor ?? valuation.sharesAtFloor)),
      cap: fmtInt(num(valuation.freshSharesAtCap ?? valuation.sharesAtCap)),
    },
    {
      // The offer-for-sale leg is a fixed share count: the selling shareholders
      // offer the same shares whatever the price settles at, so floor and cap
      // carry the identical figure rather than the cap column being blank.
      label: 'Offer for sale shares',
      floor: fmtInt(num(valuation.ofsShares)),
      cap: fmtInt(num(valuation.ofsShares)),
    },
    {
      label: 'Total offer shares',
      floor: fmtInt(num(valuation.totalSharesAtFloor)),
      cap: fmtInt(num(valuation.totalSharesAtCap)),
    },
    {
      label: 'Market capitalisation',
      floor: fmtCrore(num(valuation.mcapAtFloor)),
      cap: fmtCrore(num(valuation.mcapAtCap)),
    },
    {
      label: 'P/E ratio',
      floor: fmtNum(num(valuation.peAtFloor), 'x'),
      cap: fmtNum(num(valuation.peAtCap), 'x'),
    },
    {
      label: 'Price as a multiple of face value',
      floor: fmtNum(num(valuation.faceValueMultipleFloor), 'x'),
      cap: fmtNum(num(valuation.faceValueMultipleCap), 'x'),
    },
  ].filter((r) => r.floor !== null || r.cap !== null);

  const peerAvg = peerAveragePe !== null && peerAveragePe > 0 ? peerAveragePe : null;
  const ronw3y = num(valuation.ronwWeighted3y);

  if (rows.length === 0 && peerAvg === null && ronw3y === null) return null;

  return (
    <div className="border border-gray-200 rounded-lg p-4 mb-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">
        Valuation at the price band
      </h3>
      <p className="text-xs text-gray-500 mb-4">
        As published by the issuer
        {valuation.pricingEvent === 'PROSPECTUS'
          ? ' in the prospectus'
          : ' in the price band advertisement'}
        {fv !== null ? ` · face value ₹${fv}` : ''}
      </p>

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="py-2 px-3 text-left font-semibold text-gray-700"></th>
                <th className="py-2 px-3 text-right font-semibold text-gray-700">
                  At floor{floor !== null ? ` (₹${floor})` : ''}
                </th>
                <th className="py-2 px-3 text-right font-semibold text-gray-700">
                  At cap{cap !== null ? ` (₹${cap})` : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b last:border-0">
                  <td className="py-2 px-3 text-gray-700">{row.label}</td>
                  <td className="py-2 px-3 text-right font-medium text-gray-900">
                    {row.floor ?? '—'}
                  </td>
                  <td className="py-2 px-3 text-right font-medium text-gray-900">
                    {row.cap ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(peerAvg !== null || ronw3y !== null || valuation.peNotAscertainableReason) && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {peerAvg !== null && (
            <div className="border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-600">Peer average P/E</p>
              <p className="text-lg font-bold text-gray-900">{peerAvg.toFixed(2)}x</p>
            </div>
          )}
          {ronw3y !== null && (
            <div className="border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-600">Weighted average RoNW (3 years)</p>
              <p className="text-lg font-bold text-gray-900">{ronw3y.toFixed(2)}%</p>
            </div>
          )}
          {valuation.peNotAscertainableReason && (
            <div className="border border-gray-200 rounded-lg p-3 sm:col-span-2">
              <p className="text-xs text-gray-600">P/E not ascertainable</p>
              <p className="text-sm text-gray-900">{valuation.peNotAscertainableReason}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
