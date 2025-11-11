'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, List, PlusCircle, Bell, Settings } from 'lucide-react';

/**
 * BottomNav Component - Mobile Bottom Navigation
 *
 * Phase 4: Mobile Excellence
 *
 * Features:
 * - 5 tabs: Home, List, Quick Action, Alerts, Settings
 * - Active state indication
 * - 44px minimum touch targets (iOS guideline)
 * - Fixed positioning at bottom
 * - Safe area support for notched devices
 * - Smooth transitions
 * - Accessibility: ARIA labels and roles
 *
 * Integration:
 * - Phase 1: Uses IPODhan Gold Standard colors
 * - Phase 3: Alerts tab shows live notification count
 *
 * @example
 * <BottomNav />
 */

interface NavItem {
  label: string;
  icon: React.ReactNode;
  href: string;
  badge?: number;
  ariaLabel: string;
}

export function BottomNav() {
  const pathname = usePathname();

  const navItems: NavItem[] = [
    {
      label: 'Home',
      icon: <Home className="w-6 h-6" />,
      href: '/',
      ariaLabel: 'Navigate to home page',
    },
    {
      label: 'IPOs',
      icon: <List className="w-6 h-6" />,
      href: '/ipos',
      ariaLabel: 'View all IPOs',
    },
    {
      label: 'Quick',
      icon: <PlusCircle className="w-6 h-6" />,
      href: '/quick-actions',
      ariaLabel: 'Open quick actions menu',
    },
    {
      label: 'Alerts',
      icon: <Bell className="w-6 h-6" />,
      href: '/alerts',
      badge: 0, // TODO: Connect to live notification count from Phase 3
      ariaLabel: 'View alerts and notifications',
    },
    {
      label: 'Settings',
      icon: <Settings className="w-6 h-6" />,
      href: '/settings',
      ariaLabel: 'Open settings',
    },
  ];

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/';
    }
    return pathname.startsWith(href);
  };

  return (
    <nav
      role="navigation"
      aria-label="Mobile bottom navigation"
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden"
    >
      {/* Background with blur effect */}
      <div className="absolute inset-0 bg-white/80 backdrop-blur-lg border-t border-gray-200 dark:bg-gray-900/80 dark:border-gray-800" />

      {/* Navigation items */}
      <div className="relative grid grid-cols-5 h-16 safe-area-bottom">
        {navItems.map((item) => {
          const active = isActive(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.ariaLabel}
              aria-current={active ? 'page' : undefined}
              className={`
                relative flex flex-col items-center justify-center gap-1
                min-h-[44px] px-2 py-2
                transition-all duration-200 ease-out
                focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-inset
                active:scale-95
                ${
                  active
                    ? 'text-primary-600 dark:text-primary-400'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                }
              `}
            >
              {/* Icon container */}
              <div className="relative">
                {/* Icon */}
                <div
                  className={`
                    transition-transform duration-200
                    ${active ? 'scale-110' : 'scale-100'}
                  `}
                >
                  {item.icon}
                </div>

                {/* Badge (if present and count > 0) */}
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className="absolute -top-1 -right-1 flex items-center justify-center
                      min-w-[18px] h-[18px] px-1
                      text-[10px] font-bold text-white
                      bg-danger-500 rounded-full
                      animate-pulse"
                    aria-label={`${item.badge} new notifications`}
                  >
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}
              </div>

              {/* Label */}
              <span
                className={`
                  text-[10px] font-medium leading-none
                  transition-all duration-200
                  ${active ? 'opacity-100 font-semibold' : 'opacity-70'}
                `}
              >
                {item.label}
              </span>

              {/* Active indicator */}
              {active && (
                <div
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-0.5
                    bg-gradient-to-r from-primary-500 to-secondary-500 rounded-b-full"
                  aria-hidden="true"
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * BottomNavSpacer Component - Adds bottom padding to prevent content overlap
 *
 * Use this component at the bottom of page content to ensure it's not
 * hidden behind the fixed bottom navigation.
 *
 * @example
 * <main>
 *   <div>Your content here</div>
 *   <BottomNavSpacer />
 * </main>
 */
export function BottomNavSpacer() {
  return <div className="h-16 md:hidden" aria-hidden="true" />;
}

/**
 * Safe Area CSS Classes
 *
 * Add to globals.css:
 *
 * .safe-area-bottom {
 *   padding-bottom: env(safe-area-inset-bottom);
 * }
 *
 * This ensures proper spacing on devices with notches (iPhone X+)
 */
