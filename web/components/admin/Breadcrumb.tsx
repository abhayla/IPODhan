/**
 * Breadcrumb Navigation Component
 *
 * Provides hierarchical navigation for admin pages
 * Part of Phase 2: Navigation & UX Enhancements
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

interface BreadcrumbItem {
  label: string;
  href: string;
  isCurrentPage?: boolean;
}

interface BreadcrumbProps {
  customItems?: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumb({ customItems, className = '' }: BreadcrumbProps) {
  const pathname = usePathname();

  const breadcrumbItems = useMemo(() => {
    if (customItems) {
      return customItems;
    }

    // Auto-generate breadcrumbs from pathname
    const items: BreadcrumbItem[] = [
      { label: 'Admin', href: '/admin' }
    ];

    const segments = pathname.split('/').filter(Boolean);

    // Remove 'admin' from segments since it's already in items
    const relevantSegments = segments.slice(1);

    let currentPath = '/admin';

    relevantSegments.forEach((segment, index) => {
      currentPath += `/${segment}`;

      // Check if this is a UUID or ID
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment);

      let label = segment;

      // Format the label
      if (segment === 'dynamic') {
        label = 'Dynamic Admin';
      } else if (isUUID) {
        label = `Record (${segment.substring(0, 8)}...)`;
      } else if (segment === 'new') {
        label = 'Create New';
      } else if (segment === 'list') {
        label = 'List View';
      } else if (segment === 'objectives') {
        label = 'Objectives';
      } else {
        // Convert snake_case or camelCase to Title Case
        label = segment
          .replace(/([A-Z])/g, ' $1')
          .replace(/_/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase())
          .trim();
      }

      items.push({
        label,
        href: currentPath,
        isCurrentPage: index === relevantSegments.length - 1
      });
    });

    return items;
  }, [pathname, customItems]);

  return (
    <nav className={`flex items-center space-x-2 text-sm ${className}`} aria-label="Breadcrumb">
      {breadcrumbItems.map((item, index) => (
        <div key={item.href} className="flex items-center">
          {index > 0 && (
            <svg
              className="flex-shrink-0 h-5 w-5 text-gray-400 mx-2"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                clipRule="evenodd"
              />
            </svg>
          )}
          {item.isCurrentPage ? (
            <span className="text-gray-700 font-medium" aria-current="page">
              {item.label}
            </span>
          ) : (
            <Link
              href={item.href}
              className="text-gray-500 hover:text-gray-700 transition-colors"
            >
              {item.label}
            </Link>
          )}
        </div>
      ))}
    </nav>
  );
}
