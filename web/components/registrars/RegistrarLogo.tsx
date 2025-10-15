/**
 * RegistrarLogo Component
 *
 * Displays registrar company logo with automatic optimization, lazy loading,
 * and fallback to placeholder with initials when logo is unavailable.
 *
 * Features:
 * - Next.js Image component for optimization
 * - Lazy loading by default
 * - Error handling with graceful fallback
 * - Placeholder with initials and colored background
 * - Responsive sizing (40px or 80px)
 * - No layout shift (explicit width/height)
 *
 * Story 5.8: Registrar Logos
 */

'use client';

import * as React from 'react';
import Image from 'next/image';
import { getInitials, getColorFromName } from '@/lib/utils/registrar-utils';

// ==================== TYPES ====================

interface RegistrarLogoProps {
  /** URL to registrar logo image (nullable) */
  logoUrl: string | null;
  /** Registrar name for alt text and placeholder initials */
  registrarName: string;
  /** Size variant: 40px (small) or 80px (large) */
  size?: 40 | 80;
  /** Optional className for additional styling */
  className?: string;
}

// ==================== COMPONENT ====================

/**
 * RegistrarLogo Component
 *
 * @param props - Component props
 * @returns Registrar logo or placeholder
 */
export function RegistrarLogo({
  logoUrl,
  registrarName,
  size = 80,
  className = '',
}: RegistrarLogoProps) {
  const [hasError, setHasError] = React.useState(false);

  /**
   * Handle image load error
   * Falls back to placeholder when logo URL is broken
   */
  const handleError = React.useCallback(() => {
    setHasError(true);
  }, []);

  /**
   * Reset error state when logoUrl changes
   */
  React.useEffect(() => {
    setHasError(false);
  }, [logoUrl]);

  // Show placeholder if no logo URL or error occurred
  const showPlaceholder = !logoUrl || hasError;

  // Generate placeholder data
  const initials = getInitials(registrarName);
  const bgColor = getColorFromName(registrarName);

  // Determine font size based on logo size
  const fontSize = size === 40 ? 'text-sm' : 'text-xl';
  const fontWeight = 'font-bold';

  return (
    <div
      className={`relative flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
      aria-label={`${registrarName} logo`}
    >
      {showPlaceholder ? (
        // Placeholder: Initials in colored circle
        <div
          className={`w-full h-full rounded-full flex items-center justify-center ${bgColor} text-white ${fontSize} ${fontWeight} select-none`}
          role="img"
          aria-label={`${registrarName} placeholder`}
        >
          {initials}
        </div>
      ) : (
        // Logo image with Next.js optimization
        <Image
          src={logoUrl}
          alt={`${registrarName} logo`}
          width={size}
          height={size}
          loading="lazy"
          onError={handleError}
          className="w-full h-full object-contain rounded-full border border-border"
          unoptimized={false}
        />
      )}
    </div>
  );
}
