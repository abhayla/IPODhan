import Image from "next/image";
import Script from "next/script";
import type { Metadata } from "next";
import { AffiliateCTAWrapper } from "@/components/affiliate/AffiliateCTAWrapper";
import { HomeIPOTablesSection } from "@/components/home/HomeIPOTablesSection";
import { IPOTableSkeleton } from "@/components/home/IPOTableSkeleton";
import { AsyncErrorBoundary } from "@/components/error/AsyncErrorBoundary";
import {
  generateOrganizationSchema,
  generateIPOListingSchema,
  toJsonLdScript,
} from "@/lib/seo/structured-data";
import { generateHomepageMetadata } from "@/lib/seo/metadata";
import {
  getMainboardIPOs,
  getSMEIPOs,
  getUpcomingMainboardIPOs,
  getUpcomingSMEIPOs,
} from "@/lib/services/home-ipo-service";

export const metadata: Metadata = generateHomepageMetadata();

// Enable ISR with 5-minute revalidation
export const revalidate = 300;

export default async function Home() {
  const organizationSchema = generateOrganizationSchema();

  // Fetch all IPO data in parallel for performance
  const [mainboardIPOs, smeIPOs, upcomingMainboardIPOs, upcomingSMEIPOs] = await Promise.all([
    getMainboardIPOs(),
    getSMEIPOs(),
    getUpcomingMainboardIPOs(),
    getUpcomingSMEIPOs(),
  ]).catch((error) => {
    console.error("Failed to fetch IPO data for home page:", error);
    // Return empty arrays as fallback
    return [[], [], [], []];
  });

  // Generate IPO listings schema for SEO (combine all IPOs)
  const allIPOs = [...mainboardIPOs, ...smeIPOs, ...upcomingMainboardIPOs, ...upcomingSMEIPOs];
  const ipoListingSchema = generateIPOListingSchema(allIPOs);

  return (
    <>
      {/* Organization Schema for SEO */}
      <Script
        id="organization-schema"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: toJsonLdScript(organizationSchema),
        }}
      />

      {/* IPO Listings Schema for SEO */}
      {allIPOs.length > 0 && (
        <Script
          id="ipo-listings-schema"
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: toJsonLdScript(ipoListingSchema),
          }}
        />
      )}

      <div className="flex flex-col">
        <AffiliateCTAWrapper />

        {/* Hero Section */}
        <section className="container mx-auto px-4 py-20 md:py-32">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent animate-in fade-in slide-in-from-bottom-4 duration-1000">
              Your Trusted IPO Investment Platform
            </h1>
            <p className="mt-8 text-lg text-muted-foreground sm:text-xl md:text-2xl leading-relaxed animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-150">
              Track live IPO subscriptions, analyze financials, compare opportunities, and apply through trusted brokers. Get real-time data from NSE & BSE.
            </p>
            <div className="mt-12 flex flex-col gap-4 sm:flex-row sm:justify-center animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-300">
              <a
                href="/dashboard"
                className="group inline-flex items-center justify-center rounded-lg bg-primary px-8 py-4 text-base font-semibold text-primary-foreground shadow-lg transition-all duration-300 hover:bg-primary/90 hover:shadow-xl hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-95"
              >
                Browse IPOs
                <svg className="ml-2 h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
              <a
                href="/tools/lot-calculator"
                className="group inline-flex items-center justify-center rounded-lg border-2 border-input bg-background px-8 py-4 text-base font-semibold shadow-md transition-all duration-300 hover:bg-accent hover:text-accent-foreground hover:border-accent-foreground/20 hover:shadow-lg hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-95"
              >
                Calculate Lots
                <svg className="ml-2 h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </a>
            </div>
          </div>
        </section>

        {/* IPO Tables Section */}
        <section className="border-t bg-gradient-to-b from-background to-muted/30 py-16 md:py-24">
          <div className="container mx-auto px-4">
            <h2 className="mb-12 text-center text-3xl font-extrabold tracking-tight sm:text-4xl animate-in fade-in slide-in-from-bottom-3 duration-700">
              Latest IPO Updates
            </h2>
            <AsyncErrorBoundary
              loadingFallback={<IPOTableSkeleton />}
              fallback={
                <div className="text-center py-12">
                  <p className="text-muted-foreground">
                    Unable to load IPO data at this time. Please try refreshing the page.
                  </p>
                </div>
              }
            >
              <HomeIPOTablesSection
                mainboardIPOs={mainboardIPOs}
                smeIPOs={smeIPOs}
                upcomingMainboardIPOs={upcomingMainboardIPOs}
                upcomingSMEIPOs={upcomingSMEIPOs}
              />
            </AsyncErrorBoundary>
          </div>
        </section>

        {/* Features Section */}
        <section className="border-t bg-gradient-to-b from-muted/50 to-background py-20 md:py-32">
          <div className="container mx-auto px-4">
            <h2 className="mb-16 text-center text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl animate-in fade-in slide-in-from-bottom-3 duration-700">
              Everything You Need for IPO Investments
            </h2>
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              <div className="group rounded-xl border bg-card p-8 shadow-md transition-all duration-300 hover:shadow-2xl hover:scale-105 hover:-translate-y-1 hover:border-primary/50">
                <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg transition-all duration-300 group-hover:scale-110 group-hover:rotate-3">
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <h3 className="mb-3 text-xl font-bold group-hover:text-primary transition-colors duration-300">Live Subscription Data</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Track real-time IPO subscription numbers across all categories - Retail, HNI, QIB, and more.
                </p>
              </div>

              <div className="group rounded-xl border bg-card p-8 shadow-md transition-all duration-300 hover:shadow-2xl hover:scale-105 hover:-translate-y-1 hover:border-primary/50">
                <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg transition-all duration-300 group-hover:scale-110 group-hover:rotate-3">
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h3 className="mb-3 text-xl font-bold group-hover:text-primary transition-colors duration-300">Financial Analysis</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Deep dive into company financials, valuations, and key metrics to make informed decisions.
                </p>
              </div>

              <div className="group rounded-xl border bg-card p-8 shadow-md transition-all duration-300 hover:shadow-2xl hover:scale-105 hover:-translate-y-1 hover:border-primary/50">
                <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg transition-all duration-300 group-hover:scale-110 group-hover:rotate-3">
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="mb-3 text-xl font-bold group-hover:text-primary transition-colors duration-300">Investment Calculators</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Calculate lot sizes, potential returns, and plan your IPO applications with our smart tools.
                </p>
              </div>

              <div className="group rounded-xl border bg-card p-8 shadow-md transition-all duration-300 hover:shadow-2xl hover:scale-105 hover:-translate-y-1 hover:border-primary/50">
                <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg transition-all duration-300 group-hover:scale-110 group-hover:rotate-3">
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                  </svg>
                </div>
                <h3 className="mb-3 text-xl font-bold group-hover:text-primary transition-colors duration-300">Compare IPOs</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Side-by-side comparison of multiple IPOs to find the best investment opportunities.
                </p>
              </div>

              <div className="group rounded-xl border bg-card p-8 shadow-md transition-all duration-300 hover:shadow-2xl hover:scale-105 hover:-translate-y-1 hover:border-primary/50">
                <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg transition-all duration-300 group-hover:scale-110 group-hover:rotate-3">
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="mb-3 text-xl font-bold group-hover:text-primary transition-colors duration-300">Market Holidays</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Stay updated with NSE & BSE trading holidays and plan your IPO applications accordingly.
                </p>
              </div>

              <div className="group rounded-xl border bg-card p-8 shadow-md transition-all duration-300 hover:shadow-2xl hover:scale-105 hover:-translate-y-1 hover:border-primary/50">
                <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg transition-all duration-300 group-hover:scale-110 group-hover:rotate-3">
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <h3 className="mb-3 text-xl font-bold group-hover:text-primary transition-colors duration-300">Registrar Directory</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Access complete registrar information and check your IPO allotment status quickly.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="relative border-t py-20 md:py-32 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-primary/5"></div>
          <div className="container relative mx-auto px-4">
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                Ready to Start Your IPO Journey?
              </h2>
              <p className="mt-6 text-lg text-muted-foreground sm:text-xl leading-relaxed">
                Join thousands of investors who trust IPODhan for their IPO investments. Get started today!
              </p>
              <div className="mt-12 animate-in fade-in slide-in-from-bottom-3 duration-700">
                <a
                  href="/dashboard"
                  className="group inline-flex items-center justify-center rounded-lg bg-primary px-10 py-4 text-base font-semibold text-primary-foreground shadow-xl transition-all duration-300 hover:bg-primary/90 hover:shadow-2xl hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-95"
                >
                  Explore Active IPOs
                  <svg className="ml-2 h-5 w-5 transition-transform duration-300 group-hover:translate-x-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
