'use client'

import { useState } from 'react'
import IPOCard from './IPOCard'

const mockIPOs = [
  {
    id: 1,
    companyName: 'ABC Technologies Ltd',
    category: 'Technology',
    exchange: 'BSE',
    priceRange: '₹280-300',
    lotSize: 50,
    minInvestment: '₹15,000',
    openDate: 'Jan 15, 2024',
    closeDate: 'Jan 17, 2024',
    status: 'LIVE',
    subscription: 2.3,
    retailSubscription: 3.2,
    qibSubscription: 1.8,
    niiSubscription: 2.1,
    gmp: 45,
    gmpPercent: 15,
    expectedListing: '₹345',
    rating: 4.2
  },
  {
    id: 2,
    companyName: 'XYZ Pharma Ltd',
    category: 'Healthcare',
    exchange: 'NSE',
    priceRange: '₹150-160',
    lotSize: 100,
    minInvestment: '₹16,000',
    openDate: 'Jan 18, 2024',
    closeDate: 'Jan 20, 2024',
    status: 'UPCOMING',
    subscription: 0,
    retailSubscription: 0,
    qibSubscription: 0,
    niiSubscription: 0,
    gmp: 25,
    gmpPercent: 16,
    expectedListing: '₹185',
    rating: 3.8
  }
]

export default function LiveIPOList() {
  const [filter, setFilter] = useState('all')

  return (
    <section className="py-16 bg-gray-50">
      <div className="container">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-4 md:mb-0">
            Live & Upcoming IPOs
          </h2>

          {/* Filters */}
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-lg font-medium ${
                filter === 'all'
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('live')}
              className={`px-4 py-2 rounded-lg font-medium ${
                filter === 'live'
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              Live
            </button>
            <button
              onClick={() => setFilter('upcoming')}
              className={`px-4 py-2 rounded-lg font-medium ${
                filter === 'upcoming'
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              Upcoming
            </button>
            <button
              onClick={() => setFilter('closed')}
              className={`px-4 py-2 rounded-lg font-medium ${
                filter === 'closed'
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              Closed
            </button>
          </div>
        </div>

        {/* IPO Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {mockIPOs.map((ipo) => (
            <IPOCard key={ipo.id} ipo={ipo} />
          ))}
        </div>

        {/* View All Button */}
        <div className="text-center mt-8">
          <button className="btn-primary">
            View All IPOs →
          </button>
        </div>
      </div>
    </section>
  )
}