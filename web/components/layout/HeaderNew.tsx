/**
 * Header Component (Server Component)
 *
 * Main navigation header with Server + Client islands pattern:
 * - Logo and static navigation (Server Component - fast SSR)
 * - Dropdowns and mobile menu (Client Components - interactivity)
 *
 * This refactor resolves webpack module factory errors by properly
 * separating server and client concerns per Next.js 15 best practices.
 *
 * @component
 */

import Link from 'next/link';
import { MobileMenu } from './MobileMenu';
import { DesktopDropdown } from './DesktopDropdown';

export function HeaderNew() {
  // Mainboard IPOs dropdown items
  const mainboardItems = [
    {
      href: '/mainboard-ipo-listings',
      label: 'Mainboard IPO Listings',
      description: 'Comprehensive post-listing data',
      iconName: 'List' as const,
    },
    {
      href: '/mainboard-ipo-performance-tracker',
      label: 'Mainboard IPO Performance Tracker',
      description: 'Track post-listing performance',
      iconName: 'TrendingUp' as const,
    },
    {
      href: '/mainboard-ipo-prospectus',
      label: 'Mainboard IPO Prospectus',
      description: 'View IPO prospectus documents',
      iconName: 'FileText' as const,
    },
    {
      href: '/mainboard-ipo-calendar',
      label: 'Mainboard IPO Calendar',
      description: 'View upcoming IPO schedules',
      iconName: 'Calendar' as const,
    },
    {
      href: '/mainboard-ipo-reviews',
      label: 'Mainboard IPO Reviews',
      description: 'Read expert IPO analysis',
      iconName: 'Star' as const,
    },
  ];

  // SME IPOs dropdown items
  const smeItems = [
    {
      href: '/sme-ipo-listings',
      label: 'SME IPO Listings',
      description: 'Comprehensive SME post-listing data',
      iconName: 'List' as const,
    },
    {
      href: '/sme-ipo-performance-tracker',
      label: 'SME IPO Performance Tracker',
      description: 'Track SME post-listing performance',
      iconName: 'TrendingUp' as const,
    },
    {
      href: '/sme-ipo-prospectus',
      label: 'SME IPO Prospectus',
      description: 'View SME IPO prospectus documents',
      iconName: 'FileText' as const,
    },
    {
      href: '/sme-ipo-calendar',
      label: 'SME IPO Calendar',
      description: 'View SME IPO event schedules',
      iconName: 'Calendar' as const,
    },
    {
      href: '/sme-ipo-reviews',
      label: 'SME IPO Reviews',
      description: 'Read expert SME IPO analysis',
      iconName: 'Star' as const,
    },
  ];

  // Tools dropdown items
  const toolsItems = [
    {
      href: '/tools/lot-calculator',
      label: 'Lot Size Calculator',
      description: 'Calculate lots for your investment',
      iconName: 'Calculator' as const,
    },
    {
      href: '/tools/compare',
      label: 'Compare IPOs',
      description: 'Compare up to 3 IPOs side-by-side',
      iconName: 'Scale' as const,
    },
    {
      href: '/registrars',
      label: 'Registrars',
      description: 'Find registrar contact information',
      iconName: 'Building2' as const,
    },
    {
      href: '/market-holidays',
      label: 'Market Holidays',
      description: 'NSE & BSE trading holidays',
      iconName: 'Calendar' as const,
    },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo (Server Component - static) */}
          <Link href="/" className="group flex items-center space-x-2" aria-label="IPODhan - Home">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-transform group-hover:scale-105" aria-hidden="true">
              <span className="text-lg font-bold">I</span>
            </div>
            <span className="text-xl font-bold transition-colors group-hover:text-primary">IPODhan</span>
          </Link>

          {/* Desktop Navigation (Server Component with Client islands) */}
          <nav className="hidden md:flex md:items-center md:space-x-6">
            <Link
              href="/dashboard"
              className="relative text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Dashboard
            </Link>

            {/* Mainboard IPOs Dropdown (Client Component) */}
            <DesktopDropdown
              label="Mainboard IPOs"
              items={mainboardItems}
              basePath="/mainboard-ipo"
            />

            {/* SME IPOs Dropdown (Client Component) */}
            <DesktopDropdown
              label="SME IPOs"
              items={smeItems}
              basePath="/sme-ipo"
            />

            {/* Tools Dropdown (Client Component) */}
            <DesktopDropdown
              label="Tools"
              items={toolsItems}
            />
          </nav>

          {/* Mobile Menu (Client Component) */}
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}
