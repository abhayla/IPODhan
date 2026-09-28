import { Metadata } from 'next';
import { ShieldCheck, TrendingUp, Zap, BarChart } from 'lucide-react';
import { getActiveBrokers } from '@/lib/services/broker-affiliate-service';
import { BrokerGrid, type BrokerCard } from '@/components/affiliate/BrokerGrid';

export const metadata: Metadata = {
  title: 'Partner Brokers - IPODhan',
  description: 'Open a demat account with our partner broker and start your IPO investment journey.',
};

export default async function AffiliatesPage() {
  const dbBrokers = await getActiveBrokers();

  const brokers: BrokerCard[] = dbBrokers.map((broker) => ({
    name: broker.brokerName,
    logo: broker.brokerLogo,
    ctaText: broker.displayText || 'Open Account',
    ctaLink: broker.affiliateUrl,
  }));

  const noBrokersAvailable = brokers.length === 0;

  const benefits = [
    {
      icon: Zap,
      title: 'Quick Account Opening',
      description: 'Complete paperless KYC online',
    },
    {
      icon: ShieldCheck,
      title: 'SEBI Registered',
      description: 'Our partner broker is SEBI registered and regulated',
    },
    {
      icon: TrendingUp,
      title: 'IPO Applications',
      description: 'Apply for IPOs directly through your demat account',
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white dark:from-gray-950 dark:to-gray-900">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-green-50 to-blue-100 dark:from-green-950/20 dark:to-blue-950/20" />
        <div className="relative container mx-auto px-4 py-20">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-5xl font-bold text-gray-900 dark:text-gray-100 mb-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
              Partner Broker
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-400 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
              Open your demat account and start investing in IPOs
            </p>
            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 inline-block animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200">
              <p className="text-blue-800 dark:text-blue-200 text-sm">
                💡 <strong>Tip:</strong> You need a demat account to apply for IPOs.
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

      {/* Broker Grid */}
      <section className="bg-gray-50 dark:bg-gray-900/50 py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-3xl font-bold text-center mb-12 text-gray-900 dark:text-gray-100">
              Open Your Account
            </h2>
            <BrokerGrid brokers={brokers} />
          </div>
        </div>
      </section>

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
                  With online KYC verification, account opening is quick, though the exact time depends on the broker and your document verification.
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
                  Most brokers don't charge for IPO applications; you only pay if you get allotment. Some brokers may charge nominal processing fees -- check with your broker.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <BarChart className="h-12 w-12 text-green-600 dark:text-green-400 mx-auto mb-6" />
          <h2 className="text-3xl font-bold mb-6 text-gray-900 dark:text-gray-100">
            Start Your IPO Investment Journey Today
          </h2>
          <p className="text-gray-700 dark:text-gray-300 mb-8">
            Open a demat account through our partner broker and get started.
            Track IPOs, analyze data, and invest with confidence.
          </p>
          {!noBrokersAvailable && (
            <a
              href={`#broker-${brokers[0].name.toLowerCase().replace(/\s+/g, '-')}`}
              className="inline-block bg-gradient-to-r from-green-600 to-blue-600 text-white text-center px-8 py-3 rounded-lg hover:from-green-700 hover:to-blue-700 transition-all duration-300 font-semibold mb-8"
            >
              Open Account with {brokers[0].name}
            </a>
          )}
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
