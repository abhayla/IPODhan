/**
 * Affiliate Links Configuration
 *
 * Centralized configuration for broker affiliate links.
 * Links are sourced from environment variables with fallback defaults.
 *
 * @module lib/config/affiliate-links
 */

export interface BrokerConfig {
  id: string;
  name: string;
  link: string;
  logo: string;
  cta: string;
  description: string;
}

export const affiliateConfig = {
  brokers: [
    {
      id: 'zerodha',
      name: 'Zerodha',
      link: process.env.NEXT_PUBLIC_ZERODHA_AFFILIATE_LINK || 'https://signup.zerodha.com/?c=ZMPHZC',
      logo: '/logos/zerodha.svg',
      cta: 'Apply via Zerodha',
      description: 'India\'s largest stock broker with free equity delivery',
    },
    {
      id: 'angelone',
      name: 'Angel One',
      link: process.env.NEXT_PUBLIC_ANGELONE_AFFILIATE_LINK || 'https://tinyurl.com/2d98g2qe',
      logo: '/logos/angelone.svg',
      cta: 'Apply via Angel One',
      description: 'Open a free demat account in minutes',
    },
  ] satisfies BrokerConfig[],

  disclaimer: {
    text: 'IPODhan may earn a commission when you open an account through our affiliate links. This helps us keep the platform free for all users.',
    shortText: 'We may earn a commission on sign-ups through affiliate links.',
  },

  homepage: {
    banner: {
      title: 'Open a Free Demat Account',
      subtitle: 'Start investing in IPOs today with our trusted broker partners',
      dismissible: true,
      cookieKey: 'ipodhan_banner_dismissed',
    },
  },
} as const;

/**
 * Get broker configuration by ID
 */
export function getBrokerById(brokerId: string): BrokerConfig | undefined {
  return affiliateConfig.brokers.find(broker => broker.id === brokerId);
}

/**
 * Get all active brokers
 */
export function getActiveBrokers(): BrokerConfig[] {
  return affiliateConfig.brokers;
}
