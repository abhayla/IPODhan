'use client';

import { TimelineBase, TimelineMilestone } from '@/components/ipo/charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  HiOutlineMegaphone,
  HiOutlineCalendarDays,
  HiOutlineCheckCircle,
  HiOutlineUsers,
  HiOutlineBanknotes
} from 'react-icons/hi2';
import type { IPO } from '@/lib/db/types';

interface IPOTimelineWidgetProps {
  /** IPO data containing dates */
  ipo: Pick<IPO, 'openDate' | 'closeDate' | 'allotmentDate' | 'listingDate' | 'status'>;
  /** Show in compact mode (smaller, horizontal only) */
  compact?: boolean;
  /** Custom class name */
  className?: string;
}

/**
 * IPOTimelineWidget - Visual timeline of IPO lifecycle stages
 *
 * Shows 5 key milestones in the IPO process:
 * 1. Announced - When IPO was announced
 * 2. Bidding Open - Open date
 * 3. Bidding Close - Close date
 * 4. Allotment - Allotment date
 * 5. Listing - Listing date
 *
 * Automatically determines milestone status based on IPO status and dates.
 *
 * @example
 * ```tsx
 * <IPOTimelineWidget ipo={ipoData} />
 * ```
 */
export function IPOTimelineWidget({ ipo, compact = false, className }: IPOTimelineWidgetProps) {
  // Determine current milestone based on IPO status and dates
  const getCurrentMilestone = (): number => {
    const now = new Date();

    // If IPO is listed, all milestones are complete
    if (ipo.status === 'LISTED') return 5;

    // If we have listing date and it's passed
    if (ipo.listingDate && new Date(ipo.listingDate) <= now) return 5;

    // If we have allotment date and it's passed
    if (ipo.allotmentDate && new Date(ipo.allotmentDate) <= now) return 4;

    // If we have close date and it's passed (status would be CLOSED)
    if (ipo.closeDate && new Date(ipo.closeDate) <= now) return 3;

    // If we have open date and it's passed (status would be OPEN)
    if (ipo.openDate && new Date(ipo.openDate) <= now) return 2;

    // Otherwise, we're in announced/upcoming stage
    return 1;
  };

  const currentMilestone = getCurrentMilestone();

  // Build timeline milestones
  const milestones: TimelineMilestone[] = [
    {
      id: 'announced',
      label: 'Announced',
      description: 'IPO announced',
      date: null, // Usually we don't have announcement date
      status: currentMilestone >= 1 ? 'completed' : 'upcoming',
      icon: <HiOutlineMegaphone className="h-3 w-3" />,
    },
    {
      id: 'open',
      label: 'Bidding Open',
      description: 'Subscription starts',
      date: ipo.openDate ? new Date(ipo.openDate) : null,
      status: currentMilestone >= 2 ? (currentMilestone === 2 ? 'current' : 'completed') : 'upcoming',
      icon: <HiOutlineCalendarDays className="h-3 w-3" />,
    },
    {
      id: 'close',
      label: 'Bidding Close',
      description: 'Subscription ends',
      date: ipo.closeDate ? new Date(ipo.closeDate) : null,
      status: currentMilestone >= 3 ? (currentMilestone === 3 ? 'current' : 'completed') : 'upcoming',
      icon: <HiOutlineCheckCircle className="h-3 w-3" />,
    },
    {
      id: 'allotment',
      label: 'Allotment',
      description: 'Shares allotted',
      date: ipo.allotmentDate ? new Date(ipo.allotmentDate) : null,
      status: currentMilestone >= 4 ? (currentMilestone === 4 ? 'current' : 'completed') : 'upcoming',
      icon: <HiOutlineUsers className="h-3 w-3" />,
    },
    {
      id: 'listing',
      label: 'Listing',
      description: 'Trading begins',
      date: ipo.listingDate ? new Date(ipo.listingDate) : null,
      status: currentMilestone >= 5 ? 'completed' : (currentMilestone === 4 ? 'upcoming' : 'upcoming'),
      icon: <HiOutlineBanknotes className="h-3 w-3" />,
    },
  ];

  if (compact) {
    // Compact mode - minimal card
    return (
      <Card className={className}>
        <CardContent className="pt-6">
          <TimelineBase
            milestones={milestones}
            orientation="horizontal"
            showConnectors
            dateFormat="dd MMM"
            showDescriptions={false}
            dotSize="small"
            spacing="1rem"
          />
        </CardContent>
      </Card>
    );
  }

  // Full mode - with header
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HiOutlineCalendarDays className="h-5 w-5 text-blue-600" />
          IPO Timeline
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Track the IPO lifecycle from announcement to listing
        </p>
      </CardHeader>
      <CardContent>
        <TimelineBase
          milestones={milestones}
          orientation="horizontal"
          showConnectors
          dateFormat="dd MMM"
          showDescriptions
          dotSize="medium"
        />
      </CardContent>
    </Card>
  );
}
