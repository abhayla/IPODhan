'use client'

import { useState } from 'react'
import Navigation from '@/components/Navigation'

export default function ReturnsCalculator() {
  const [inputs, setInputs] = useState({
    applicationAmount: 15000,
    pricePerShare: 300,
    listingPrice: 345,
    currentPrice: 380,
    lotSize: 50
  })

  const [results, setResults] = useState<any>(null)

  const calculateReturns = () => {
    const shares = Math.floor(inputs.applicationAmount / inputs.pricePerShare)
    const actualShares = Math.floor(shares / inputs.lotSize) * inputs.lotSize
    const investedAmount = actualShares * inputs.pricePerShare

    const listingGain = (inputs.listingPrice - inputs.pricePerShare) * actualShares
    const listingGainPercent = ((inputs.listingPrice - inputs.pricePerShare) / inputs.pricePerShare) * 100

    const currentGain = (inputs.currentPrice - inputs.pricePerShare) * actualShares
    const currentGainPercent = ((inputs.currentPrice - inputs.pricePerShare) / inputs.pricePerShare) * 100

    setResults({
      sharesAllotted: actualShares,
      investedAmount,
      listingValue: inputs.listingPrice * actualShares,
      currentValue: inputs.currentPrice * actualShares,
      listingGain,
      listingGainPercent,
      currentGain,
      currentGainPercent
    })
  }

  return (
    <>
      <Navigation />
      <main className="bg-gray-50 min-h-screen">
        <div className="container py-12">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold text-gray-900 mb-8">
              IPO Returns Calculator
            </h1>

            <div className="grid md:grid-cols-2 gap-8">
              {/* Input Section */}
              <div className="card">
                <h2 className="text-xl font-semibold text-gray-900 mb-6">
                  Enter Investment Details
                </h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Application Amount (₹)
                    </label>
                    <input
                      type="number"
                      value={inputs.applicationAmount}
                      onChange={(e) => setInputs({ ...inputs, applicationAmount: Number(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      IPO Price per Share (₹)
                    </label>
                    <input
                      type="number"
                      value={inputs.pricePerShare}
                      onChange={(e) => setInputs({ ...inputs, pricePerShare: Number(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Expected Listing Price (₹)
                    </label>
                    <input
                      type="number"
                      value={inputs.listingPrice}
                      onChange={(e) => setInputs({ ...inputs, listingPrice: Number(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Current Market Price (₹)
                    </label>
                    <input
                      type="number"
                      value={inputs.currentPrice}
                      onChange={(e) => setInputs({ ...inputs, currentPrice: Number(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Lot Size
                    </label>
                    <input
                      type="number"
                      value={inputs.lotSize}
                      onChange={(e) => setInputs({ ...inputs, lotSize: Number(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <button
                    onClick={calculateReturns}
                    className="btn-primary w-full"
                  >
                    Calculate Returns
                  </button>
                </div>
              </div>

              {/* Results Section */}
              <div className="card">
                <h2 className="text-xl font-semibold text-gray-900 mb-6">
                  Investment Returns
                </h2>

                {results ? (
                  <div className="space-y-4">
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="flex justify-between mb-2">
                        <span className="text-gray-600">Shares Allotted</span>
                        <span className="font-semibold">{results.sharesAllotted}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Amount Invested</span>
                        <span className="font-semibold">₹{results.investedAmount.toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="bg-primary-50 rounded-lg p-4">
                      <h3 className="font-semibold text-gray-900 mb-3">Listing Day Returns</h3>
                      <div className="flex justify-between mb-2">
                        <span className="text-gray-600">Listing Value</span>
                        <span className="font-semibold">₹{results.listingValue.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between mb-2">
                        <span className="text-gray-600">Profit/Loss</span>
                        <span className={`font-semibold ${results.listingGain >= 0 ? 'text-success-dark' : 'text-danger'}`}>
                          ₹{results.listingGain.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Returns %</span>
                        <span className={`font-semibold ${results.listingGainPercent >= 0 ? 'text-success-dark' : 'text-danger'}`}>
                          {results.listingGainPercent.toFixed(2)}%
                        </span>
                      </div>
                    </div>

                    <div className="bg-success-light rounded-lg p-4">
                      <h3 className="font-semibold text-gray-900 mb-3">Current Returns</h3>
                      <div className="flex justify-between mb-2">
                        <span className="text-gray-600">Current Value</span>
                        <span className="font-semibold">₹{results.currentValue.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between mb-2">
                        <span className="text-gray-600">Total Profit/Loss</span>
                        <span className={`font-semibold ${results.currentGain >= 0 ? 'text-success-dark' : 'text-danger'}`}>
                          ₹{results.currentGain.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Total Returns %</span>
                        <span className={`font-semibold ${results.currentGainPercent >= 0 ? 'text-success-dark' : 'text-danger'}`}>
                          {results.currentGainPercent.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    Enter investment details and click calculate to see your returns
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}