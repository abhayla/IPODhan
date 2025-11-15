/**
 * Calendar Cell Wrapper with Client-Side State
 * Story 15.4: Wraps calendar cells to provide expand/collapse state management
 */

'use client';

import { useState } from 'react';
import type { CalendarDateEvents } from '@/lib/services/mainboard-calendar-types';

interface CalendarCellWithStateProps {
  dates: CalendarDateEvents[];
  monthName: string;
  currentDate: string;
  renderCell: (
    dateEvents: CalendarDateEvents,
    currentDate: string,
    expandedGroups: Set<string>,
    onToggleGroup: (key: string) => void
  ) => React.ReactNode;
  renderMobileList: (
    dates: CalendarDateEvents[],
    monthName: string,
    currentDate: string,
    expandedGroups: Set<string>,
    onToggleGroup: (key: string) => void
  ) => React.ReactNode;
}

export default function CalendarCellWithState({
  dates,
  monthName,
  currentDate,
  renderCell,
  renderMobileList,
}: CalendarCellWithStateProps) {
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

  return (
    <>
      {renderCell && dates.map((dateEvents) =>
        renderCell(dateEvents, currentDate, expandedGroups, handleToggleGroup)
      )}
      {renderMobileList && renderMobileList(dates, monthName, currentDate, expandedGroups, handleToggleGroup)}
    </>
  );
}
