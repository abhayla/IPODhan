/**
 * AffiliateCTA Component
 *
 * Homepage banner promoting broker affiliate links.
 * Features:
 * - Dismissible banner with cookie persistence
 * - Multiple broker buttons
 * - Mobile-responsive layout
 * - Smooth animation
 *
 * @component
 */

'use client';

import { useState, useEffect } from 'react';
import { HiXMark } from 'react-icons/hi2';
import { Button } from '@/components/ui/button';
import { BrokerButton } from './BrokerButton';
import { affiliateConfig } from '@/lib/config/affiliate-links';

export function AffiliateCTA() {
  // Initialize state by checking cookie immediately (client-side only now)
  const [isVisible, setIsVisible] = useState(() => {
    // This runs only on client since component is dynamically imported with ssr: false
    if (typeof window === 'undefined') return true;

    const isDismissed = document.cookie.includes(
      `${affiliateConfig.homepage.banner.cookieKey}=true`
    );
    return !isDismissed;
  });

  const handleDismiss = () => {
    // Set cookie to persist dismissal for 30 days
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);
    document.cookie = `${affiliateConfig.homepage.banner.cookieKey}=true; expires=${expiryDate.toUTCString()}; path=/`;

    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="relative bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          {/* Content */}
          <div className="flex-1">
            <h3 className="text-lg font-semibold sm:text-xl">
              {affiliateConfig.homepage.banner.title}
            </h3>
            <p className="mt-1 text-sm text-blue-100 sm:text-base">
              {affiliateConfig.homepage.banner.subtitle}
            </p>
          </div>

          {/* Broker Buttons */}
          <div className="flex flex-col gap-2 sm:flex-row">
            {affiliateConfig.brokers.map((broker) => (
              <BrokerButton
                key={broker.id}
                broker={broker}
                source="homepage"
                variant="outline"
                className="border-white bg-white/10 text-white hover:bg-white/20"
              />
            ))}
          </div>

          {/* Dismiss Button */}
          {affiliateConfig.homepage.banner.dismissible && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDismiss}
              className="absolute right-2 top-2 text-white hover:bg-white/20 md:relative md:right-auto md:top-auto"
              aria-label="Dismiss banner"
            >
              <HiXMark className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
