/**
 * IssueTypeBadge Component (Story 4.11)
 *
 * Displays the IPO issue type with color-coded badges and tooltips.
 * - BOOK_BUILDING: Blue badge
 * - FIXED_PRICE: Green badge
 * - HYBRID: Purple badge
 */

import React from 'react';

type IssueType = 'BOOK_BUILDING' | 'FIXED_PRICE' | 'HYBRID';

interface IssueTypeBadgeProps {
  issueType: IssueType | null | undefined;
  className?: string;
}

const issueTypeConfig: Record<
  IssueType,
  {
    label: string;
    bgColor: string;
    textColor: string;
    tooltip: string;
  }
> = {
  BOOK_BUILDING: {
    label: 'Book Building',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-800',
    tooltip:
      'Price is determined through a bidding process. Investors can bid within the price band.',
  },
  FIXED_PRICE: {
    label: 'Fixed Price',
    bgColor: 'bg-green-100',
    textColor: 'text-green-800',
    tooltip:
      'Price is fixed and predetermined by the company. No bidding process involved.',
  },
  HYBRID: {
    label: 'Hybrid',
    bgColor: 'bg-purple-100',
    textColor: 'text-purple-800',
    tooltip:
      'Combination of both book building and fixed price mechanisms for different investor categories.',
  },
};

export function IssueTypeBadge({
  issueType,
  className = '',
}: IssueTypeBadgeProps) {
  if (!issueType) {
    return (
      <span
        className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-600 ${className}`}
      >
        Not Specified
      </span>
    );
  }

  const config = issueTypeConfig[issueType];

  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${config.bgColor} ${config.textColor} ${className}`}
      title={config.tooltip}
      role="tooltip"
    >
      {config.label}
    </span>
  );
}
