'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as Icons from 'lucide-react';

type IconName = keyof typeof Icons;

interface DropdownItem {
  href: string;
  label: string;
  description: string;
  iconName: IconName;
}

interface DesktopDropdownProps {
  label: string;
  items: DropdownItem[];
  basePath?: string;
}

export function DesktopDropdown({ label, items, basePath }: DesktopDropdownProps) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  const isActive = (path: string) => {
    return pathname === path || (basePath && pathname.startsWith(basePath));
  };

  // Handle ESC key to close dropdown
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleEscape);
      return () => window.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsOpen(!isOpen);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="group relative">
      <button
        className={`relative flex items-center space-x-1 text-sm font-medium ${
          isActive(basePath || '')
            ? 'text-foreground after:absolute after:bottom-[-4px] after:left-0 after:h-0.5 after:w-full after:bg-primary'
            : 'text-muted-foreground'
        } hover:text-foreground transition-colors`}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <span>{label}</span>
        <svg
          className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Dropdown Menu */}
      <div
        className={`absolute right-0 top-full mt-2 w-64 rounded-xl border bg-popover p-2 text-popover-foreground shadow-2xl transition-all duration-200 ${
          isOpen ? 'visible opacity-100 translate-y-0' : 'invisible opacity-0 -translate-y-2'
        }`}
        onMouseLeave={() => setIsOpen(false)}
      >
        {items.map((item) => {
          const IconComponent = Icons[item.iconName] as React.ComponentType<{ className?: string }>;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group/item flex items-center space-x-3 rounded-lg px-4 py-3 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
              onClick={() => setIsOpen(false)}
            >
              <div className="flex-shrink-0">
                <IconComponent className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold">{item.label}</p>
                <p className="text-xs text-muted-foreground">
                  {item.description}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
