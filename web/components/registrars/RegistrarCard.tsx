import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ExternalLink, Mail, Phone, MapPin } from 'lucide-react';
import type { Registrar } from '@/lib/db/types';

interface RegistrarCardProps {
  registrar: Registrar;
}

/**
 * RegistrarCard component
 *
 * Displays registrar information in a card format for mobile devices.
 * Shows contact details, website, and allotment check URL.
 * Story 5.3: Registrar Directory
 */
export function RegistrarCard({ registrar }: RegistrarCardProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-lg">{registrar.shortName || registrar.name}</CardTitle>
        {registrar.shortName && (
          <p className="text-sm text-muted-foreground">{registrar.name}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Contact Information */}
        <div className="space-y-2">
          {registrar.email && (
            <div className="flex items-start gap-2">
              <Mail className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
              <a
                href={`mailto:${registrar.email}`}
                className="text-sm text-primary hover:underline break-all"
              >
                {registrar.email}
              </a>
            </div>
          )}

          {registrar.phone && (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <a
                href={`tel:${registrar.phone}`}
                className="text-sm text-primary hover:underline"
              >
                {registrar.phone}
              </a>
            </div>
          )}

          {registrar.address && (
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
              <p className="text-sm text-muted-foreground">{registrar.address}</p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2 pt-2">
          {registrar.allotmentCheckUrl && (
            <Button
              variant="default"
              size="sm"
              className="w-full"
              asChild
            >
              <a
                href={registrar.allotmentCheckUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                Check Allotment Status
              </a>
            </Button>
          )}

          {registrar.website && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              asChild
            >
              <a
                href={registrar.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                Visit Website
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
