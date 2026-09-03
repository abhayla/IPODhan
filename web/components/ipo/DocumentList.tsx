'use client';

import { Document } from '@/lib/db/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, FileText } from 'lucide-react';
import { format } from 'date-fns';

interface DocumentListProps {
  documents: Document[];
}

/**
 * DocumentList component displays list of IPO documents (DRHP, RHP, Prospectus)
 * Shows document name, file size, upload date, and download button
 */
export function DocumentList({ documents }: DocumentListProps) {
  if (!documents || documents.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>IPO Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No documents available yet
          </p>
        </CardContent>
      </Card>
    );
  }

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return 'Unknown size';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  /**
   * W-87: the heading is the document TYPE (what the investor is looking for),
   * not the stored title, which is often an exchange filename.
   */
  const getDocumentTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      DRHP: 'Draft Red Herring Prospectus',
      RHP: 'Red Herring Prospectus',
      PROSPECTUS: 'Prospectus',
      PRICE_BAND_AD: 'Price Band Advertisement',
      RATIOS_BASIS_ISSUE_PRICE: 'Ratios / Basis of Issue Price',
      ANCHOR_ALLOCATION_REPORT: 'Anchor Allocation Report',
      CORRIGENDUM: 'Corrigendum',
      BASIS_OF_ALLOTMENT: 'Basis of Allotment',
      BASIS_OF_ALLOTMENT_AD: 'Basis of Allotment Advertisement',
      ADDENDUM: 'Addendum',
      BIDDING_CENTERS: 'Bidding Centres',
      SAMPLE_APPLICATION_FORMS: 'Sample Application Forms',
      SECURITY_PARAMS_PRE_ANCHOR: 'Security Parameters (Pre-Anchor)',
      SECURITY_PARAMS_POST_ANCHOR: 'Security Parameters (Post-Anchor)',
      ASBA_PROCESSING_CIRCULAR: 'ASBA Processing Circular',
    };
    return labels[type] || type;
  };

  /**
   * W-87: the source is derived from the stored URL's host, so the caption
   * always matches the link the user actually opens. The link itself is never
   * rewritten — these are the exchanges'/SEBI's own URLs.
   */
  const getDocumentSource = (url: string): string | null => {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return null;
    }
    if (host.endsWith('sebi.gov.in')) return 'SEBI';
    if (host.endsWith('bseindia.com')) return 'BSE';
    if (host.endsWith('nseindia.com')) return 'NSE';
    return null;
  };

  // Two documents of the same type need the stored title to tell them apart.
  const typeCounts = documents.reduce<Record<string, number>>((acc, doc) => {
    acc[doc.type] = (acc[doc.type] ?? 0) + 1;
    return acc;
  }, {});

  const getCaption = (doc: Document): string | null => {
    const parts: string[] = [];
    const source = getDocumentSource(doc.url);
    if (source) parts.push(source);
    if ((typeCounts[doc.type] ?? 0) > 1 && doc.title) parts.push(doc.title);
    return parts.length > 0 ? parts.join(' · ') : null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>IPO Documents</CardTitle>
        <p className="text-sm text-muted-foreground">
          Download official IPO documents
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold">
                    {getDocumentTypeLabel(doc.type)}
                  </h4>
                  {getCaption(doc) && (
                    <p className="text-xs text-muted-foreground">
                      {getCaption(doc)}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{formatFileSize(doc.fileSize)}</span>
                    <span>•</span>
                    <span>
                      Uploaded: {format(new Date(doc.uploadedAt), 'dd MMM yyyy')}
                    </span>
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => window.open(doc.url, '_blank')}
              >
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
