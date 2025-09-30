import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'IPODhan - Your Gateway to Smart IPO Investments',
  description: 'Track live IPOs, analyze grey market premiums, compare brokers, and make informed investment decisions with IPODhan - India\'s premier IPO platform.',
  keywords: 'IPO, Indian IPO, Grey Market Premium, GMP, IPO allotment, IPO listing, stock market, investments',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-gray-50">
          {children}
        </div>
      </body>
    </html>
  )
}