import type { IPO } from '../db/types';

/**
 * Base URL for the application
 */
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://ipodhan.com';

/**
 * Breadcrumb item for navigation schema
 */
export interface BreadcrumbItem {
  name: string;
  url: string;
}

/**
 * Organization schema (JSON-LD) for homepage
 * Implements schema.org/Organization
 */
export interface OrganizationSchema {
  '@context': 'https://schema.org';
  '@type': 'Organization';
  name: string;
  url: string;
  logo: string;
  description: string;
  sameAs: string[];
  contactPoint?: {
    '@type': 'ContactPoint';
    contactType: string;
    email: string;
  };
}

/**
 * Financial Product schema (JSON-LD) for IPO detail pages
 * Implements schema.org/FinancialProduct
 */
export interface FinancialProductSchema {
  '@context': 'https://schema.org';
  '@type': 'FinancialProduct';
  name: string;
  description: string;
  category: string;
  provider: {
    '@type': 'Corporation';
    name: string;
  };
  offers?: {
    '@type': 'Offer';
    price: string;
    priceCurrency: 'INR';
    availability: string;
    validFrom?: string;
    validThrough?: string;
  };
}

/**
 * BreadcrumbList schema (JSON-LD) for navigation
 * Implements schema.org/BreadcrumbList
 */
export interface BreadcrumbListSchema {
  '@context': 'https://schema.org';
  '@type': 'BreadcrumbList';
  itemListElement: Array<{
    '@type': 'ListItem';
    position: number;
    name: string;
    item?: string;
  }>;
}

/**
 * ItemList schema (JSON-LD) for listing pages
 * Implements schema.org/ItemList
 */
export interface ItemListSchema {
  '@context': 'https://schema.org';
  '@type': 'ItemList';
  name: string;
  description?: string;
  numberOfItems: number;
  itemListElement: Array<{
    '@type': 'ListItem';
    position: number;
    item: {
      '@type': 'FinancialProduct';
      name: string;
      description?: string;
      url?: string;
      category?: string;
    };
  }>;
}

/**
 * Generate Organization schema for homepage
 */
export function generateOrganizationSchema(): OrganizationSchema {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'IPODhan',
    url: BASE_URL,
    logo: `${BASE_URL}/logo.png`,
    description: 'Real-time IPO tracking and analysis platform for Indian stock markets',
    sameAs: [
      'https://twitter.com/ipodhan',
      'https://facebook.com/ipodhan',
      'https://linkedin.com/company/ipodhan',
    ],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'Customer Support',
      email: 'support@ipodhan.com',
    },
  };
}

/**
 * Generate FinancialProduct schema for IPO detail page
 */
export function generateFinancialProductSchema(ipo: IPO): FinancialProductSchema {
  const schema: FinancialProductSchema = {
    '@context': 'https://schema.org',
    '@type': 'FinancialProduct',
    name: `${ipo.companyName} IPO`,
    description:
      ipo.companyDescription ||
      `Initial Public Offering (IPO) of ${ipo.companyName}`,
    category: 'Initial Public Offering',
    provider: {
      '@type': 'Corporation',
      name: ipo.companyName,
    },
  };

  // Add offer details if price range is available
  if (ipo.priceRangeMin && ipo.priceRangeMax) {
    const priceRange = `₹${ipo.priceRangeMin}-₹${ipo.priceRangeMax}`;

    // Determine availability status based on IPO status
    let availability = 'https://schema.org/PreOrder';
    if (ipo.status === 'OPEN') {
      availability = 'https://schema.org/InStock';
    } else if (ipo.status === 'CLOSED' || ipo.status === 'LISTED') {
      availability = 'https://schema.org/SoldOut';
    }

    schema.offers = {
      '@type': 'Offer',
      price: priceRange,
      priceCurrency: 'INR',
      availability,
    };

    // Add valid dates if available
    if (ipo.openDate) {
      schema.offers.validFrom = new Date(ipo.openDate).toISOString();
    }
    if (ipo.closeDate) {
      schema.offers.validThrough = new Date(ipo.closeDate).toISOString();
    }
  }

  return schema;
}

/**
 * Generate BreadcrumbList schema for navigation
 */
export function generateBreadcrumbSchema(
  items: BreadcrumbItem[],
): BreadcrumbListSchema {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => {
      const listItem: {
        '@type': 'ListItem';
        position: number;
        name: string;
        item?: string;
      } = {
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
      };

      // Add item URL for all except the last breadcrumb (current page)
      if (index < items.length - 1) {
        listItem.item = item.url;
      }

      return listItem;
    }),
  };
}

/**
 * Minimal IPO data required for listing schema
 */
export interface MinimalIPOForSchema {
  companyName: string;
  slug: string;
  category: string;
  companyDescription?: string | null;
}

/**
 * Generate ItemList schema for IPO listings on homepage
 * Accepts minimal IPO data (compatible with HomeIPOTableData)
 */
export function generateIPOListingSchema(ipos: MinimalIPOForSchema[]): ItemListSchema {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Latest IPO Updates',
    description: 'Current and upcoming Initial Public Offerings in Indian stock markets',
    numberOfItems: ipos.length,
    itemListElement: ipos.map((ipo, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'FinancialProduct',
        name: `${ipo.companyName} IPO`,
        description: ipo.companyDescription || `IPO of ${ipo.companyName}`,
        url: `${BASE_URL}/ipos/${ipo.slug}`,
        category: ipo.category,
      },
    })),
  };
}

/**
 * Convert structured data to JSON-LD script tag content
 */
export function toJsonLdScript(
  schema: OrganizationSchema | FinancialProductSchema | BreadcrumbListSchema | ItemListSchema,
): string {
  return JSON.stringify(schema);
}

/**
 * Generate breadcrumb items for IPO detail page
 */
export function generateIPODetailBreadcrumbs(
  companyName: string,
  slug: string,
): BreadcrumbItem[] {
  return [
    { name: 'Home', url: `${BASE_URL}/` },
    { name: 'IPOs', url: `${BASE_URL}/ipos` },
    { name: `${companyName} IPO`, url: `${BASE_URL}/ipos/${slug}` },
  ];
}

/**
 * Generate breadcrumb items for tools pages
 */
export function generateToolsBreadcrumbs(toolName: string, toolPath: string): BreadcrumbItem[] {
  return [
    { name: 'Home', url: `${BASE_URL}/` },
    { name: 'Tools', url: `${BASE_URL}/tools` },
    { name: toolName, url: `${BASE_URL}/tools/${toolPath}` },
  ];
}

/**
 * Generate breadcrumb items for historical IPOs page
 */
export function generateHistoricalIPOsBreadcrumbs(): BreadcrumbItem[] {
  return [
    { name: 'Home', url: `${BASE_URL}/` },
    { name: 'Historical IPOs', url: `${BASE_URL}/history` },
  ];
}

/**
 * Generate breadcrumb items for registrars page
 */
export function generateRegistrarsBreadcrumbs(): BreadcrumbItem[] {
  return [
    { name: 'Home', url: `${BASE_URL}/` },
    { name: 'Registrars', url: `${BASE_URL}/registrars` },
  ];
}

/**
 * Generate breadcrumb items for market holidays page
 */
export function generateMarketHolidaysBreadcrumbs(): BreadcrumbItem[] {
  return [
    { name: 'Home', url: `${BASE_URL}/` },
    { name: 'Market Holidays', url: `${BASE_URL}/market-holidays` },
  ];
}
