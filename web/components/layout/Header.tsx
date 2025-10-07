'use client';

/**
 * Header Component
 *
 * Main navigation header with:
 * - Logo and branding
 * - Navigation menu (Dashboard, Tools)
 * - Mobile responsive menu
 *
 * @component
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Calculator } from 'lucide-react';

// ==================== COMPONENT ====================

export function Header() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (path: string) => {
    return pathname === path || pathname.startsWith(path);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <span className="text-lg font-bold">I</span>
            </div>
            <span className="text-xl font-bold">IPODhan</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex md:items-center md:space-x-6">
            <Link
              href="/dashboard"
              className={`text-sm font-medium transition-colors hover:text-primary ${
                isActive('/dashboard')
                  ? 'text-foreground'
                  : 'text-muted-foreground'
              }`}
            >
              Dashboard
            </Link>

            <div className="group relative">
              <button
                className={`flex items-center space-x-1 text-sm font-medium transition-colors hover:text-primary ${
                  isActive('/tools')
                    ? 'text-foreground'
                    : 'text-muted-foreground'
                }`}
              >
                <span>Tools</span>
                <svg
                  className="h-4 w-4"
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
              <div className="invisible absolute left-0 top-full mt-2 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md opacity-0 transition-all group-hover:visible group-hover:opacity-100">
                <Link
                  href="/tools/lot-calculator"
                  className="flex items-center space-x-2 rounded-sm px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Calculator className="h-4 w-4" />
                  <div>
                    <p className="font-medium">Lot Size Calculator</p>
                    <p className="text-xs text-muted-foreground">
                      Calculate lots for your investment
                    </p>
                  </div>
                </Link>
              </div>
            </div>
          </nav>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
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
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
