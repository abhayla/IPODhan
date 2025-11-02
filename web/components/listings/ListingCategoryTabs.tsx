'use client';

/**
 * Category Navigation Tabs Component
 *
 * Reusable navigation tabs for switching between different category pages.
 * Can be used across the app for any category-based navigation.
 */

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export interface CategoryTab {
  name: string;
  href: string;
  value: string;
  icon?: React.ReactNode;
}

interface CategoryTabsProps {
  tabs: CategoryTab[];
  ariaLabel?: string;
}

export function CategoryTabs({ tabs, ariaLabel = 'Navigation tabs' }: CategoryTabsProps) {
  const pathname = usePathname();

  return (
    <div className="border-b border-gray-200">
      <nav className="-mb-px flex space-x-8" aria-label={ariaLabel}>
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.value}
              href={tab.href}
              className={cn(
                'whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium inline-flex items-center gap-2',
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              {tab.icon}
              {tab.name}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

// Pre-configured tabs for IPO Listings pages
export const IPO_LISTING_TABS: CategoryTab[] = [
  { name: 'Mainboard IPOs', href: '/mainboard-ipo-listings', value: 'mainboard' },
  { name: 'SME IPOs', href: '/sme-ipo-listings', value: 'sme' },
  // HIDDEN: FPOs tab - Route still accessible via direct URL
  // { name: 'FPOs', href: '/fpo-listings', value: 'fpo' },
];

// Convenience component for IPO Listings tabs
export function ListingCategoryTabs() {
  return <CategoryTabs tabs={IPO_LISTING_TABS} ariaLabel="IPO Listing Categories" />;
}
