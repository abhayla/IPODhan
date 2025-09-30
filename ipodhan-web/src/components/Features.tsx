export default function Features() {
  const features = [
    {
      icon: '📊',
      title: 'Real-Time Tracking',
      description: 'Live subscription data and GMP updates every 30 minutes'
    },
    {
      icon: '💰',
      title: 'Grey Market Premium',
      description: 'Accurate GMP rates from trusted sources with historical trends'
    },
    {
      icon: '🏦',
      title: 'Broker Comparison',
      description: 'Compare 15+ brokers for fees, features, and IPO application process'
    },
    {
      icon: '📱',
      title: 'Smart Alerts',
      description: 'Get notified for IPO openings, closings, and allotment results'
    },
    {
      icon: '📈',
      title: 'Performance Analytics',
      description: 'Track IPO performance post-listing with detailed analysis'
    },
    {
      icon: '🎯',
      title: 'Investment Tools',
      description: 'Calculate returns, check allotment probability, and plan investments'
    }
  ]

  return (
    <section className="py-16 bg-white">
      <div className="container">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Everything You Need for IPO Investments
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            From tracking to analysis, we provide comprehensive tools to make your IPO investment journey smooth and profitable
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <div key={index} className="text-center">
              <div className="text-4xl mb-4">{feature.icon}</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                {feature.title}
              </h3>
              <p className="text-gray-600">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}