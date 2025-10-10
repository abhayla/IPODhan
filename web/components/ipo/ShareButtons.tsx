'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Share2, Copy, Check } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { generateShareUrl, createShareText } from '@/lib/utils/url-utils';
import { trackShare } from '@/lib/analytics/gtag';

interface KeyMetrics {
  subscription?: number | null;
  gmp?: number | null;
  issueSize?: number | null;
}

interface ShareButtonsProps {
  companyName: string;
  rating: number | null;
  url?: string;
  keyMetrics?: KeyMetrics;
}

/**
 * ShareButtons component provides social sharing functionality
 * Includes WhatsApp, Twitter, and Copy Link buttons
 * Uses native Web Share API on mobile when available
 * Tracks share events with Google Analytics
 */
export function ShareButtons({ companyName, rating, url, keyMetrics }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Get current URL if not provided (without UTM params initially)
  const baseUrl = url || (typeof window !== 'undefined' ? window.location.href.split('?')[0] : '');

  // Create share text with key metrics
  const shareText = createShareText(
    companyName,
    rating,
    keyMetrics?.subscription,
    keyMetrics?.gmp,
    keyMetrics?.issueSize
  );

  const handleWhatsAppShare = () => {
    const shareUrl = generateShareUrl(baseUrl, 'whatsapp');
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`;
    window.open(whatsappUrl, '_blank');

    // Track share event
    trackShare('whatsapp', companyName);
  };

  const handleTwitterShare = () => {
    const shareUrl = generateShareUrl(baseUrl, 'twitter');
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(twitterUrl, '_blank');

    // Track share event
    trackShare('twitter', companyName);
  };

  const handleCopyLink = async () => {
    try {
      const shareUrl = generateShareUrl(baseUrl, 'copy');
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast({
        title: 'Link copied!',
        description: 'IPO link has been copied to clipboard',
      });
      setTimeout(() => setCopied(false), 2000);

      // Track share event
      trackShare('copy', companyName);
    } catch {
      toast({
        title: 'Failed to copy',
        description: 'Could not copy link to clipboard',
        variant: 'destructive',
      });
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        const shareUrl = generateShareUrl(baseUrl, 'native');
        await navigator.share({
          title: `${companyName} IPO`,
          text: shareText,
          url: shareUrl,
        });

        // Track share event
        trackShare('native', companyName);
      } catch (error) {
        // User cancelled share or error occurred
        console.error('Share failed:', error);
      }
    }
  };

  // Check if native Web Share API is available (mobile)
  // Only check after component is mounted to avoid hydration mismatch
  const hasNativeShare = mounted && typeof navigator !== 'undefined' && navigator.share;

  return (
    <div className="flex flex-wrap gap-2">
      {hasNativeShare ? (
        <Button
          variant="outline"
          size="sm"
          onClick={handleNativeShare}
          className="flex-1 sm:flex-none transition-all duration-300 hover:shadow-md hover:scale-105 hover:border-primary/50"
        >
          <Share2 className="mr-2 h-4 w-4 transition-transform duration-300 group-hover:rotate-12" />
          Share
        </Button>
      ) : (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={handleWhatsAppShare}
            className="group flex-1 sm:flex-none transition-all duration-300 hover:shadow-md hover:scale-105 hover:border-green-500/50 hover:bg-green-50 dark:hover:bg-green-950/20"
          >
            <svg
              className="mr-2 h-4 w-4 transition-transform duration-300 group-hover:scale-110"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
            </svg>
            WhatsApp
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTwitterShare}
            className="group flex-1 sm:flex-none transition-all duration-300 hover:shadow-md hover:scale-105 hover:border-blue-500/50 hover:bg-blue-50 dark:hover:bg-blue-950/20"
          >
            <svg
              className="mr-2 h-4 w-4 transition-transform duration-300 group-hover:scale-110"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Twitter
          </Button>
        </>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={handleCopyLink}
        className={`flex-1 sm:flex-none transition-all duration-300 hover:shadow-md hover:scale-105 ${
          copied
            ? 'border-green-500 bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400'
            : 'hover:border-primary/50'
        }`}
      >
        {copied ? (
          <>
            <Check className="mr-2 h-4 w-4 animate-in zoom-in duration-300" />
            Copied
          </>
        ) : (
          <>
            <Copy className="mr-2 h-4 w-4 transition-transform duration-300 group-hover:scale-110" />
            Copy Link
          </>
        )}
      </Button>
    </div>
  );
}
