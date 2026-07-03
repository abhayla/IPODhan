/**
 * Lot Size Calculator - Standalone Page
 *
 * Dedicated page for lot size calculations
 * Features:
 * - Dropdown to select any IPO
 * - Real-time calculation
 * - localStorage to remember last used IPO
 * - SEO optimized with metadata
 * - Mobile-responsive design
 *
 * @route /tools/lot-calculator
 */

import { Metadata } from 'next';
import { LotCalculator } from '@/components/tools/LotCalculator';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { generateLotCalculatorMetadata } from '@/lib/seo/metadata';

// ==================== METADATA ====================

export const metadata: Metadata = generateLotCalculatorMetadata();

// ==================== PAGE COMPONENT ====================

export default function LotCalculatorPage() {
  return (
    <>
      {/* JSON-LD Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebApplication',
            name: 'IPO Lot Size Calculator',
            description:
              'Calculate how many lots you can buy with your investment amount for Indian IPOs',
            applicationCategory: 'FinanceApplication',
            offers: {
              '@type': 'Offer',
              price: '0',
              priceCurrency: 'INR',
            },
            featureList: [
              'Calculate lot size for any IPO',
              'Real-time calculation',
              'Investment amount validation',
              'Total shares and amount display',
            ],
          }),
        }}
      />

      <div className="min-h-screen bg-background">
        {/* Breadcrumbs */}
        <div className="border-b bg-muted/30">
          <div className="container mx-auto px-4 py-3">
            <Breadcrumbs
              items={[
                { label: 'Home', href: '/' },
                { label: 'Tools', href: '/tools' },
                { label: 'Lot Calculator' },
              ]}
            />
          </div>
        </div>

        {/* Page Header */}
        <div className="border-b bg-gradient-to-r from-primary/10 to-primary/5">
          <div className="container mx-auto px-4 py-12">
            <div className="max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-700">
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                IPO Lot Size Calculator
              </h1>
              <p className="mt-4 text-lg text-muted-foreground animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150">
                Calculate how many lots you can buy with your investment amount.
                Select an IPO, enter your investment, and get instant results with
                total shares and amount breakdown.
              </p>
            </div>
          </div>
        </div>

        {/* Calculator */}
        <div className="container mx-auto px-4 py-12">
          <div className="mx-auto max-w-4xl">
            <LotCalculator mode="standalone" />

            {/* Help Section */}
            <div className="mt-12 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
              <h2 className="text-2xl font-bold">How to Use</h2>
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="group rounded-lg border p-6 transition-all duration-300 hover:shadow-lg hover:scale-105 hover:border-primary/50">
                  <h3 className="font-semibold group-hover:text-primary transition-colors duration-300">Step 1: Select IPO</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Choose an IPO from the dropdown menu. The calculator shows
                    active and recent IPOs with available pricing information.
                  </p>
                </div>
                <div className="group rounded-lg border p-6 transition-all duration-300 hover:shadow-lg hover:scale-105 hover:border-primary/50">
                  <h3 className="font-semibold group-hover:text-primary transition-colors duration-300">Step 2: Enter Amount</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Enter your investment amount in rupees. The calculator will
                    automatically format it with comma separators.
                  </p>
                </div>
                <div className="group rounded-lg border p-6 transition-all duration-300 hover:shadow-lg hover:scale-105 hover:border-primary/50">
                  <h3 className="font-semibold group-hover:text-primary transition-colors duration-300">Step 3: View Results</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    See the number of lots you can buy, total shares, and exact
                    investment amount rounded to lot size.
                  </p>
                </div>
                <div className="group rounded-lg border p-6 transition-all duration-300 hover:shadow-lg hover:scale-105 hover:border-primary/50">
                  <h3 className="font-semibold group-hover:text-primary transition-colors duration-300">Understanding Lots</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    A lot is the minimum number of shares you can apply for in an
                    IPO. You must buy shares in multiples of the lot size.
                  </p>
                </div>
              </div>

              {/* Formula Explanation */}
              <div className="rounded-lg border bg-muted/50 p-6">
                <h3 className="font-semibold">Calculation Formula</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  The calculator uses the maximum price from the price band for
                  conservative calculations:
                </p>
                <div className="mt-4 font-mono text-sm">
                  <p>lots = floor(investment_amount / (price × lot_size))</p>
                  <p>total_shares = lots × lot_size</p>
                  <p>total_amount = lots × lot_size × price</p>
                </div>
              </div>

              {/* Example — quiet white card with a thin left-accent rule, not a
                  saturated fill (R17 #3, the product's worst tonal offense) */}
              <div className="rounded-lg border border-l-4 border-l-primary/50 bg-card p-6">
                <h3 className="font-semibold">Example Calculation</h3>
                <div className="mt-4 space-y-2 text-sm">
                  <p>
                    <strong>Investment Amount:</strong> ₹15,000
                  </p>
                  <p>
                    <strong>IPO Price:</strong> ₹350 (max price)
                  </p>
                  <p>
                    <strong>Lot Size:</strong> 40 shares
                  </p>
                  <hr className="my-3" />
                  <p>
                    <strong>Result:</strong>
                  </p>
                  <p>Number of Lots: 1 lot (floor of 15,000 / (350 × 40))</p>
                  <p>Total Shares: 40 shares (1 × 40)</p>
                  <p>Total Investment: ₹14,000 (1 × 40 × 350)</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
