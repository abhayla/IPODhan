'use client';

/**
 * Sticky in-page section navigation for the IPO detail page — the Screener.in
 * pattern from the owner-selected redesign north star
 * (docs/13-components/UI-REDESIGN-NORTHSTAR.md). Anchor links over flat
 * stacked sections; replaces the old tab bar whose content double-rendered.
 */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export interface SectionNavItem {
  id: string;
  label: string;
}

interface IPOSectionNavProps {
  items: SectionNavItem[];
}

export function IPOSectionNav({ items }: IPOSectionNavProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      // header + this bar ≈ top 120px; a section is "active" while in the upper half
      { rootMargin: '-120px 0px -55% 0px' }
    );
    items.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Page sections"
      className="sticky top-14 z-30 -mx-4 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <div className="flex gap-1 overflow-x-auto py-2">
        {items.map(({ id, label }) => (
          <a
            key={id}
            href={`#${id}`}
            className={cn(
              // shrink-0 keeps each tab its full width so the row scrolls
              // horizontally instead of the tabs compressing into overlapping,
              // illegible text on mobile (R31 #1 — a real bug).
              'shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              activeId === id
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {label}
          </a>
        ))}
      </div>
    </nav>
  );
}
