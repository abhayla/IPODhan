/**
 * Peer Companies List Component (Story 4.10)
 *
 * Displays list of peer companies from ipo_financials.peer_companies array.
 * Shows first 10 companies with expandable "See all" option.
 */

'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface PeerCompaniesListProps {
  peerCompanies: string[] | null;
  className?: string;
}

export function PeerCompaniesList({
  peerCompanies,
  className = '',
}: PeerCompaniesListProps) {
  const [showAll, setShowAll] = useState(false);

  // Handle empty/null array
  if (!peerCompanies || peerCompanies.length === 0) {
    return (
      <div className={`rounded-lg border border-dashed p-6 text-center ${className}`}>
        <p className="text-sm text-muted-foreground">
          Peer companies data not yet available
        </p>
      </div>
    );
  }

  // Determine which companies to show
  const displayLimit = 10;
  const hasMore = peerCompanies.length > displayLimit;
  const displayedCompanies = showAll
    ? peerCompanies
    : peerCompanies.slice(0, displayLimit);

  return (
    <div className={className}>
      <h4 className="text-sm font-medium mb-3">Peer Companies</h4>

      {/* Peer badges */}
      <div className="flex flex-wrap gap-2 mb-3">
        {displayedCompanies.map((peer, index) => (
          <Badge
            key={`${peer}-${index}`}
            variant="secondary"
            className="px-3 py-1 text-sm hover:bg-secondary/80 transition-colors"
          >
            {peer}
          </Badge>
        ))}
      </div>

      {/* See all/See less button */}
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAll(!showAll)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {showAll ? (
            <>
              <ChevronUp className="h-3 w-3 mr-1" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3 mr-1" />
              See all {peerCompanies.length} peers
            </>
          )}
        </Button>
      )}

      {/* Metadata */}
      <p className="text-xs text-muted-foreground mt-2">
        {peerCompanies.length} peer {peerCompanies.length === 1 ? 'company' : 'companies'} identified
      </p>
    </div>
  );
}
