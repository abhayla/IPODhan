interface IPOCardProps {
  ipo: {
    id: number
    companyName: string
    category: string
    exchange: string
    priceRange: string
    lotSize: number
    minInvestment: string
    openDate: string
    closeDate: string
    status: string
    subscription: number
    retailSubscription: number
    qibSubscription: number
    niiSubscription: number
    gmp: number
    gmpPercent: number
    expectedListing: string
    rating: number
  }
}

export default function IPOCard({ ipo }: IPOCardProps) {
  const getStatusBadge = () => {
    switch (ipo.status) {
      case 'LIVE':
        return <span className="badge-live">LIVE</span>
      case 'UPCOMING':
        return <span className="badge-upcoming">UPCOMING</span>
      case 'CLOSED':
        return <span className="badge-closed">CLOSED</span>
      default:
        return null
    }
  }

  return (
    <div className="card hover:shadow-lg transition-shadow duration-200">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center">
            <span className="text-xl font-bold text-primary-600">
              {ipo.companyName.charAt(0)}
            </span>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{ipo.companyName}</h3>
            <p className="text-sm text-gray-500">
              {ipo.category} • {ipo.exchange}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-1">
          <span className="text-warning text-sm">⭐</span>
          <span className="text-sm font-medium">{ipo.rating}</span>
        </div>
      </div>

      {/* Price Info */}
      <div className="border-t border-b py-4 mb-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-gray-600">Price Range</span>
          <span className="font-semibold">{ipo.priceRange}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600">Min Investment</span>
          <span className="font-semibold">{ipo.minInvestment}</span>
        </div>
      </div>

      {/* Dates */}
      <div className="mb-4">
        <div className="flex justify-between items-center text-sm">
          <span className="text-gray-600">Open: {ipo.openDate}</span>
          <span className="text-gray-600">Close: {ipo.closeDate}</span>
        </div>
      </div>

      {/* Subscription Status */}
      {ipo.status === 'LIVE' && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">Subscription</span>
            {getStatusBadge()}
          </div>
          <div className="bg-gray-200 rounded-full h-2 mb-2">
            <div
              className="bg-gradient-to-r from-primary-500 to-primary-600 h-2 rounded-full"
              style={{ width: `${Math.min(ipo.subscription * 20, 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-center">
            <span className="text-lg font-bold text-primary-600">
              {ipo.subscription}x
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
            <div className="text-center">
              <div className="text-gray-500">Retail</div>
              <div className="font-semibold">{ipo.retailSubscription}x</div>
            </div>
            <div className="text-center">
              <div className="text-gray-500">QIB</div>
              <div className="font-semibold">{ipo.qibSubscription}x</div>
            </div>
            <div className="text-center">
              <div className="text-gray-500">NII</div>
              <div className="font-semibold">{ipo.niiSubscription}x</div>
            </div>
          </div>
        </div>
      )}

      {/* GMP Info */}
      <div className="bg-success-light rounded-lg p-3 mb-4">
        <div className="flex justify-between items-center">
          <div>
            <div className="text-xs text-gray-600">GMP</div>
            <div className="font-bold text-success-dark">
              +₹{ipo.gmp} ({ipo.gmpPercent}%)
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-600">Est. Listing</div>
            <div className="font-bold text-gray-900">{ipo.expectedListing}</div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-3 gap-2">
        <button className="text-primary-600 hover:bg-primary-50 py-2 px-3 rounded-lg text-sm font-medium transition-colors">
          View
        </button>
        <button className="text-primary-600 hover:bg-primary-50 py-2 px-3 rounded-lg text-sm font-medium transition-colors">
          Track
        </button>
        <button className="bg-primary-600 hover:bg-primary-700 text-white py-2 px-3 rounded-lg text-sm font-medium transition-colors">
          Apply
        </button>
      </div>
    </div>
  )
}