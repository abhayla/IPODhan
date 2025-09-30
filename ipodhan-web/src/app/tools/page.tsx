import Navigation from '@/components/Navigation'
import Link from 'next/link'

export default function ToolsPage() {
  const tools = [
    {
      icon: '💰',
      title: 'Returns Calculator',
      description: 'Calculate potential returns from IPO investments',
      href: '/tools/returns-calculator'
    },
    {
      icon: '🎯',
      title: 'Allotment Calculator',
      description: 'Check probability of IPO allotment based on subscription',
      href: '/tools/allotment-calculator'
    },
    {
      icon: '📊',
      title: 'Investment Planner',
      description: 'Plan your IPO investments across multiple applications',
      href: '/tools/investment-planner'
    },
    {
      icon: '📈',
      title: 'GMP Tracker',
      description: 'Track grey market premium trends for all IPOs',
      href: '/tools/gmp-tracker'
    },
    {
      icon: '🔍',
      title: 'Allotment Checker',
      description: 'Check your IPO allotment status',
      href: '/tools/allotment-checker'
    },
    {
      icon: '⚖️',
      title: 'Broker Comparison',
      description: 'Compare brokers for IPO applications',
      href: '/tools/broker-comparison'
    }
  ]

  return (
    <>
      <Navigation />
      <main className="bg-gray-50 min-h-screen">
        <div className="container py-12">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">
              IPO Investment Tools
            </h1>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Powerful calculators and tools to help you make informed IPO investment decisions
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {tools.map((tool, index) => (
              <Link key={index} href={tool.href}>
                <div className="card hover:shadow-lg transition-shadow duration-200 cursor-pointer h-full">
                  <div className="text-4xl mb-4">{tool.icon}</div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">
                    {tool.title}
                  </h3>
                  <p className="text-gray-600">
                    {tool.description}
                  </p>
                  <div className="mt-4 text-primary-600 font-medium">
                    Use Tool →
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </>
  )
}