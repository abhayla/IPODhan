/**
 * Home IPO Tables Section Component
 *
 * Wrapper component that displays all four IPO tables in a 2x2 grid layout:
 * - Top Left: Active Mainboard IPOs
 * - Top Right: Active SME IPOs
 * - Bottom Left: Upcoming Mainboard IPOs
 * - Bottom Right: Upcoming SME IPOs
 *
 * Features:
 * - Responsive grid: 2 columns on desktop, 1 column on mobile
 * - Section heading: "IPO 2025 Listings"
 * - Automatic data fetching and display
 *
 * Story 9.2: Home Page IPO Tables - UI Components
 */

'use client';

import type { HomeIPOTableData } from '@/lib/services/home-ipo-service';
import { IPOListTable } from './IPOListTable';
import { UpcomingIPOTable } from './UpcomingIPOTable';

// ==================== TYPES ====================

export interface HomeIPOTablesSectionProps {
  /** Active Mainboard IPOs data */
  mainboardIPOs: HomeIPOTableData[];
  /** Active SME IPOs data */
  smeIPOs: HomeIPOTableData[];
  /** Upcoming Mainboard IPOs data */
  upcomingMainboardIPOs: HomeIPOTableData[];
  /** Upcoming SME IPOs data */
  upcomingSMEIPOs: HomeIPOTableData[];
  /** Loading state for all tables */
  isLoading?: boolean;
}

// ==================== COMPONENT ====================

/**
 * Home IPO Tables Section
 *
 * Displays four IPO tables in a responsive grid layout
 *
 * AC#1: Four distinct table components render correctly with proper data
 * AC#3: Tables are responsive and match reference design
 * AC#4: "More..." links navigate to dashboard with correct filters
 * AC#5: Tables follow existing design system and patterns
 *
 * @example
 * ```tsx
 * <HomeIPOTablesSection
 *   mainboardIPOs={mainboardData}
 *   smeIPOs={smeData}
 *   upcomingMainboardIPOs={upcomingMainboardData}
 *   upcomingSMEIPOs={upcomingSMEData}
 *   isLoading={false}
 * />
 * ```
 */
export function HomeIPOTablesSection({
  mainboardIPOs,
  smeIPOs,
  upcomingMainboardIPOs,
  upcomingSMEIPOs,
  isLoading = false,
}: HomeIPOTablesSectionProps) {
  const currentYear = new Date().getFullYear();
  return (
    <section className="w-full py-8 px-4" aria-label={`IPO ${currentYear} Listings`}>
      {/* Section Heading */}
      <h1 className="text-2xl md:text-3xl font-bold mb-8 text-center">
        IPO {currentYear} Listings
      </h1>

      {/* 2x2 Grid Layout - AC#3: Responsive design */}
      {/* Desktop: 2 columns, Mobile: 1 column */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Top Left: Active Mainboard IPOs */}
        <IPOListTable
          title={`IPO ${currentYear} List (Mainboard)`}
          ipos={mainboardIPOs}
          moreLink="/dashboard?category=mainboard"
          moreLinkText="More Mainboard IPOs..."
          isLoading={isLoading}
        />

        {/* Top Right: Active SME IPOs */}
        <IPOListTable
          title={`SME IPO ${currentYear} List`}
          ipos={smeIPOs}
          moreLink="/dashboard?category=sme"
          moreLinkText="More SME IPO..."
          isLoading={isLoading}
        />

        {/* Bottom Left: Upcoming Mainboard IPOs */}
        <UpcomingIPOTable
          title="Upcoming Mainboard IPOs (Filed with SEBI)"
          ipos={upcomingMainboardIPOs}
          moreLink="/dashboard?category=mainboard&status=upcoming"
          moreLinkText="More Upcoming Mainboard IPOs..."
          isLoading={isLoading}
        />

        {/* Bottom Right: Upcoming SME IPOs */}
        <UpcomingIPOTable
          title="Upcoming SME IPOs (Filed with BSE/NSE)"
          ipos={upcomingSMEIPOs}
          moreLink="/dashboard?category=sme&status=upcoming"
          moreLinkText="More Upcoming SME IPO..."
          isLoading={isLoading}
        />
      </div>
    </section>
  );
}
