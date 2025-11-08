/**
 * Source Badge Component
 * Displays data source attribution with visual indicators
 *
 * Purpose:
 * - Shows which scraper/source provided each field value
 * - Displays confidence score (0-100%) when available
 * - Color-coded by source for quick visual identification
 * - Accessible with ARIA labels and tooltips
 *
 * Usage:
 * ```tsx
 * <SourceBadge source="DRHP" confidence={94} />
 * <SourceBadge source="NSE" />
 * <SourceBadge source="ADMIN" confidence={100} size="sm" />
 * ```
 *
 * Design:
 * - Small pill-shaped badge
 * - Color matches source type
 * - Tooltip on hover showing details
 * - Responsive sizing
 * - Screen reader compatible
 */

import React from 'react';

export type DataSource =
  | 'ADMIN'
  | 'DRHP'
  | 'NSE'
  | 'BSE'
  | 'MONEYCONTROL'
  | 'CHITTORGARH'
  | 'INVESTORGAIN'
  | 'API_FALLBACK'
  | 'SEBI'
  | 'UNKNOWN';

export interface SourceBadgeProps {
  /** Data source name */
  source: DataSource | string;

  /** Confidence score (0-100), optional */
  confidence?: number;

  /** Badge size */
  size?: 'xs' | 'sm' | 'md' | 'lg';

  /** Show confidence in badge (not just tooltip) */
  showConfidence?: boolean;

  /** Additional CSS classes */
  className?: string;

  /** Timestamp when this value was last updated */
  updatedAt?: Date | string;
}

/**
 * Get color classes for source badge
 */
export function getSourceColor(source: string): string {
  const upperSource = source.toUpperCase();

  switch (upperSource) {
    case 'ADMIN':
      return 'bg-red-500 text-white border-red-600';

    case 'DRHP':
      return 'bg-purple-500 text-white border-purple-600';

    case 'NSE':
      return 'bg-blue-500 text-white border-blue-600';

    case 'BSE':
      return 'bg-green-500 text-white border-green-600';

    case 'MONEYCONTROL':
      return 'bg-yellow-500 text-white border-yellow-600';

    case 'CHITTORGARH':
    case 'INVESTORGAIN':
      return 'bg-orange-500 text-white border-orange-600';

    case 'SEBI':
      return 'bg-indigo-500 text-white border-indigo-600';

    case 'API_FALLBACK':
    case 'UNKNOWN':
      return 'bg-gray-500 text-white border-gray-600';

    default:
      return 'bg-gray-500 text-white border-gray-600';
  }
}

/**
 * Get size classes for badge
 */
function getSizeClasses(size: SourceBadgeProps['size']): string {
  switch (size) {
    case 'xs':
      return 'px-1.5 py-0.5 text-[10px]';
    case 'sm':
      return 'px-2 py-0.5 text-xs';
    case 'lg':
      return 'px-3 py-1.5 text-sm';
    case 'md':
    default:
      return 'px-2.5 py-1 text-xs';
  }
}

/**
 * Get confidence color (for confidence indicator)
 */
function getConfidenceColor(confidence: number): string {
  if (confidence >= 90) return 'text-green-300';
  if (confidence >= 75) return 'text-yellow-300';
  if (confidence >= 50) return 'text-orange-300';
  return 'text-red-300';
}

/**
 * Format date for tooltip
 */
function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * SourceBadge Component
 */
export default function SourceBadge({
  source,
  confidence,
  size = 'md',
  showConfidence = false,
  className = '',
  updatedAt,
}: SourceBadgeProps) {
  const colorClasses = getSourceColor(source);
  const sizeClasses = getSizeClasses(size);

  // Build tooltip content
  const tooltipLines: string[] = [];
  tooltipLines.push(`Source: ${source}`);
  if (confidence !== undefined) {
    tooltipLines.push(`Confidence: ${confidence}%`);
  }
  if (updatedAt) {
    tooltipLines.push(`Updated: ${formatDate(updatedAt)}`);
  }
  const tooltipText = tooltipLines.join('\n');

  // ARIA label for accessibility
  const ariaLabel = `Data source: ${source}${
    confidence !== undefined ? `, ${confidence}% confidence` : ''
  }`;

  return (
    <span
      className={`
        inline-flex items-center space-x-1
        font-semibold rounded-full border
        transition-all duration-200
        hover:shadow-md hover:scale-105
        ${colorClasses}
        ${sizeClasses}
        ${className}
      `}
      title={tooltipText}
      aria-label={ariaLabel}
      role="status"
    >
      {/* Source Name */}
      <span className="uppercase tracking-wide">
        {source}
      </span>

      {/* Confidence Badge (optional) */}
      {showConfidence && confidence !== undefined && (
        <span className={`font-bold ${getConfidenceColor(confidence)}`}>
          {confidence}%
        </span>
      )}

      {/* Confidence Indicator (dot) */}
      {!showConfidence && confidence !== undefined && (
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${
            confidence >= 90
              ? 'bg-green-300'
              : confidence >= 75
              ? 'bg-yellow-300'
              : confidence >= 50
              ? 'bg-orange-300'
              : 'bg-red-300'
          }`}
          aria-hidden="true"
        />
      )}
    </span>
  );
}

/**
 * SourceBadgeList Component
 * Displays multiple source badges in a compact list
 *
 * Usage:
 * ```tsx
 * <SourceBadgeList sources={[
 *   { source: 'DRHP', confidence: 94 },
 *   { source: 'NSE', confidence: 99 }
 * ]} />
 * ```
 */
export interface SourceBadgeListProps {
  sources: Array<{
    source: DataSource | string;
    confidence?: number;
    updatedAt?: Date | string;
  }>;
  size?: SourceBadgeProps['size'];
  maxDisplay?: number;
  className?: string;
}

export function SourceBadgeList({
  sources,
  size = 'sm',
  maxDisplay = 3,
  className = '',
}: SourceBadgeListProps) {
  const displaySources = sources.slice(0, maxDisplay);
  const remainingCount = sources.length - maxDisplay;

  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {displaySources.map((item, index) => (
        <SourceBadge
          key={index}
          source={item.source}
          confidence={item.confidence}
          updatedAt={item.updatedAt}
          size={size}
        />
      ))}

      {remainingCount > 0 && (
        <span className="px-2 py-0.5 text-xs bg-gray-600 text-white rounded-full">
          +{remainingCount} more
        </span>
      )}
    </div>
  );
}

/**
 * SourceWithValue Component
 * Displays field value with source badge
 *
 * Usage:
 * ```tsx
 * <SourceWithValue
 *   value="₹500 Cr"
 *   source="DRHP"
 *   confidence={94}
 * />
 * ```
 */
export interface SourceWithValueProps {
  value: React.ReactNode;
  source: DataSource | string;
  confidence?: number;
  updatedAt?: Date | string;
  size?: SourceBadgeProps['size'];
  layout?: 'horizontal' | 'vertical';
  className?: string;
}

export function SourceWithValue({
  value,
  source,
  confidence,
  updatedAt,
  size = 'sm',
  layout = 'horizontal',
  className = '',
}: SourceWithValueProps) {
  if (layout === 'vertical') {
    return (
      <div className={`space-y-1 ${className}`}>
        <div className="text-gray-900 dark:text-white">{value}</div>
        <SourceBadge
          source={source}
          confidence={confidence}
          updatedAt={updatedAt}
          size={size}
        />
      </div>
    );
  }

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <span className="text-gray-900 dark:text-white">{value}</span>
      <SourceBadge
        source={source}
        confidence={confidence}
        updatedAt={updatedAt}
        size={size}
      />
    </div>
  );
}

/**
 * Utility: Parse field_sources JSONB from database
 */
export interface FieldSource {
  source: string;
  confidence: number;
  updated_at: string;
  previous?: {
    value: any;
    source: string;
  };
}

/**
 * Extract source info for a specific field from field_sources JSONB
 */
export function getFieldSource(
  fieldSources: Record<string, FieldSource> | null | undefined,
  fieldName: string
): { source: string; confidence?: number; updatedAt?: string } | null {
  if (!fieldSources || !fieldSources[fieldName]) {
    return null;
  }

  const fieldSource = fieldSources[fieldName];
  return {
    source: fieldSource.source,
    confidence: fieldSource.confidence,
    updatedAt: fieldSource.updated_at,
  };
}
