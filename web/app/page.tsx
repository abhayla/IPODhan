import Image from "next/image";
import Script from "next/script";
import type { Metadata } from "next";
// TEMP: AffiliateCTAWrapper commented out - causes webpack error (Session 5)
// import { AffiliateCTAWrapper } from "@/components/affiliate/AffiliateCTAWrapper";
import { HomeIPOTablesSection } from "@/components/home/HomeIPOTablesSection";
import { IPOTableSkeleton } from "@/components/home/IPOTableSkeleton";
// TEMP: AsyncErrorBoundary commented out - causes webpack error (Session 5)
// import { AsyncErrorBoundary } from "@/components/error/AsyncErrorBoundary";
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
        {/* TEMP: AffiliateCTAWrapper commented out - causes webpack error (Session 5) */}
        {/* <AffiliateCTAWrapper /> */}

        {/* Hero — compact and data-first (spec H1): single-color title, one-line
            sub, restrained CTAs; the persona came for tables, not marketing */}
        <section className="container mx-auto px-4 py-10 md:py-14">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl text-foreground">
              India&apos;s IPO tracker — live subscription, GMP &amp; allotment
            </h1>
            <p className="mt-3 text-[15px] text-muted-foreground">
              Real-time NSE &amp; BSE data on every mainboard and SME IPO, in one place.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <a
                href="/dashboard"
                className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Browse IPOs
              </a>
              <a
                href="/tools/lot-calculator"
                className="inline-flex h-9 items-center justify-center rounded-lg border bg-background px-5 text-sm font-semibold transition-colors hover:bg-muted"
              >
                Lot Calculator
              </a>
            </div>
          </div>
        </section>

        {/* IPO Tables Section — flat white, quiet title (spec G1/G2) */}
        <section className="border-t py-10 md:py-12">
          <div className="container mx-auto px-4">
            <h2 className="mb-8 text-lg font-semibold text-foreground">
              Latest IPO updates
            </h2>
            {/* TEMP: AsyncErrorBoundary commented out - causes webpack error (Session 5) */}
            {/* <AsyncErrorBoundary
              loadingFallback={<IPOTableSkeleton />}
              fallback={
                <div className="text-center py-12">
                  <p className="text-muted-foreground">
                    Unable to load IPO data at this time. Please try refreshing the page.
                  </p>
                </div>
              }
            > */}
              <HomeIPOTablesSection
                mainboardIPOs={mainboardIPOs}
                smeIPOs={smeIPOs}
                upcomingMainboardIPOs={upcomingMainboardIPOs}
                upcomingSMEIPOs={upcomingSMEIPOs}
              />
            {/* </AsyncErrorBoundary> */}
          </div>
        </section>

        {/* Tools — one quiet row of links (spec H4); the six 200px marketing
            cards and the 'Ready to Start' banner pushed data a full screen down */}
        <section className="border-t py-8">
          <div className="container mx-auto px-4">
            <nav
              aria-label="Tools"
              className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm font-medium"
            >
              <a href="/dashboard" className="text-muted-foreground transition-colors hover:text-primary">Live subscription</a>
              <a href="/mainboard-ipos" className="text-muted-foreground transition-colors hover:text-primary">Financial analysis</a>
              <a href="/tools/lot-calculator" className="text-muted-foreground transition-colors hover:text-primary">Lot calculator</a>
              <a href="/tools/compare" className="text-muted-foreground transition-colors hover:text-primary">Compare IPOs</a>
              <a href="/market-holidays" className="text-muted-foreground transition-colors hover:text-primary">Market holidays</a>
              <a href="/registrars" className="text-muted-foreground transition-colors hover:text-primary">Allotment status</a>
            </nav>
          </div>
        </section>
      </div>
    </>
  );
}
