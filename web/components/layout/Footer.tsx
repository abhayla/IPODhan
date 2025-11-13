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
import { Calculator, Scale, Info } from 'lucide-react';
import { affiliateConfig } from '@/lib/config/affiliate-links';

// ==================== COMPONENT ====================

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t bg-gradient-to-b from-background to-muted/20">
      <div className="container mx-auto px-4 py-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="space-y-4">
            <Link href="/" className="group flex items-center space-x-2 transition-transform duration-300 hover:scale-105" aria-label="IPODhan - Home">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-all duration-300 group-hover:shadow-lg group-hover:shadow-primary/50" aria-hidden="true">
                <span className="text-lg font-bold">I</span>
              </div>
              <span className="text-xl font-bold transition-colors duration-300 group-hover:text-primary">IPODhan</span>
            </Link>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your trusted platform for IPO information and analysis.
            </p>
          </div>

          {/* Quick Links */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold tracking-wide">Quick Links</h3>
            <ul className="space-y-3">
              <li>
                <Link
                  href="/dashboard"
                  className="group inline-flex items-center text-sm text-muted-foreground transition-all duration-300 hover:text-primary hover:translate-x-1"
                >
                  <span className="mr-2 opacity-0 transition-opacity duration-300 group-hover:opacity-100">→</span>
                  Dashboard
                </Link>
              </li>
              <li>
                <Link
                  href="/dashboard?status=OPEN"
                  className="group inline-flex items-center text-sm text-muted-foreground transition-all duration-300 hover:text-primary hover:translate-x-1"
                >
                  <span className="mr-2 opacity-0 transition-opacity duration-300 group-hover:opacity-100">→</span>
                  Active IPOs
                </Link>
              </li>
              <li>
                <Link
                  href="/dashboard?status=UPCOMING"
                  className="group inline-flex items-center text-sm text-muted-foreground transition-all duration-300 hover:text-primary hover:translate-x-1"
                >
                  <span className="mr-2 opacity-0 transition-opacity duration-300 group-hover:opacity-100">→</span>
                  Upcoming IPOs
                </Link>
              </li>
            </ul>
          </div>

          {/* Tools */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold tracking-wide">Tools</h3>
            <ul className="space-y-3">
              <li>
                <Link
                  href="/tools/lot-calculator"
                  className="group flex items-center space-x-2 text-sm text-muted-foreground transition-all duration-300 hover:text-primary hover:translate-x-1"
                >
                  <Calculator className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" />
                  <span>Lot Size Calculator</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/tools/compare"
                  className="group flex items-center space-x-2 text-sm text-muted-foreground transition-all duration-300 hover:text-primary hover:translate-x-1"
                >
                  <Scale className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" />
                  <span>Compare IPOs</span>
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold tracking-wide">Legal</h3>
            <ul className="space-y-3">
              <li>
                <Link
                  href="/privacy"
                  className="group inline-flex items-center text-sm text-muted-foreground transition-all duration-300 hover:text-primary hover:translate-x-1"
                >
                  <span className="mr-2 opacity-0 transition-opacity duration-300 group-hover:opacity-100">→</span>
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="group inline-flex items-center text-sm text-muted-foreground transition-all duration-300 hover:text-primary hover:translate-x-1"
                >
                  <span className="mr-2 opacity-0 transition-opacity duration-300 group-hover:opacity-100">→</span>
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link
                  href="/disclaimer"
                  className="group inline-flex items-center text-sm text-muted-foreground transition-all duration-300 hover:text-primary hover:translate-x-1"
                >
                  <span className="mr-2 opacity-0 transition-opacity duration-300 group-hover:opacity-100">→</span>
                  Disclaimer
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Affiliate Disclaimer */}
        <div className="mt-8 border-t pt-6">
          <div className="flex items-start gap-2 rounded-md border border-muted bg-muted/30 p-4">
            <Info className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              {affiliateConfig.disclaimer.text}
            </p>
          </div>
        </div>

        {/* Copyright */}
        <div className="mt-6 pt-6 border-t">
          <p className="text-center text-sm text-muted-foreground">
            &copy; {currentYear} IPODhan. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
