'use client';

import { PeerCompany } from '@/lib/db/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

interface PeerComparisonTableProps {
  peers: PeerCompany[];
  currentCompanyName: string;
}

/**
 * PeerComparisonTable component displays peer company comparison
 * Highlights current IPO row and sorts by P/E ratio
 */
export function PeerComparisonTable({
  peers,
  currentCompanyName,
}: PeerComparisonTableProps) {
  if (!peers || peers.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Peer Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No peers found in the same sector
          </p>
        </CardContent>
      </Card>
    );
  }

  // Sort by P/E ratio
  const sortedPeers = [...peers].sort((a, b) => {
    if (a.peRatio === null) return 1;
    if (b.peRatio === null) return -1;
    const aRatio = typeof a.peRatio === 'string' ? parseFloat(a.peRatio) : a.peRatio;
    const bRatio = typeof b.peRatio === 'string' ? parseFloat(b.peRatio) : b.peRatio;
    return aRatio - bRatio;
  });

  const formatNumber = (num: string | number | null) => {
    if (num === null) return 'N/A';
    const numValue = typeof num === 'string' ? parseFloat(num) : num;
    if (isNaN(numValue)) return 'N/A';
    return numValue.toFixed(2);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Peer Comparison</CardTitle>
        <p className="text-sm text-muted-foreground">
          Compare with similar companies in the same sector
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company Name</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead className="text-right">P/E Ratio</TableHead>
                <TableHead className="text-right">EPS</TableHead>
                <TableHead className="text-right">ROE (%)</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedPeers.map((peer) => {
                const isCurrentIPO = peer.companyName === currentCompanyName;
                return (
                  <TableRow
                    key={peer.id}
                    className={
                      isCurrentIPO ? 'bg-primary/10 font-semibold' : ''
                    }
                  >
                    <TableCell>
                      {peer.companyName}
                      {isCurrentIPO && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          Current
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{peer.sector}</TableCell>
                    <TableCell className="text-right">
                      {formatNumber(peer.peRatio)}
                    </TableCell>
                    <TableCell className="text-right">
                      ₹{formatNumber(peer.eps)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatNumber(peer.ronw)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={peer.isListed ? 'default' : 'secondary'}
                      >
                        {peer.isListed ? 'Listed' : 'Unlisted'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
