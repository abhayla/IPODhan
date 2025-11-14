'use client';

import { TimelineBase, TimelineMilestone } from '@/components/ipo/charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Megaphone,
  Calendar,
  CheckCircle,
  Users,
  Banknote,
  FileCheck,
  DollarSign,
  Download
} from 'lucide-react';
import type { IPO } from '@/lib/db/types';

interface IPOTimelineWidgetProps {
  /** IPO data containing dates */
  ipo: Pick<IPO, 'openDate' | 'closeDate' | 'allotmentDate' | 'listingDate' | 'status'>;
  /** Additional IPO details with intermediate dates */
  ipoDetails?: {
    basisOfAllotmentDate: Date | string | null;
    initiationOfRefundsDate: Date | string | null;
    creditOfSharesDate: Date | string | null;
  } | null;
  /** Show in compact mode (smaller, horizontal only) */
  compact?: boolean;
  /** Custom class name */
  className?: string;
}

/**
 * IPOTimelineWidget - Visual timeline of IPO lifecycle stages
 *
 * Shows 8 key milestones in the IPO process:
 * 1. Announced - When IPO was announced
 * 2. Bidding Open - Open date
 * 3. Bidding Close - Close date
 * 4. Basis of Allotment - When allotment is finalized
 * 5. Allotment - Allotment date
 * 6. Initiation of Refunds - When refunds are processed
 * 7. Credit of Shares - When shares are credited to Demat
 * 8. Listing - Listing date
 *
 * Automatically determines milestone status based on IPO status and dates.
 *
 * @example
 * ```tsx
 * <IPOTimelineWidget ipo={ipoData} ipoDetails={detailsData} />
 * ```
 */
export function IPOTimelineWidget({ ipo, ipoDetails, compact = false, className }: IPOTimelineWidgetProps) {
  // Determine current milestone based on IPO status and dates
  const getCurrentMilestone = (): number => {
    const now = new Date();

    // If IPO is listed, all milestones are complete
    if (ipo.status === 'LISTED') return 8;

    // If we have listing date and it's passed
    if (ipo.listingDate && new Date(ipo.listingDate) <= now) return 8;

    // If we have credit of shares date and it's passed
    if (ipoDetails?.creditOfSharesDate && new Date(ipoDetails.creditOfSharesDate) <= now) return 7;

    // If we have initiation of refunds date and it's passed
    if (ipoDetails?.initiationOfRefundsDate && new Date(ipoDetails.initiationOfRefundsDate) <= now) return 6;

    // If we have allotment date and it's passed
    if (ipo.allotmentDate && new Date(ipo.allotmentDate) <= now) return 5;

    // If we have basis of allotment date and it's passed
    if (ipoDetails?.basisOfAllotmentDate && new Date(ipoDetails.basisOfAllotmentDate) <= now) return 4;

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
      icon: <Megaphone className="h-3 w-3" />,
    },
    {
      id: 'open',
      label: 'Bidding Open',
      description: 'Subscription starts',
      date: ipo.openDate ? new Date(ipo.openDate) : null,
      status: currentMilestone >= 2 ? (currentMilestone === 2 ? 'current' : 'completed') : 'upcoming',
      icon: <Calendar className="h-3 w-3" />,
    },
    {
      id: 'close',
      label: 'Bidding Close',
      description: 'Subscription ends',
      date: ipo.closeDate ? new Date(ipo.closeDate) : null,
      status: currentMilestone >= 3 ? (currentMilestone === 3 ? 'current' : 'completed') : 'upcoming',
      icon: <CheckCircle className="h-3 w-3" />,
    },
    {
      id: 'basis-allotment',
      label: 'Basis of Allotment',
      description: 'Allotment finalized',
      date: ipoDetails?.basisOfAllotmentDate ? new Date(ipoDetails.basisOfAllotmentDate) : null,
      status: currentMilestone >= 4 ? (currentMilestone === 4 ? 'current' : 'completed') : 'upcoming',
      icon: <FileCheck className="h-3 w-3" />,
    },
    {
      id: 'allotment',
      label: 'Allotment',
      description: 'Shares allotted',
      date: ipo.allotmentDate ? new Date(ipo.allotmentDate) : null,
      status: currentMilestone >= 5 ? (currentMilestone === 5 ? 'current' : 'completed') : 'upcoming',
      icon: <Users className="h-3 w-3" />,
    },
    {
      id: 'refunds',
      label: 'Initiation of Refunds',
      description: 'Refunds processed',
      date: ipoDetails?.initiationOfRefundsDate ? new Date(ipoDetails.initiationOfRefundsDate) : null,
      status: currentMilestone >= 6 ? (currentMilestone === 6 ? 'current' : 'completed') : 'upcoming',
      icon: <DollarSign className="h-3 w-3" />,
    },
    {
      id: 'credit-shares',
      label: 'Credit of Shares',
      description: 'Shares credited',
      date: ipoDetails?.creditOfSharesDate ? new Date(ipoDetails.creditOfSharesDate) : null,
      status: currentMilestone >= 7 ? (currentMilestone === 7 ? 'current' : 'completed') : 'upcoming',
      icon: <Download className="h-3 w-3" />,
    },
    {
      id: 'listing',
      label: 'Listing',
      description: 'Trading begins',
      date: ipo.listingDate ? new Date(ipo.listingDate) : null,
      status: currentMilestone >= 8 ? 'completed' : (currentMilestone === 7 ? 'upcoming' : 'upcoming'),
      icon: <Banknote className="h-3 w-3" />,
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
          <Calendar className="h-5 w-5 text-blue-600" />
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
