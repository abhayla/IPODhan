'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function Navigation() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  return (
    <nav className="bg-white shadow-sm sticky top-0 z-50">
      <div className="container">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-2">
            <span className="text-2xl">💹</span>
            <span className="text-xl font-bold text-primary-600">IPODhan</span>
          </Link>

          {/* Desktop Menu */}
          <div className="hidden md:flex items-center space-x-8">
            <Link href="/ipos" className="text-gray-700 hover:text-primary-600 font-medium">
              IPOs
            </Link>
            <Link href="/gmp" className="text-gray-700 hover:text-primary-600 font-medium">
              GMP Tracker
            </Link>
            <Link href="/brokers" className="text-gray-700 hover:text-primary-600 font-medium">
              Brokers
            </Link>
            <Link href="/tools" className="text-gray-700 hover:text-primary-600 font-medium">
              Tools
            </Link>
            <Link href="/learn" className="text-gray-700 hover:text-primary-600 font-medium">
              Learn
            </Link>
          </div>

          {/* CTA Buttons */}
          <div className="hidden md:flex items-center space-x-4">
            <button className="text-gray-700 hover:text-primary-600 font-medium">
              Login
            </button>
            <button className="btn-primary text-sm">
              Get Started
            </button>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isMenuOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
            </svg>
          </button>
        </div>

        {/* Mobile Menu */}
        {isMenuOpen && (
          <div className="md:hidden py-4 border-t">
            <div className="flex flex-col space-y-4">
              <Link href="/ipos" className="text-gray-700 hover:text-primary-600 font-medium">
                IPOs
              </Link>
              <Link href="/gmp" className="text-gray-700 hover:text-primary-600 font-medium">
                GMP Tracker
              </Link>
              <Link href="/brokers" className="text-gray-700 hover:text-primary-600 font-medium">
                Brokers
              </Link>
              <Link href="/tools" className="text-gray-700 hover:text-primary-600 font-medium">
                Tools
              </Link>
              <Link href="/learn" className="text-gray-700 hover:text-primary-600 font-medium">
                Learn
              </Link>
              <div className="pt-4 border-t flex flex-col space-y-2">
                <button className="btn-secondary w-full">Login</button>
                <button className="btn-primary w-full">Get Started</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}