/**
 * Breadcrumbs Component
 *
 * Navigation breadcrumbs showing current page hierarchy
 * Features:
 * - Responsive design (collapsible on mobile)
 * - Next.js Link integration for client-side navigation
 * - Semantic HTML with proper accessibility
 *
 * @example
 * <Breadcrumbs items={[
 *   { label: 'Home', href: '/' },
 *   { label: 'IPOs', href: '/ipos' },
 *   { label: 'Company Name', href: '/ipos/slug' }
 * ]} />
 */

'use client';

import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  href: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

/**
 * Breadcrumbs component for navigation hierarchy
 * Displays: Home > IPOs > Company Name
 */
export function Breadcrumbs({ items, className = '' }: BreadcrumbsProps) {
  if (!items || items.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex items-center text-sm ${className}`}
    >
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const isFirst = index === 0;

          return (
            <li key={item.href} className="flex items-center gap-2">
              {/* Separator (except for first item) */}
              {!isFirst && (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}

              {/* Breadcrumb Link */}
              {isLast ? (
                // Last item (current page) - not a link
                <span
                  className="font-medium text-foreground"
                  aria-current="page"
                >
                  {/* Show home icon for first breadcrumb if it's home */}
                  {isFirst && item.label.toLowerCase() === 'home' && (
                    <Home className="inline h-4 w-4" />
                  )}
                  {/* Hide text on mobile for non-last items */}
                  <span className={isFirst ? 'ml-1' : ''}>
                    {item.label}
                  </span>
                </span>
              ) : (
                // Intermediate items - links
                <Link
                  href={item.href}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {/* Show home icon for first breadcrumb if it's home */}
                  {isFirst && item.label.toLowerCase() === 'home' && (
                    <Home className="inline h-4 w-4" />
                  )}
                  {/* Hide text on mobile for first item (home) */}
                  <span
                    className={
                      isFirst && item.label.toLowerCase() === 'home'
                        ? 'ml-1 hidden sm:inline'
                        : ''
                    }
                  >
                    {item.label}
                  </span>
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
