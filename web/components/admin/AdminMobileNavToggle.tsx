'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';

export interface AdminNavItem {
  name: string;
  href: string;
  icon: string;
}

interface AdminMobileNavToggleProps {
  navigation: AdminNavItem[];
  pathname: string;
}

/**
 * Collapsible admin navigation for phone-width screens (§9.2 item 21, OD-115).
 * The desktop nav (`md:flex`) is untouched; this renders only below `md`.
 */
export function AdminMobileNavToggle({ navigation, pathname }: AdminMobileNavToggleProps) {
  const [isOpen, setIsOpen] = useState(false);
  const closeMenu = () => setIsOpen(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={isOpen}
        className="flex items-center justify-center h-11 w-11 rounded-md text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
      >
        {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {isOpen && (
        <div className="border-t border-gray-700 py-2">
          <nav className="flex flex-col">
            {navigation.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                onClick={closeMenu}
                className={`flex items-center space-x-2 px-3 py-3 min-h-[44px] rounded-md text-sm font-medium transition-colors ${
                  pathname === item.href
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.name}</span>
              </Link>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}
