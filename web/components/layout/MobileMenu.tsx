'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Calculator, Scale, Building2, Calendar, TrendingUp, FileText, Star, List } from 'lucide-react';

export function MobileMenu() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  const isActive = (path: string) => {
    return pathname === path || pathname.startsWith(path);
  };

  const closeMenu = () => setIsOpen(false);

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        className="group md:hidden p-2 rounded-lg hover:bg-accent transition-colors"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={isOpen}
      >
        {isOpen ? (
          <X className="h-6 w-6 transition-transform" />
        ) : (
          <Menu className="h-6 w-6 transition-transform" />
        )}
      </button>

      {/* Mobile Navigation */}
      {isOpen && (
        <div className="border-t py-4 md:hidden">
          <nav className="flex flex-col space-y-4">
            <Link
              href="/dashboard"
              className={`text-sm font-medium transition-colors hover:text-primary ${
                isActive('/dashboard')
                  ? 'text-foreground'
                  : 'text-muted-foreground'
              }`}
              onClick={closeMenu}
            >
              Dashboard
            </Link>

            <div className="space-y-2">
              <Link
                href="/mainboard-ipos"
                className={`text-sm font-medium transition-colors hover:text-primary ${
                  isActive('/mainboard-ipos')
                    ? 'text-foreground'
                    : 'text-muted-foreground'
                }`}
                onClick={closeMenu}
              >
                Mainboard IPOs
              </Link>
              <Link
                href="/mainboard-ipo-listings"
                className="flex items-center space-x-2 pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                onClick={closeMenu}
              >
                <List className="h-4 w-4" />
                <span>Mainboard IPO Listings</span>
              </Link>
              <Link
                href="/mainboard-ipo-performance-tracker"
                className="flex items-center space-x-2 pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                onClick={closeMenu}
              >
                <TrendingUp className="h-4 w-4" />
                <span>Mainboard IPO Performance Tracker</span>
              </Link>
              <Link
                href="/mainboard-ipo-prospectus"
                className="flex items-center space-x-2 pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                onClick={closeMenu}
              >
                <FileText className="h-4 w-4" />
                <span>Mainboard IPO Prospectus</span>
              </Link>
              <Link
                href="/mainboard-ipo-calendar"
                className="flex items-center space-x-2 pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                onClick={closeMenu}
              >
                <Calendar className="h-4 w-4" />
                <span>Mainboard IPO Calendar</span>
              </Link>
              <Link
                href="/mainboard-ipo-reviews"
                className="flex items-center space-x-2 pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                onClick={closeMenu}
              >
                <Star className="h-4 w-4" />
                <span>Mainboard IPO Reviews</span>
              </Link>
            </div>

            <div className="space-y-2">
              <Link
                href="/sme-ipos"
                className={`text-sm font-medium transition-colors hover:text-primary ${
                  isActive('/sme-ipos')
                    ? 'text-foreground'
                    : 'text-muted-foreground'
                }`}
                onClick={closeMenu}
              >
                SME IPOs
              </Link>
              <Link
                href="/sme-ipo-listings"
                className="flex items-center space-x-2 pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                onClick={closeMenu}
              >
                <List className="h-4 w-4" />
                <span>SME IPO Listings</span>
              </Link>
              <Link
                href="/sme-ipo-performance-tracker"
                className="flex items-center space-x-2 pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                onClick={closeMenu}
              >
                <TrendingUp className="h-4 w-4" />
                <span>SME IPO Performance Tracker</span>
              </Link>
              <Link
                href="/sme-ipo-prospectus"
                className="flex items-center space-x-2 pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                onClick={closeMenu}
              >
                <FileText className="h-4 w-4" />
                <span>SME IPO Prospectus</span>
              </Link>
              <Link
                href="/sme-ipo-calendar"
                className="flex items-center space-x-2 pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                onClick={closeMenu}
              >
                <Calendar className="h-4 w-4" />
                <span>SME IPO Calendar</span>
              </Link>
              <Link
                href="/sme-ipo-reviews"
                className="flex items-center space-x-2 pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                onClick={closeMenu}
              >
                <Star className="h-4 w-4" />
                <span>SME IPO Reviews</span>
              </Link>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Tools</p>
              <Link
                href="/tools/lot-calculator"
                className="flex items-center space-x-2 pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                onClick={closeMenu}
              >
                <Calculator className="h-4 w-4" />
                <span>Lot Size Calculator</span>
              </Link>
              <Link
                href="/tools/compare"
                className="flex items-center space-x-2 pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                onClick={closeMenu}
              >
                <Scale className="h-4 w-4" />
                <span>Compare IPOs</span>
              </Link>
              <Link
                href="/registrars"
                className="flex items-center space-x-2 pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                onClick={closeMenu}
              >
                <Building2 className="h-4 w-4" />
                <span>Registrars</span>
              </Link>
              <Link
                href="/market-holidays"
                className="flex items-center space-x-2 pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                onClick={closeMenu}
              >
                <Calendar className="h-4 w-4" />
                <span>Market Holidays</span>
              </Link>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
