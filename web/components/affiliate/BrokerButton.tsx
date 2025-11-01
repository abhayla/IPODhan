/**
 * BrokerButton Component
 *
 * Displays a clickable button for broker affiliate links with tracking.
 * Features:
 * - Broker logo and name display
 * - External link with proper rel attributes
 * - Click tracking via API
 * - Google Analytics event tracking
 * - Mobile-responsive design
 *
 * @component
 */

'use client';

import Image from 'next/image';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { HiArrowTopRightOnSquare } from 'react-icons/hi2';
import type { BrokerConfig } from '@/lib/config/affiliate-links';

interface BrokerButtonProps {
  broker: BrokerConfig;
  source: 'ipo_detail' | 'homepage';
  ipoId?: string;
  className?: string;
  variant?: 'default' | 'outline';
  size?: 'default' | 'sm' | 'lg';
}

export function BrokerButton({
  broker,
  source,
  ipoId,
  className,
  variant = 'default',
  size = 'default',
}: BrokerButtonProps) {
  const [isTracking, setIsTracking] = useState(false);

  const handleClick = async () => {
    if (isTracking) return;

    setIsTracking(true);

    try {
      // Track click in database
      await fetch('/api/affiliate/track', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          broker: broker.id,
          source,
          ipoId: ipoId || null,
        }),
      });

      // Track with Google Analytics (if available)
      if (typeof window !== 'undefined' && (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag) {
        ((window as unknown as { gtag: (...args: unknown[]) => void }).gtag)('event', 'affiliate_click', {
          broker: broker.name,
          source,
          ipo_id: ipoId || 'none',
        });
      }
    } catch (error) {
      console.error('Failed to track affiliate click:', error);
      // Don't block navigation on tracking failure
    } finally {
      setIsTracking(false);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      asChild
      onClick={handleClick}
    >
      <a
        href={broker.link}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2"
      >
        <Image
          src={broker.logo}
          alt={`${broker.name} logo`}
          width={24}
          height={24}
          className="object-contain"
          style={{ height: '24px', width: '24px' }}
        />
        <span>{broker.cta}</span>
        <HiArrowTopRightOnSquare className="h-4 w-4" />
      </a>
    </Button>
  );
}
