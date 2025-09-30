'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    const token = localStorage.getItem('token')
    const userData = localStorage.getItem('user')

    if (!token || !userData) {
      router.push('/auth/login')
      return
    }

    setUser(JSON.parse(userData))
  }, [router])

  if (!user) {
    return <div>Loading...</div>
  }

  return (
    <>
      <Navigation />
      <main className="bg-gray-50 min-h-screen">
        <div className="container py-8">
          {/* Welcome Section */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">
              Welcome back, {user.name}!
            </h1>
            <p className="text-gray-600 mt-2">
              Track your IPO applications and portfolio performance
            </p>
          </div>

          {/* Stats Grid */}
          <div className="grid md:grid-cols-4 gap-6 mb-8">
            <div className="card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Applications</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">12</p>
                </div>
                <div className="text-3xl">📊</div>
              </div>
            </div>

            <div className="card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Allotted IPOs</p>
                  <p className="text-2xl font-bold text-success-dark mt-1">5</p>
                </div>
                <div className="text-3xl">✅</div>
              </div>
            </div>

            <div className="card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Investment</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">₹1.8L</p>
                </div>
                <div className="text-3xl">💰</div>
              </div>
            </div>

            <div className="card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Returns</p>
                  <p className="text-2xl font-bold text-success-dark mt-1">+23%</p>
                </div>
                <div className="text-3xl">📈</div>
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-8">
            {/* Active Applications */}
            <div className="card">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Active Applications
              </h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">ABC Technologies</p>
                    <p className="text-sm text-gray-600">Applied on Jan 15</p>
                  </div>
                  <span className="badge-live">LIVE</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">XYZ Pharma</p>
                    <p className="text-sm text-gray-600">Applied on Jan 10</p>
                  </div>
                  <span className="badge-upcoming">UPCOMING</span>
                </div>
              </div>
            </div>

            {/* Recent Allotments */}
            <div className="card">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Recent Allotments
              </h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-success-light rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">Tech Corp Ltd</p>
                    <p className="text-sm text-gray-600">50 shares allotted</p>
                  </div>
                  <span className="text-success-dark font-medium">+18%</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-success-light rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">Finance Solutions</p>
                    <p className="text-sm text-gray-600">100 shares allotted</p>
                  </div>
                  <span className="text-success-dark font-medium">+25%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Portfolio Performance */}
          <div className="card mt-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Portfolio Performance
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 text-sm font-medium text-gray-600">Company</th>
                    <th className="text-left py-2 text-sm font-medium text-gray-600">Shares</th>
                    <th className="text-left py-2 text-sm font-medium text-gray-600">Buy Price</th>
                    <th className="text-left py-2 text-sm font-medium text-gray-600">Current Price</th>
                    <th className="text-left py-2 text-sm font-medium text-gray-600">P&L</th>
                    <th className="text-left py-2 text-sm font-medium text-gray-600">Returns</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="py-3 font-medium">Tech Corp Ltd</td>
                    <td className="py-3">50</td>
                    <td className="py-3">₹450</td>
                    <td className="py-3">₹531</td>
                    <td className="py-3 text-success-dark">+₹4,050</td>
                    <td className="py-3 text-success-dark">+18%</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-3 font-medium">Finance Solutions</td>
                    <td className="py-3">100</td>
                    <td className="py-3">₹200</td>
                    <td className="py-3">₹250</td>
                    <td className="py-3 text-success-dark">+₹5,000</td>
                    <td className="py-3 text-success-dark">+25%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}