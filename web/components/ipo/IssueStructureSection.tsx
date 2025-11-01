/**
 * IssueStructureSection Component (Story 4.11)
 *
 * Main container component that displays the complete issue structure breakdown
 * including issue type, Fresh Issue vs OFS breakdown, minimum investment,
 * cut-off price, and registrar portal link.
 */

import React from 'react';
import { HiArrowTopRightOnSquare } from 'react-icons/hi2';
import { IssueTypeBadge } from './IssueTypeBadge';
import { IssueBreakdownChart } from './IssueBreakdownChart';
import { MinimumInvestmentDisplay } from './MinimumInvestmentDisplay';
import type { IpoDetails } from '@/lib/repositories/types';

interface IssueStructureSectionProps {
  ipoDetails: IpoDetails | null | undefined;
  className?: string;
}

export function IssueStructureSection({
  ipoDetails,
  className = '',
}: IssueStructureSectionProps) {
  // If no details available, show empty state
  if (!ipoDetails) {
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
  } = ipoDetails;

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
        <IssueTypeBadge issueType={issueType} />
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
            <MinimumInvestmentDisplay minInvestment={minInvestment} />
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
                <HiArrowTopRightOnSquare className="w-4 h-4" />
              </a>
              <p className="text-xs text-gray-500 mt-2">
                Check your IPO application status on the registrar's website
              </p>
            </div>
          )}
        </div>
      </div>

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
