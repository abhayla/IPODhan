import { Metadata } from 'next';
import { Users, TrendingUp, Shield, Zap, Award, ChartBar, ExternalLink, CheckCircle } from 'lucide-react';
import { getActiveBrokers } from '@/lib/services/broker-affiliate-service';

export const metadata: Metadata = {
  title: 'Partner Brokers - IPODhan',
  description: 'Open demat accounts with our trusted partner brokers and start your IPO investment journey.',
};

export default async function AffiliatesPage() {
  // Fetch broker affiliates from database (Story 5.7)
  const dbBrokers = await getActiveBrokers();

  // Map database brokers to UI format
  const brokers = dbBrokers.map((broker) => ({
    name: broker.brokerName,
    logo: broker.brokerLogo || '/images/brokers/default.png',
    rating: 4.5, // Placeholder - will be dynamic in future
    users: '1 Cr+', // Placeholder - will be dynamic in future
    features: [
      'Zero brokerage on equity delivery',
      'Advanced trading platforms',
      'IPO application through UPI',
      'Free account opening',
    ],
    accountOpening: 'Free',
    amcCharges: '₹300/year',
    highlight: broker.displayOrder === 1 ? 'Most Popular' : undefined,
    ctaText: broker.displayText || 'Open Account',
    ctaLink: broker.affiliateUrl,
  }));

  // Fallback message if no brokers available
  const noBrokersAvailable = brokers.length === 0;

  const benefits = [
    {
      icon: Zap,
      title: 'Quick Account Opening',
      description: 'Complete paperless KYC in under 10 minutes',
    },
    {
      icon: Shield,
      title: 'SEBI Registered',
      description: 'All partner brokers are SEBI registered and regulated',
    },
    {
      icon: TrendingUp,
      title: 'IPO Applications',
      description: 'Apply for IPOs directly through your demat account',
    },
    {
      icon: Award,
      title: 'Special Offers',
      description: 'Exclusive benefits for IPODhan users',
    },
  ];

  const comparisonFeatures = [
    'Account Opening Charges',
    'Annual Maintenance',
    'Equity Delivery',
    'Equity Intraday',
    'F&O Trading',
    'IPO Application',
    'Research Reports',
    'Mobile App',
    'Customer Support',
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white dark:from-gray-950 dark:to-gray-900">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-green-50 to-blue-100 dark:from-green-950/20 dark:to-blue-950/20" />
        <div className="relative container mx-auto px-4 py-20">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-5xl font-bold text-gray-900 dark:text-gray-100 mb-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
              Partner Brokers
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-400 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
              Open your demat account with India's leading brokers and start investing in IPOs
            </p>
            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 inline-block animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200">
              <p className="text-blue-800 dark:text-blue-200 text-sm">
                💡 <strong>Tip:</strong> You need a demat account to apply for IPOs. Choose from our trusted partners below.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12 text-gray-900 dark:text-gray-100">
            Why Open Account Through IPODhan?
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {benefits.map((benefit, index) => (
              <div key={index} className="text-center">
                <div className="bg-green-100 dark:bg-green-900/30 rounded-full h-16 w-16 flex items-center justify-center mx-auto mb-4">
                  <benefit.icon className="h-8 w-8 text-green-600 dark:text-green-400" />
                </div>
                <h3 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">{benefit.title}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">{benefit.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Brokers Grid */}
      <section className="bg-gray-50 dark:bg-gray-900/50 py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-3xl font-bold text-center mb-12 text-gray-900 dark:text-gray-100">
              Choose Your Broker
            </h2>

            {/* No Brokers Fallback */}
            {noBrokersAvailable && (
              <div className="text-center py-12">
                <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-8 inline-block">
                  <p className="text-yellow-800 dark:text-yellow-200 text-lg">
                    <strong>Broker information temporarily unavailable.</strong>
                  </p>
                  <p className="text-yellow-700 dark:text-yellow-300 mt-2">
                    Please check back later or contact support for assistance.
                  </p>
                </div>
              </div>
            )}

            {/* Brokers Grid */}
            {!noBrokersAvailable && (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {brokers.map((broker, index) => (
                  <div
                    key={index}
                    className="bg-white dark:bg-gray-800 rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden group"
                  >
                    {broker.highlight && (
                      <div className="bg-gradient-to-r from-green-500 to-blue-500 text-white text-xs text-center py-2 font-semibold">
                        {broker.highlight}
                      </div>
                    )}
                    <div className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                            {broker.name}
                          </h3>
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-yellow-500">★ {broker.rating}</span>
                            <span className="text-gray-500 dark:text-gray-400">• {broker.users} users</span>
                          </div>
                        </div>
                        <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                          <Users className="h-8 w-8 text-gray-400" />
                        </div>
                      </div>

                      <div className="space-y-2 mb-4">
                        {broker.features.map((feature, idx) => (
                          <div key={idx} className="flex items-start gap-2 text-sm">
                            <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                            <span className="text-gray-600 dark:text-gray-400">{feature}</span>
                          </div>
                        ))}
                      </div>

                      <div className="border-t dark:border-gray-700 pt-4 mb-4">
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-gray-600 dark:text-gray-400">Account Opening</span>
                          <span className="font-semibold text-gray-900 dark:text-gray-100">
                            {broker.accountOpening}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600 dark:text-gray-400">AMC Charges</span>
                          <span className="font-semibold text-gray-900 dark:text-gray-100">
                            {broker.amcCharges}
                          </span>
                        </div>
                      </div>

                      <a
                        href={broker.ctaLink}
                        className="block w-full bg-gradient-to-r from-green-600 to-blue-600 text-white text-center py-3 rounded-lg hover:from-green-700 hover:to-blue-700 transition-all duration-300 font-semibold group-hover:scale-105"
                      >
                        {broker.ctaText}
                        <ExternalLink className="inline-block ml-2 h-4 w-4" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      {!noBrokersAvailable && brokers.length >= 4 && (
        <section className="container mx-auto px-4 py-16">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-3xl font-bold text-center mb-12 text-gray-900 dark:text-gray-100">
              Quick Comparison
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full bg-white dark:bg-gray-800 rounded-xl shadow-sm">
                <thead>
                  <tr className="border-b dark:border-gray-700">
                    <th className="text-left p-4 font-semibold text-gray-900 dark:text-gray-100">Features</th>
                    {brokers.slice(0, 4).map((broker) => (
                      <th key={broker.name} className="text-center p-4 font-semibold text-gray-900 dark:text-gray-100">
                        {broker.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparisonFeatures.map((feature, index) => (
                    <tr key={index} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="p-4 text-gray-700 dark:text-gray-300">{feature}</td>
                      <td className="p-4 text-center">
                        <CheckCircle className="h-5 w-5 text-green-500 mx-auto" />
                      </td>
                      <td className="p-4 text-center">
                        <CheckCircle className="h-5 w-5 text-green-500 mx-auto" />
                      </td>
                      <td className="p-4 text-center">
                        <CheckCircle className="h-5 w-5 text-green-500 mx-auto" />
                      </td>
                      <td className="p-4 text-center">
                        <CheckCircle className="h-5 w-5 text-green-500 mx-auto" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* FAQ Section */}
      <section className="bg-gradient-to-br from-blue-50 to-green-50 dark:from-blue-950/20 dark:to-green-950/20 py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold text-center mb-12 text-gray-900 dark:text-gray-100">
              Frequently Asked Questions
            </h2>
            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-6">
                <h3 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">
                  Do I need a demat account to apply for IPOs?
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Yes, a demat account is mandatory for applying to IPOs in India. It holds your shares in electronic format.
                </p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-6">
                <h3 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">
                  How long does it take to open a demat account?
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  With online KYC verification, most brokers can open your account within 10-30 minutes. The account becomes active within 24-48 hours.
                </p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-6">
                <h3 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">
                  Can I have multiple demat accounts?
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Yes, you can have multiple demat accounts with different brokers. However, you can only apply once per IPO using one PAN card.
                </p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-6">
                <h3 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">
                  Are there any charges for IPO applications?
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  No, brokers typically don't charge for IPO applications. You only pay if you get allotment. Some brokers may charge nominal processing fees.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <ChartBar className="h-12 w-12 text-green-600 dark:text-green-400 mx-auto mb-6" />
          <h2 className="text-3xl font-bold mb-6 text-gray-900 dark:text-gray-100">
            Start Your IPO Investment Journey Today
          </h2>
          <p className="text-gray-700 dark:text-gray-300 mb-8">
            Choose from India's top brokers and get exclusive benefits when you open an account through IPODhan.
            Track IPOs, analyze data, and invest with confidence.
          </p>
          <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6 inline-block">
            <p className="text-yellow-800 dark:text-yellow-200">
              <strong>Note:</strong> IPODhan may earn a commission when you open an account through our links.
              This helps us maintain and improve our platform while keeping it free for all users.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
