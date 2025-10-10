'use client';

/**
 * Header Component
 *
 * Main navigation header with:
 * - Logo and branding
 * - Navigation menu (Dashboard, Tools)
 * - Mobile responsive menu
 * - Accessible keyboard navigation with ESC support
 *
 * @component
 */

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Calculator, Scale, Building2, Calendar } from 'lucide-react';
import styles from './Header.module.css';

// ==================== COMPONENT ====================

export function Header() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopToolsOpen, setDesktopToolsOpen] = useState(false);

  const isActive = (path: string) => {
    return pathname === path || pathname.startsWith(path);
  };

  const handleToolsKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setDesktopToolsOpen(!desktopToolsOpen);
    } else if (e.key === 'Escape') {
      setDesktopToolsOpen(false);
    }
  };

  // Handle ESC key to close mobile menu and desktop tools dropdown
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
        setDesktopToolsOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []); // Empty dependency array - listener never changes

  return (
    <header className={`sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 ${styles.header}`}>
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className={`group flex items-center space-x-2 ${styles.logo}`} aria-label="IPODhan - Home">
            <div className={`flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground ${styles.logoIcon}`} aria-hidden="true">
              <span className="text-lg font-bold">I</span>
            </div>
            <span className={`text-xl font-bold ${styles.logoText}`}>IPODhan</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex md:items-center md:space-x-6">
            <Link
              href="/dashboard"
              className={`relative text-sm font-medium ${styles.navLink} ${
                isActive('/dashboard')
                  ? 'text-foreground after:absolute after:bottom-[-4px] after:left-0 after:h-0.5 after:w-full after:bg-primary'
                  : 'text-muted-foreground'
              }`}
            >
              Dashboard
            </Link>

            <div className="group relative">
              <button
                className={`relative flex items-center space-x-1 text-sm font-medium ${styles.navLink} ${
                  isActive('/tools')
                    ? 'text-foreground after:absolute after:bottom-[-4px] after:left-0 after:h-0.5 after:w-full after:bg-primary'
                    : 'text-muted-foreground'
                }`}
                onClick={() => setDesktopToolsOpen(!desktopToolsOpen)}
                onKeyDown={handleToolsKeyDown}
                aria-haspopup="true"
                aria-expanded={desktopToolsOpen}
              >
                <span>Tools</span>
                <svg
                  className={`h-4 w-4 ${styles.chevron} ${desktopToolsOpen ? 'rotate-180' : ''}`}
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>

              {/* Dropdown Menu */}
              <div className={`absolute left-0 top-full mt-2 w-56 rounded-xl border bg-popover p-2 text-popover-foreground shadow-2xl ${styles.dropdown} ${
                desktopToolsOpen ? 'visible opacity-100 translate-y-0' : 'invisible opacity-0 -translate-y-2'
              } group-hover:visible group-hover:opacity-100 group-hover:translate-y-0`}>
                <Link
                  href="/tools/lot-calculator"
                  className={`group/item flex items-center space-x-3 rounded-lg px-4 py-3 text-sm hover:bg-accent hover:text-accent-foreground ${styles.dropdownItem}`}
                  onClick={() => setDesktopToolsOpen(false)}
                >
                  <Calculator className={`h-5 w-5 ${styles.dropdownItemIcon}`} />
                  <div>
                    <p className="font-semibold">Lot Size Calculator</p>
                    <p className="text-xs text-muted-foreground">
                      Calculate lots for your investment
                    </p>
                  </div>
                </Link>
                <Link
                  href="/tools/compare"
                  className={`group/item flex items-center space-x-3 rounded-lg px-4 py-3 text-sm hover:bg-accent hover:text-accent-foreground ${styles.dropdownItem}`}
                  onClick={() => setDesktopToolsOpen(false)}
                >
                  <Scale className={`h-5 w-5 ${styles.dropdownItemIcon}`} />
                  <div>
                    <p className="font-semibold">Compare IPOs</p>
                    <p className="text-xs text-muted-foreground">
                      Compare up to 3 IPOs side-by-side
                    </p>
                  </div>
                </Link>
                <Link
                  href="/registrars"
                  className={`group/item flex items-center space-x-3 rounded-lg px-4 py-3 text-sm hover:bg-accent hover:text-accent-foreground ${styles.dropdownItem}`}
                  onClick={() => setDesktopToolsOpen(false)}
                >
                  <Building2 className={`h-5 w-5 ${styles.dropdownItemIcon}`} />
                  <div>
                    <p className="font-semibold">Registrars</p>
                    <p className="text-xs text-muted-foreground">
                      Find registrar contact information
                    </p>
                  </div>
                </Link>
                <Link
                  href="/market-holidays"
                  className={`group/item flex items-center space-x-3 rounded-lg px-4 py-3 text-sm hover:bg-accent hover:text-accent-foreground ${styles.dropdownItem}`}
                  onClick={() => setDesktopToolsOpen(false)}
                >
                  <Calendar className={`h-5 w-5 ${styles.dropdownItemIcon}`} />
                  <div>
                    <p className="font-semibold">Market Holidays</p>
                    <p className="text-xs text-muted-foreground">
                      NSE & BSE trading holidays
                    </p>
                  </div>
                </Link>
              </div>
            </div>
          </nav>

          {/* Mobile Menu Button */}
          <button
            className={`group md:hidden p-2 rounded-lg hover:bg-accent ${styles.mobileMenuButton}`}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? (
              <X className={`h-6 w-6 ${styles.mobileMenuIcon} ${styles.menuIconOpen}`} />
            ) : (
              <Menu className={`h-6 w-6 ${styles.mobileMenuIcon} ${styles.menuIconClosed}`} />
            )}
          </button>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="border-t py-4 md:hidden">
            <nav className="flex flex-col space-y-4">
              <Link
                href="/dashboard"
                className={`text-sm font-medium transition-colors hover:text-primary ${
                  isActive('/dashboard')
                    ? 'text-foreground'
                    : 'text-muted-foreground'
                }`}
                onClick={() => setMobileMenuOpen(false)}
              >
                Dashboard
              </Link>

              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Tools</p>
                <Link
                  href="/tools/lot-calculator"
                  className="flex items-center space-x-2 pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Calculator className="h-4 w-4" />
                  <span>Lot Size Calculator</span>
                </Link>
                <Link
                  href="/tools/compare"
                  className="flex items-center space-x-2 pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Scale className="h-4 w-4" />
                  <span>Compare IPOs</span>
                </Link>
                <Link
                  href="/registrars"
                  className="flex items-center space-x-2 pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Building2 className="h-4 w-4" />
                  <span>Registrars</span>
                </Link>
                <Link
                  href="/market-holidays"
                  className="flex items-center space-x-2 pl-4 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Calendar className="h-4 w-4" />
                  <span>Market Holidays</span>
                </Link>
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
