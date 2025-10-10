import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Disclaimer - IPODhan',
  description: 'Disclaimer for IPODhan - Important information about the use of our platform and services.',
};

export default function DisclaimerPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white dark:from-gray-950 dark:to-gray-900">
      <div className="container mx-auto px-4 py-16 max-w-4xl">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-8">
          Disclaimer
        </h1>

        <div className="prose prose-gray dark:prose-invert max-w-none">
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
            Last updated: January 10, 2025
          </p>

          <div className="bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-500 p-4 mb-8">
            <p className="text-amber-900 dark:text-amber-100 font-semibold">
              IMPORTANT: Please read this disclaimer carefully before using IPODhan.
            </p>
          </div>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">1. No Investment Advice</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              <strong>IPODhan does not provide investment advice.</strong> The information, data, and tools provided
              on this platform are for informational and educational purposes only. They should not be construed as:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 dark:text-gray-300">
              <li>Investment advice or recommendations</li>
              <li>Solicitation to buy or sell securities</li>
              <li>Personal financial advice</li>
              <li>Professional investment guidance</li>
            </ul>
            <p className="text-gray-700 dark:text-gray-300 mt-4">
              Always consult with qualified financial advisors, brokers, or investment professionals before making
              any investment decisions.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">2. Accuracy of Information</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              While we strive to provide accurate and up-to-date information, we make no representations or warranties
              about the accuracy, completeness, reliability, or timeliness of any information on IPODhan. The information
              may contain:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 dark:text-gray-300">
              <li>Technical inaccuracies or typographical errors</li>
              <li>Outdated or incomplete data</li>
              <li>Delays in data updates</li>
              <li>Third-party data that we cannot verify</li>
            </ul>
            <p className="text-gray-700 dark:text-gray-300 mt-4">
              Users should independently verify all information before making investment decisions.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">3. Investment Risks</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              <strong>Investing in IPOs involves significant risks, including but not limited to:</strong>
            </p>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 dark:text-gray-300">
              <li>Complete loss of invested capital</li>
              <li>Market volatility and price fluctuations</li>
              <li>Liquidity risks</li>
              <li>Company-specific risks</li>
              <li>Regulatory and compliance risks</li>
              <li>Economic and market conditions</li>
            </ul>
            <p className="text-gray-700 dark:text-gray-300 mt-4">
              Past performance is not indicative of future results. IPO investments may not be suitable for all investors.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">4. No Liability</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              IPODhan, its owners, operators, employees, partners, and affiliates shall not be liable for any:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 dark:text-gray-300">
              <li>Investment losses or damages</li>
              <li>Decisions made based on our information</li>
              <li>Errors or omissions in the data</li>
              <li>Service interruptions or technical issues</li>
              <li>Third-party content or links</li>
              <li>Direct, indirect, incidental, or consequential damages</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">5. Third-Party Information</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              IPODhan aggregates information from various sources including:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 dark:text-gray-300">
              <li>Stock exchanges (NSE, BSE)</li>
              <li>Company filings and prospectuses</li>
              <li>Registrars and transfer agents</li>
              <li>News sources and financial publications</li>
            </ul>
            <p className="text-gray-700 dark:text-gray-300 mt-4">
              We do not control or guarantee the accuracy of third-party information and are not responsible for any
              errors or omissions in such content.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">6. Affiliate Relationships</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              IPODhan participates in affiliate programs and may earn commissions from:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 dark:text-gray-300">
              <li>Brokerage account openings through our links</li>
              <li>Trading platforms and services</li>
              <li>Financial products and services</li>
            </ul>
            <p className="text-gray-700 dark:text-gray-300 mt-4">
              These relationships may create a conflict of interest. However, we strive to maintain objectivity in
              the information we provide. Users should conduct their own research before choosing any service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">7. Regulatory Compliance</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              IPODhan is not:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 dark:text-gray-300">
              <li>A registered investment advisor</li>
              <li>A broker-dealer</li>
              <li>A financial institution</li>
              <li>Regulated by SEBI, RBI, or any financial regulatory authority</li>
            </ul>
            <p className="text-gray-700 dark:text-gray-300 mt-4">
              Users are responsible for complying with all applicable laws and regulations in their jurisdiction.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">8. User Responsibility</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              By using IPODhan, you acknowledge and agree that:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 dark:text-gray-300">
              <li>You are solely responsible for your investment decisions</li>
              <li>You will seek professional advice when needed</li>
              <li>You understand the risks involved in IPO investments</li>
              <li>You will not hold IPODhan liable for any losses</li>
              <li>You will verify all information independently</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">9. Changes to Disclaimer</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              We reserve the right to modify this disclaimer at any time without prior notice. Changes will be
              effective immediately upon posting. Continued use of the platform constitutes acceptance of the
              modified disclaimer.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">10. Contact Information</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              If you have any questions about this disclaimer, please contact us at:
            </p>
            <p className="text-gray-700 dark:text-gray-300">
              Email: info@ipodhan.com<br/>
              Website: www.ipodhan.com
            </p>
          </section>

          <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500 p-4 mt-8">
            <p className="text-blue-900 dark:text-blue-100">
              <strong>Remember:</strong> Always do your own research (DYOR) and consult with qualified professionals
              before making any investment decisions. IPODhan is a tool for information, not a substitute for
              professional financial advice.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}