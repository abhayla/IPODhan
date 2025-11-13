import type { Metadata } from "next";
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
// TEMP: Toaster commented out - testing if it causes webpack error (Session 5)
// import { Toaster } from "@/components/ui/toaster";
// Session 6: Simple Client Component Header (industry-standard pragmatic approach)
import { HeaderSimple } from "@/components/layout/HeaderSimple";
import { Footer } from "@/components/layout/Footer";
import { generateHomepageMetadata } from "@/lib/seo/metadata";

// IPODhan Typography System
// Instrument Serif - Distinctive, professional headings
const instrumentSerif = Instrument_Serif({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  display: "swap",
  preload: true,
});

// Inter - Superior for numbers, body text, and UI
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
  preload: true,
});

// JetBrains Mono - Stock codes, ticker symbols, data
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
  preload: true,
});

export const metadata: Metadata = {
  ...generateHomepageMetadata(),
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'IPODhan',
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Get GA4 Measurement ID from environment variable
  const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  return (
    <html lang="en" suppressHydrationWarning>
      {/* TEMP: GA scripts commented out - testing if they cause webpack error (Session 5) */}
      {/* {GA_MEASUREMENT_ID && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
            strategy="afterInteractive"
          />
          <Script id="google-analytics" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${GA_MEASUREMENT_ID}', {
                page_path: window.location.pathname,
              });
            `}
          </Script>
        </>
      )} */}
      <body className={`${instrumentSerif.variable} ${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        >
          Skip to main content
        </a>
        <div className="flex min-h-screen flex-col">
          {/* Session 6: Simple Client Component Header with React 19 */}
          <HeaderSimple />
          <main id="main-content" className="flex-1">
             {children}
          </main>
          <Footer />
        </div>
        {/* TEMP: Toaster commented out - testing if it causes webpack error (Session 5) */}
        {/* <Toaster /> */}
      </body>
    </html>
  );
}
