'use client';

import { useState, useEffect } from 'react';
import type { Subscription } from '@ipodhan/shared/db/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { format } from 'date-fns';
import { CategoryTooltip } from './CategoryTooltip';
import { SubscriptionViewToggle } from './SubscriptionViewToggle';
import { AnchorInvestorHighlight } from './AnchorInvestorHighlight';
import {
  type SubscriptionViewMode,
  CATEGORY_DESCRIPTIONS,
  hasDetailedSubscriptionData,
  formatSubscriptionValue,
  getSubscriptionColor,
  getSubscriptionBarWidth,
  validateSubscriptionTotals,
  saveViewPreference,
  getViewPreference,
} from '@/lib/utils/subscription-utils';

interface EnhancedSubscriptionViewProps {
  subscription: Subscription | null;
  issueSize?: string | number | null;
}

interface CategoryRow {
  key: string;
  label: string;
  value: string | number | null;
  description: string;
  isSubcategory?: boolean;
  parentKey?: string;
}

/**
 * EnhancedSubscriptionView Component
 *
 * Displays subscription data in simple (3 categories) or detailed (7 categories) views.
 * Story 5.6: Enhanced Subscription Breakdown - AC 1, 2, 3, 4, 5, 6
 */
export function EnhancedSubscriptionView({
  subscription,
  issueSize,
}: EnhancedSubscriptionViewProps) {
  const [viewMode, setViewMode] = useState<SubscriptionViewMode>('simple');

  // Load saved preference on mount
  useEffect(() => {
    const savedPreference = getViewPreference();
    setViewMode(savedPreference);
  }, []);

  // Handle view change and save preference
  const handleViewChange = (newView: SubscriptionViewMode) => {
    setViewMode(newView);
    saveViewPreference(newView);
  };

  // No subscription data
  if (!subscription) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Subscription Status</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Subscription data not available yet
          </p>
        </CardContent>
      </Card>
    );
  }

  // Check if detailed data is available
  const hasDetailedData = hasDetailedSubscriptionData(subscription);

  // Validate subscription totals (log warnings)
  const validation = validateSubscriptionTotals(subscription);
  if (!validation.valid && validation.warnings.length > 0) {
    console.warn('Subscription data validation warnings:', validation.warnings);
  }

  // Simple view categories (3 categories)
  const simpleCategories: CategoryRow[] = [
    {
      key: 'qib',
      label: 'QIB (Qualified Institutional Buyers)',
      value: subscription.qibSubscription,
      description: CATEGORY_DESCRIPTIONS.qib,
    },
    {
      key: 'nii',
      label: 'NII (Non-Institutional Investors)',
      value: subscription.niiSubscription,
      description: 'Non-institutional investors including HNIs and smaller investors',
    },
    {
      key: 'retail',
      label: 'Retail Individual Investors',
      value: subscription.retailSubscription,
      description: 'Individual retail investors',
    },
  ];

  // Detailed view categories (7 categories with hierarchy)
  const detailedCategories: CategoryRow[] = [
    {
      key: 'qib',
      label: 'QIB (Qualified Institutional Buyers)',
      value: subscription.qibSubscription,
      description: CATEGORY_DESCRIPTIONS.qib,
    },
    {
      key: 'nii',
      label: 'NII (Total)',
      value: subscription.niiSubscription,
      description: 'Total non-institutional investor subscription',
    },
    {
      key: 'bNII',
      label: '├─ Big NII',
      value: subscription.bNIISubscription,
      description: CATEGORY_DESCRIPTIONS.bNII,
      isSubcategory: true,
      parentKey: 'nii',
    },
    {
      key: 'sNII',
      label: '└─ Small NII',
      value: subscription.sNIISubscription,
      description: CATEGORY_DESCRIPTIONS.sNII,
      isSubcategory: true,
      parentKey: 'nii',
    },
    {
      key: 'retail',
      label: 'Retail (Total)',
      value: subscription.retailSubscription,
      description: 'Total retail investor subscription',
    },
    {
      key: 'retailHNI',
      label: '├─ Retail HNI',
      value: subscription.retailHNISubscription,
      description: CATEGORY_DESCRIPTIONS.retailHNI,
      isSubcategory: true,
      parentKey: 'retail',
    },
    {
      key: 'retailOthers',
      label: '└─ Retail Others',
      value: subscription.retailOthersSubscription,
      description: CATEGORY_DESCRIPTIONS.retailOthers,
      isSubcategory: true,
      parentKey: 'retail',
    },
  ];

  // Add anchor and employee if they have data
  if (
    subscription.anchorInvestorSubscription &&
    subscription.anchorInvestorSubscription !== '0'
  ) {
    detailedCategories.push({
      key: 'anchor',
      label: 'Anchor Investors',
      value: subscription.anchorInvestorSubscription,
      description: CATEGORY_DESCRIPTIONS.anchor,
    });
  }

  if (
    subscription.employeeSubscription &&
    subscription.employeeSubscription !== '0'
  ) {
    detailedCategories.push({
      key: 'employee',
      label: 'Employee',
      value: subscription.employeeSubscription,
      description: CATEGORY_DESCRIPTIONS.employee,
    });
  }

  const categories = viewMode === 'simple' ? simpleCategories : detailedCategories;

  return (
    <div className="space-y-4">
      {/* Anchor Investor Highlight (if data available) */}
      {subscription.anchorInvestorSubscription &&
        subscription.anchorInvestorSubscription !== '0' && (
          <AnchorInvestorHighlight
            anchorSubscription={subscription.anchorInvestorSubscription}
            issueSize={issueSize ?? null}
          />
        )}

      {/* Main Subscription Card */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Subscription Breakdown</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Last updated:{' '}
                {format(new Date(subscription.timestamp), 'dd MMM yyyy, HH:mm')}
              </p>
            </div>

            {/* View Toggle (only show if detailed data available) */}
            {hasDetailedData && (
              <SubscriptionViewToggle
                currentView={viewMode}
                onViewChange={handleViewChange}
              />
            )}
          </div>
        </CardHeader>

        <CardContent>
          <div className="space-y-6">
            {/* Total Subscription */}
            <div className="rounded-lg bg-muted/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Total Subscription</span>
                <span className="text-2xl font-bold">
                  {formatSubscriptionValue(subscription.totalSubscription)}x
                </span>
              </div>
            </div>

            {/* Desktop View - Table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%]">Category</TableHead>
                    <TableHead className="text-right">Subscription</TableHead>
                    <TableHead className="w-[40%]">Progress</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((category) => {
                    const colors = getSubscriptionColor(category.value);
                    const barWidth = getSubscriptionBarWidth(category.value);

                    return (
                      <TableRow
                        key={category.key}
                        className={category.isSubcategory ? 'bg-muted/30' : ''}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-sm ${category.isSubcategory ? 'font-normal pl-2' : 'font-medium'}`}
                            >
                              {category.label}
                            </span>
                            <CategoryTooltip
                              category={category.label.replace(/[├─└─]/g, '').trim()}
                              description={category.description}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={`text-sm font-bold ${colors.text}`}>
                            {formatSubscriptionValue(category.value)}x
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="relative h-6 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full transition-all duration-300 ${colors.bar}`}
                              style={{ width: barWidth }}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile View - Stacked Cards */}
            <div className="md:hidden space-y-4">
              {categories.map((category) => {
                const colors = getSubscriptionColor(category.value);
                const barWidth = getSubscriptionBarWidth(category.value);

                return (
                  <Card
                    key={category.key}
                    className={category.isSubcategory ? 'ml-4 border-l-4' : ''}
                  >
                    <CardContent className="pt-4">
                      <div className="space-y-3">
                        {/* Category Header */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-sm ${category.isSubcategory ? 'font-normal' : 'font-medium'}`}
                            >
                              {category.label.replace(/[├─└─]/g, '').trim()}
                            </span>
                            <CategoryTooltip
                              category={category.label.replace(/[├─└─]/g, '').trim()}
                              description={category.description}
                            />
                          </div>
                          <span className={`text-lg font-bold ${colors.text}`}>
                            {formatSubscriptionValue(category.value)}x
                          </span>
                        </div>

                        {/* Progress Bar */}
                        <div className="relative h-6 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full transition-all duration-300 ${colors.bar}`}
                            style={{ width: barWidth }}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Additional Metrics */}
            {subscription.totalApplications && subscription.totalApplications > 0 && (
              <div className="grid grid-cols-1 gap-3 border-t pt-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Total Applications
                  </p>
                  <p className="text-lg font-semibold">
                    {subscription.totalApplications.toLocaleString('en-IN')}
                  </p>
                </div>
                {subscription.totalSharesBid && (
                  <div>
                    <p className="text-sm text-muted-foreground">Shares Bid</p>
                    <p className="text-lg font-semibold">
                      {subscription.totalSharesBid.toLocaleString('en-IN')}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Data Unavailable Message (if no detailed data but user selected detailed view) */}
            {viewMode === 'detailed' && !hasDetailedData && (
              <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950/20 p-4 border border-yellow-200 dark:border-yellow-800">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  Detailed breakdown data is not available for this IPO. Only
                  high-level subscription data is available.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
