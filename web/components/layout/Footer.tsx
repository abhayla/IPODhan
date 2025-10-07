/**
 * Footer Component
 *
 * Main footer with:
 * - Quick links (Dashboard, Tools)
 * - Legal links
 * - Copyright notice
 * - Mobile responsive layout
 *
 * @component
 */

import React from 'react';
import Link from 'next/link';
import { Calculator } from 'lucide-react';

// ==================== COMPONENT ====================

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="space-y-3">
            <Link href="/" className="flex items-center space-x-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <span className="text-lg font-bold">I</span>
              </div>
              <span className="text-xl font-bold">IPODhan</span>
            </Link>
            <p className="text-sm text-muted-foreground">
              Your trusted platform for IPO information and analysis.
            </p>
          </div>

          {/* Quick Links */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Quick Links</h3>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/dashboard"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Dashboard
                </Link>
              </li>
              <li>
                <Link
                  href="/dashboard?status=OPEN"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Active IPOs
                </Link>
              </li>
              <li>
                <Link
                  href="/dashboard?status=UPCOMING"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Upcoming IPOs
                </Link>
              </li>
            </ul>
          </div>

          {/* Tools */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Tools</h3>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/tools/lot-calculator"
                  className="flex items-center space-x-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Calculator className="h-4 w-4" />
                  <span>Lot Size Calculator</span>
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Legal</h3>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/privacy"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link
                  href="/disclaimer"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Disclaimer
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Copyright */}
        <div className="mt-8 border-t pt-8">
          <p className="text-center text-sm text-muted-foreground">
            &copy; {currentYear} IPODhan. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
