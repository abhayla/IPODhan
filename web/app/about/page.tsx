import { Metadata } from 'next';
import { Building2, MousePointerClick, Users, ShieldCheck, TrendingUp, Trophy } from 'lucide-react';

export const metadata: Metadata = {
  title: 'About Us - IPODhan',
  description: 'Learn about IPODhan, India\'s trusted platform for IPO information, analysis, and investment insights.',
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white dark:from-gray-950 dark:to-gray-900">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-blue-950/20 dark:to-indigo-950/20" />
        <div className="relative container mx-auto px-4 py-20">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-5xl font-bold text-gray-900 dark:text-gray-100 mb-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
              About IPODhan
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-400 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
              Your trusted companion in the journey of IPO investments
            </p>
            <div className="flex justify-center gap-8 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">500+</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">IPOs Tracked</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">50K+</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Active Users</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">99.9%</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Uptime</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Mission Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="animate-in fade-in slide-in-from-left duration-700">
              <h2 className="text-3xl font-bold mb-6 text-gray-900 dark:text-gray-100">Our Mission</h2>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                At IPODhan, we believe that every investor deserves access to comprehensive,
                accurate, and timely information about Initial Public Offerings. Our mission
                is to democratize IPO investments by providing institutional-grade data and
                analysis tools to retail investors.
              </p>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                We strive to be the most reliable source for IPO information in India, helping
                investors make informed decisions based on facts, not speculation.
              </p>
              <div className="flex gap-4 mt-6">
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <ShieldCheck className="h-5 w-5" />
                  <span className="text-sm">Trusted Data</span>
                </div>
                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                  <TrendingUp className="h-5 w-5" />
                  <span className="text-sm">Real-time Updates</span>
                </div>
              </div>
            </div>
            <div className="bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-2xl p-8 animate-in fade-in slide-in-from-right duration-700">
              <MousePointerClick className="h-12 w-12 text-blue-600 dark:text-blue-400 mb-4" />
              <h3 className="text-xl font-semibold mb-3 text-gray-900 dark:text-gray-100">Our Vision</h3>
              <p className="text-gray-700 dark:text-gray-300">
                To become India's leading platform for IPO investments, empowering millions
                of investors with the tools and knowledge they need to participate confidently
                in the primary market.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* What We Offer */}
      <section className="bg-gray-50 dark:bg-gray-900/50 py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-3xl font-bold text-center mb-12 text-gray-900 dark:text-gray-100">
              What We Offer
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm hover:shadow-lg transition-shadow duration-300">
                <Building2 className="h-10 w-10 text-blue-600 dark:text-blue-400 mb-4" />
                <h3 className="text-xl font-semibold mb-3 text-gray-900 dark:text-gray-100">
                  Comprehensive IPO Data
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Access detailed information about every IPO including financials, subscription
                  status, GMP, and lot size details.
                </p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm hover:shadow-lg transition-shadow duration-300">
                <TrendingUp className="h-10 w-10 text-green-600 dark:text-green-400 mb-4" />
                <h3 className="text-xl font-semibold mb-3 text-gray-900 dark:text-gray-100">
                  Real-time Tracking
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Monitor subscription levels, GMP movements, and allotment status in real-time
                  with our advanced tracking systems.
                </p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm hover:shadow-lg transition-shadow duration-300">
                <Trophy className="h-10 w-10 text-purple-600 dark:text-purple-400 mb-4" />
                <h3 className="text-xl font-semibold mb-3 text-gray-900 dark:text-gray-100">
                  Expert Analysis
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Get insights from our proprietary rating system that analyzes multiple factors
                  to help you make better investment decisions.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12 text-gray-900 dark:text-gray-100">
            Our Core Values
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="bg-blue-100 dark:bg-blue-900/30 rounded-full h-20 w-20 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">01</span>
              </div>
              <h3 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">Transparency</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                We believe in complete transparency in all our data and analysis.
              </p>
            </div>
            <div className="text-center">
              <div className="bg-green-100 dark:bg-green-900/30 rounded-full h-20 w-20 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-green-600 dark:text-green-400">02</span>
              </div>
              <h3 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">Accuracy</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                We maintain the highest standards of data accuracy and reliability.
              </p>
            </div>
            <div className="text-center">
              <div className="bg-purple-100 dark:bg-purple-900/30 rounded-full h-20 w-20 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-purple-600 dark:text-purple-400">03</span>
              </div>
              <h3 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">Innovation</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                We continuously innovate to provide better tools and insights.
              </p>
            </div>
            <div className="text-center">
              <div className="bg-orange-100 dark:bg-orange-900/30 rounded-full h-20 w-20 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-orange-600 dark:text-orange-400">04</span>
              </div>
              <h3 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">User-First</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Every decision we make prioritizes our users' needs and success.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Team Section */}
      <section className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto text-center">
            <Users className="h-12 w-12 text-blue-600 dark:text-blue-400 mx-auto mb-6" />
            <h2 className="text-3xl font-bold mb-6 text-gray-900 dark:text-gray-100">
              Built by Investors, for Investors
            </h2>
            <p className="text-gray-700 dark:text-gray-300 max-w-3xl mx-auto mb-8">
              Our team consists of experienced professionals from finance, technology, and data
              analytics backgrounds. We understand the challenges faced by retail investors because
              we are investors ourselves. This drives our commitment to building the best possible
              platform for IPO investments.
            </p>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-8 shadow-lg max-w-2xl mx-auto">
              <p className="text-gray-600 dark:text-gray-400 italic">
                "We started IPODhan with a simple goal: to level the playing field for retail
                investors in the IPO market. Today, we're proud to serve thousands of investors
                who trust us for their IPO investment decisions."
              </p>
              <p className="mt-4 font-semibold text-gray-900 dark:text-gray-100">
                - The IPODhan Team
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-6 text-gray-900 dark:text-gray-100">
            Join the IPODhan Community
          </h2>
          <p className="text-gray-700 dark:text-gray-300 mb-8">
            Start your IPO investment journey with confidence. Access comprehensive data,
            expert analysis, and powerful tools - all for free.
          </p>
          <div className="flex gap-4 justify-center">
            <a
              href="/dashboard"
              className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition-colors duration-200"
            >
              Explore IPOs
            </a>
            <a
              href="/contact"
              className="bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-8 py-3 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors duration-200"
            >
              Contact Us
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}