'use client';

import { useState } from 'react';
import { IPOStatus } from '@/lib/db/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ExternalLink, Shield } from 'lucide-react';
import { trackAllotmentCheck } from '@/lib/analytics/gtag';

interface AllotmentCheckerCardProps {
  status: IPOStatus;
  registrar: string;
  registrarUrl?: string | null;
  companyName?: string;
}

/**
 * AllotmentCheckerCard component for checking IPO allotment status
 * Only visible for CLOSED or LISTED IPOs
 * Validates PAN format and redirects to registrar website
 */
export function AllotmentCheckerCard({
  status,
  registrar,
  registrarUrl,
  companyName,
}: AllotmentCheckerCardProps) {
  const [pan, setPan] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Only show for CLOSED or LISTED status
  if (status !== 'CLOSED' && status !== 'LISTED') {
    return null;
  }

  // PAN validation regex: AAAAA9999A (5 letters, 4 numbers, 1 letter)
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

  const validatePan = (value: string) => {
    const upperValue = value.toUpperCase();
    if (upperValue.length === 0) {
      setError(null);
      return true;
    }
    if (upperValue.length !== 10) {
      setError('PAN must be 10 characters');
      return false;
    }
    if (!panRegex.test(upperValue)) {
      setError('Invalid PAN format (e.g., ABCDE1234F)');
      return false;
    }
    setError(null);
    return true;
  };

  const handlePanChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase();
    setPan(value);
    if (value.length === 10) {
      validatePan(value);
    } else {
      setError(null);
    }
  };

  const handleCheckStatus = () => {
    if (!validatePan(pan)) {
      return;
    }

    if (!registrarUrl) {
      setError('Registrar website URL not available');
      return;
    }

    // Track analytics event
    if (companyName) {
      trackAllotmentCheck(companyName, registrar);
    }

    // Redirect to registrar website with PAN as query parameter
    const url = new URL(registrarUrl);
    url.searchParams.set('pan', pan);
    window.open(url.toString(), '_blank');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Check Allotment Status</CardTitle>
        <p className="text-sm text-muted-foreground">
          Check your IPO allotment status on {registrar} website
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="pan" className="text-sm font-medium">
            Enter your PAN Number
          </label>
          <Input
            id="pan"
            type="text"
            placeholder="ABCDE1234F"
            value={pan}
            onChange={handlePanChange}
            maxLength={10}
            className="uppercase"
            aria-label="PAN number input"
          />
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <Button
          onClick={handleCheckStatus}
          disabled={pan.length !== 10 || !!error || !registrarUrl}
          className="w-full"
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          Check Status on {registrar}
        </Button>

        <Alert>
          <Shield className="h-4 w-4" />
          <AlertDescription className="text-sm">
            Your PAN is not stored. You will be redirected to the official
            registrar website to check your allotment status.
          </AlertDescription>
        </Alert>

        {!registrarUrl && (
          <Alert variant="destructive">
            <AlertDescription className="text-sm">
              Registrar website URL is not available. Please visit the
              registrar website directly to check allotment status.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
