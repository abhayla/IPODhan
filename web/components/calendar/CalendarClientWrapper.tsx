/**
 * Calendar Client Wrapper Component
 * Story 15.4: Provides client-side state management for expand/collapse functionality
 *
 * This wrapper adds interactivity to the server-rendered calendar grid
 * without pulling server dependencies into the client bundle.
 */

'use client';

import { useState, ReactNode } from 'react';

interface CalendarClientWrapperProps {
  children: (expandedGroups: Set<string>, onToggleGroup: (key: string) => void) => ReactNode;
}

export default function CalendarClientWrapper({ children }: CalendarClientWrapperProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const handleToggleGroup = (groupKey: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  return <>{children(expandedGroups, handleToggleGroup)}</>;
}
