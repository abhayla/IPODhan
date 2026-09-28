import { ExternalLink } from 'lucide-react';
import { ZerodhaApDisclosure } from '@/components/compliance/ZerodhaApDisclosure';

export interface BrokerCard {
  name: string;
  logo: string | null;
  ctaText: string;
  ctaLink: string;
}

interface BrokerGridProps {
  brokers: BrokerCard[];
}

/**
 * Renders the broker cards on the /affiliates page. Pure and synchronous so
 * it can be unit-tested without the async server component around it.
 *
 * Deliberately shows only what is real: broker name, its logo (if one
 * exists), and the CTA link. No rating, user count, features list or
 * pricing claims -- IPODhan has never sourced those and #97 found them
 * invented (4.5 stars, "1 Cr+" users, fixed AMC, "Zero brokerage").
 */
export function BrokerGrid({ brokers }: BrokerGridProps) {
  const noBrokersAvailable = brokers.length === 0;

  return (
    <>
      {noBrokersAvailable && (
        <div className="text-center py-12">
          <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-8 inline-block">
            <p className="text-yellow-800 dark:text-yellow-200 text-lg">
              <strong>Broker details are being updated.</strong>
            </p>
            <p className="text-yellow-700 dark:text-yellow-300 mt-2">
              Please check back later or contact support for assistance.
            </p>
          </div>
        </div>
      )}

      {!noBrokersAvailable && (
        <>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="broker-grid">
            {brokers.map((broker) => (
              <div
                key={broker.name}
                id={`broker-${broker.name.toLowerCase().replace(/\s+/g, '-')}`}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden group"
                data-testid="broker-card"
              >
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                      {broker.name}
                    </h3>
                    {broker.logo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={broker.logo}
                        alt={`${broker.name} logo`}
                        className="h-10 w-auto object-contain"
                      />
                    )}
                  </div>

                  <a
                    href={broker.ctaLink}
                    target="_blank"
                    rel="noopener noreferrer sponsored"
                    className="block w-full bg-gradient-to-r from-green-600 to-blue-600 text-white text-center py-3 rounded-lg hover:from-green-700 hover:to-blue-700 transition-all duration-300 font-semibold group-hover:scale-105"
                  >
                    {broker.ctaText}
                    <ExternalLink className="inline-block ml-2 h-4 w-4" />
                  </a>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10">
            <ZerodhaApDisclosure />
          </div>
        </>
      )}
    </>
  );
}
