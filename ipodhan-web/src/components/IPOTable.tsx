'use client'

import Link from 'next/link'

const mockIPOs = [
  {
    id: 1,
    companyName: 'ABC Technologies Ltd',
    status: 'LIVE',
    priceRange: '₹280-300',
    openDate: 'Jan 15',
    closeDate: 'Jan 17',
    issueSize: '₹500 Cr',
    lotSize: 50,
    subscription: '2.3x',
    gmp: '+₹45',
    gmpPercent: '+15%'
  },
  {
    id: 2,
    companyName: 'XYZ Pharma Ltd',
    status: 'UPCOMING',
    priceRange: '₹150-160',
    openDate: 'Jan 18',
    closeDate: 'Jan 20',
    issueSize: '₹300 Cr',
    lotSize: 100,
    subscription: '-',
    gmp: '+₹25',
    gmpPercent: '+16%'
  }
]

export default function IPOTable() {
  const getStatusBadge = (status: string) => {
    const badges: any = {
      LIVE: 'badge-live',
      UPCOMING: 'badge-upcoming',
      CLOSED: 'badge-closed'
    }
    return badges[status] || 'badge-closed'
  }

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Company
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Price Range
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Open-Close
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Issue Size
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Lot Size
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Subscription
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                GMP
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {mockIPOs.map((ipo) => (
              <tr key={ipo.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">
                    {ipo.companyName}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={getStatusBadge(ipo.status)}>
                    {ipo.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {ipo.priceRange}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {ipo.openDate} - {ipo.closeDate}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {ipo.issueSize}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {ipo.lotSize}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm font-medium text-primary-600">
                    {ipo.subscription}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm">
                    <span className="font-medium text-success-dark">{ipo.gmp}</span>
                    <span className="text-gray-500 ml-1">({ipo.gmpPercent})</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <Link
                    href={`/ipos/${ipo.id}`}
                    className="text-primary-600 hover:text-primary-700 font-medium"
                  >
                    View Details →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="bg-gray-50 px-6 py-3 flex items-center justify-between border-t border-gray-200">
        <div className="text-sm text-gray-700">
          Showing 1 to 10 of 50 results
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-100">
            Previous
          </button>
          <button className="px-3 py-1 bg-primary-600 text-white rounded-lg">
            1
          </button>
          <button className="px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-100">
            2
          </button>
          <button className="px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-100">
            3
          </button>
          <button className="px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-100">
            Next
          </button>
        </div>
      </div>
    </div>
  )
}