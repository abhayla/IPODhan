/**
 * Add to Compare Button Component
 *
 * Allows users to add current IPO to comparison from the detail page
 * Features:
 * - Session storage persistence
 * - Visual count badge
 * - Navigation to comparison page
 * - Disabled state when max limit reached
 *
 * @component
 */

'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Scale, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ==================== CONSTANTS ====================

const SESSION_STORAGE_KEY = 'comparisonIPOs';
const MAX_COMPARISON = 3;

// ==================== PROPS INTERFACE ====================

export interface AddToCompareButtonProps {
  /** Current IPO slug to add to comparison */
  slug: string;
  /** Company name for display (reserved for future use) */
  companyName?: string;
  /** IPO status - only OPEN, UPCOMING, CLOSED allowed */
  status: string;
  /** Button size variant */
  size?: 'default' | 'sm' | 'lg';
  /** Custom className */
  className?: string;
}

// ==================== COMPONENT ====================

export function AddToCompareButton({
  slug,
  status,
  size = 'default',
  className,
}: AddToCompareButtonProps) {
  const router = useRouter();
  const [selectedSlugs, setSelectedSlugs] = React.useState<string[]>([]);
  const [isAdded, setIsAdded] = React.useState(false);

  // Valid statuses for comparison
  const validStatuses = ['OPEN', 'UPCOMING', 'CLOSED'];
  const isValidStatus = validStatuses.includes(status);

  /**
   * Load selected slugs from session storage on mount
   */
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            setSelectedSlugs(parsed);
            setIsAdded(parsed.includes(slug));
          }
        }
      } catch (err) {
        console.error('Error reading from session storage:', err);
      }
    }
  }, [slug]);

  /**
   * Handle adding IPO to comparison
   */
  const handleAddToCompare = () => {
    if (!isValidStatus) return;

    let updatedSlugs: string[];

    if (isAdded) {
      // Remove from comparison
      updatedSlugs = selectedSlugs.filter((s) => s !== slug);
      setIsAdded(false);
    } else {
      // Add to comparison
      if (selectedSlugs.length >= MAX_COMPARISON) {
        // Navigate to comparison page if max reached
        router.push(`/tools/compare?ipos=${selectedSlugs.join(',')}`);
        return;
      }

      updatedSlugs = [...selectedSlugs, slug];
      setIsAdded(true);
    }

    setSelectedSlugs(updatedSlugs);

    // Save to session storage
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updatedSlugs));
      } catch (err) {
        console.error('Error writing to session storage:', err);
      }
    }
  };

  /**
   * Navigate to comparison page
   */
  const handleViewComparison = () => {
    const slugs = isAdded ? selectedSlugs : [...selectedSlugs, slug];
    router.push(`/tools/compare?ipos=${slugs.join(',')}`);
  };

  // Don't show button for invalid statuses
  if (!isValidStatus) {
    return null;
  }

  const comparisonCount = selectedSlugs.length;
  const canAddMore = comparisonCount < MAX_COMPARISON;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Add/Remove Button */}
      <Button
        variant={isAdded ? 'outline' : 'secondary'}
        size={size}
        onClick={handleAddToCompare}
        className={cn(
          'gap-2',
          isAdded && 'border-green-500 text-green-700 dark:text-green-400'
        )}
      >
        {isAdded ? (
          <>
            <Check className="h-4 w-4" />
            <span>Added to Compare</span>
          </>
        ) : (
          <>
            <Scale className="h-4 w-4" />
            <span>Add to Compare</span>
          </>
        )}
      </Button>

      {/* Comparison Count Badge */}
      {comparisonCount > 0 && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <Scale className="h-3 w-3" />
            <span>{comparisonCount}</span>
          </Badge>

          {/* View Comparison Button (when at least 2 IPOs) */}
          {(comparisonCount >= 2 || (comparisonCount === 1 && isAdded)) && (
            <Button
              variant="default"
              size={size}
              onClick={handleViewComparison}
              className="gap-2"
            >
              View Comparison
            </Button>
          )}
        </div>
      )}

      {/* Max limit reached message */}
      {!canAddMore && !isAdded && (
        <span className="text-xs text-muted-foreground">
          (Max {MAX_COMPARISON} IPOs)
        </span>
      )}
    </div>
  );
}
