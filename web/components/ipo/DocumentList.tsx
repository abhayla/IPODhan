'use client';

import { Document } from '@/lib/db/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { HiArrowDownTray, HiDocumentText } from 'react-icons/hi2';
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

  const getDocumentTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      DRHP: 'Draft Red Herring Prospectus',
      RHP: 'Red Herring Prospectus',
      PROSPECTUS: 'Final Prospectus',
      ADDENDUM: 'Addendum',
    };
    return labels[type] || type;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>IPO Documents</CardTitle>
        <p className="text-sm text-muted-foreground">
          HiArrowDownTray official IPO documents
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
                  <HiDocumentText className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold">{doc.title}</h4>
                  <p className="text-sm text-muted-foreground">
                    {getDocumentTypeLabel(doc.type)}
                  </p>
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
                <HiArrowDownTray className="mr-2 h-4 w-4" />
                HiArrowDownTray
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
