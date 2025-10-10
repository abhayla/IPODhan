import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service - IPODhan',
  description: 'Terms of Service for IPODhan - Read our terms and conditions for using our platform.',
};

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white dark:from-gray-950 dark:to-gray-900">
      <div className="container mx-auto px-4 py-16 max-w-4xl">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-8">
          Terms of Service
        </h1>

        <div className="prose prose-gray dark:prose-invert max-w-none">
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
            Effective Date: January 10, 2025
          </p>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">1. Acceptance of Terms</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              By accessing and using IPODhan ("the Service"), you agree to be bound by these Terms of Service.
              If you do not agree to these terms, please do not use our Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">2. Description of Service</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              IPODhan provides information about Initial Public Offerings (IPOs), including:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 dark:text-gray-300">
              <li>IPO subscription data and analysis</li>
              <li>Financial information and metrics</li>
              <li>Lot size calculators and comparison tools</li>
              <li>Market holiday information</li>
              <li>Registrar details</li>
            </ul>
            <p className="text-gray-700 dark:text-gray-300 mt-4">
              The information provided is for informational purposes only and should not be considered as investment advice.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">3. User Responsibilities</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              When using our Service, you agree to:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 dark:text-gray-300">
              <li>Use the Service in compliance with all applicable laws</li>
              <li>Not misuse or abuse the Service</li>
              <li>Not attempt to gain unauthorized access to any part of the Service</li>
              <li>Not interfere with the proper functioning of the Service</li>
              <li>Make your own investment decisions and seek professional advice when needed</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">4. Intellectual Property</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              All content on IPODhan, including text, graphics, logos, and software, is the property of IPODhan
              or its content suppliers and is protected by intellectual property laws. You may not reproduce,
              distribute, or create derivative works without our written permission.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">5. Disclaimer of Warranties</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS
              OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
              PURPOSE, OR NON-INFRINGEMENT.
            </p>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              We do not guarantee the accuracy, completeness, or timeliness of the information provided on our platform.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">6. Investment Disclaimer</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              <strong>Important:</strong> IPODhan does not provide investment advice. All information is for
              educational and informational purposes only. Always consult with qualified financial advisors
              before making investment decisions. Past performance does not guarantee future results.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">7. Limitation of Liability</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, IPODHAN SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
              SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA,
              OR OTHER INTANGIBLE LOSSES ARISING FROM YOUR USE OF THE SERVICE.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">8. Indemnification</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              You agree to indemnify and hold IPODhan harmless from any claims, losses, liabilities, damages,
              costs, or expenses arising from your use of the Service or violation of these Terms.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">9. Third-Party Links</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              Our Service may contain links to third-party websites. We are not responsible for the content,
              privacy policies, or practices of these third-party sites. Access to these links is at your own risk.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">10. Affiliate Disclosure</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              IPODhan may earn commissions from affiliate partnerships when users open trading accounts through
              our referral links. This helps us maintain the platform as a free service. These partnerships do
              not influence the information we provide.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">11. Modifications to Terms</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              We reserve the right to modify these Terms at any time. Changes will be effective immediately upon
              posting. Your continued use of the Service after changes constitutes acceptance of the modified Terms.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">12. Termination</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              We reserve the right to terminate or suspend access to our Service immediately, without prior notice,
              for any reason, including breach of these Terms.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">13. Governing Law</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              These Terms shall be governed by and construed in accordance with the laws of India, without regard
              to conflict of law principles.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">14. Contact Information</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              For questions about these Terms of Service, please contact us at:
            </p>
            <p className="text-gray-700 dark:text-gray-300">
              Email: legal@ipodhan.com<br/>
              Website: www.ipodhan.com
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}