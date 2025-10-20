'use client';

import { useState } from 'react';
import { IPOStatus } from '@/lib/db/types';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ExternalLink, Shield, Building2 } from 'lucide-react';
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

    // Show informative message if registrar URL is not available
    if (!registrarUrl) {
      setError(
        'Registrar information not available. Please check allotment status directly on the NSE/BSE website or contact the registrar.'
      );
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
    <Card className="border-l-4 border-l-indigo-500 transition-all duration-300 hover:shadow-lg">
      <CardHeader className="bg-gradient-to-r from-background to-muted/20">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-xl font-bold tracking-tight">Check Allotment Status</CardTitle>
            <p className="text-sm text-muted-foreground font-medium">
              Check your IPO allotment status on {registrar} website
            </p>
          </div>
          <Button variant="ghost" size="sm" asChild className="transition-all duration-300 hover:scale-105 hover:bg-muted">
            <Link href="/registrars" className="flex items-center gap-1">
              <Building2 className="h-4 w-4" />
              <span className="hidden sm:inline">All Registrars</span>
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-2">
          <label htmlFor="pan" className="text-sm font-semibold uppercase tracking-wide">
            Enter your PAN Number
          </label>
          <Input
            id="pan"
            type="text"
            placeholder="ABCDE1234F"
            value={pan}
            onChange={handlePanChange}
            maxLength={10}
            className="uppercase transition-all duration-300 focus:ring-2 focus:ring-indigo-500"
            aria-label="PAN number input"
          />
          {error && (
            <p className="text-sm text-destructive font-medium animate-in fade-in slide-in-from-top-1 duration-300">{error}</p>
          )}
        </div>

        <Button
          onClick={handleCheckStatus}
          disabled={pan.length !== 10 || !!error}
          className="w-full transition-all duration-300 hover:shadow-md hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800"
        >
          <ExternalLink className="mr-2 h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
          Check Status on {registrar}
        </Button>

        <Alert className="border-indigo-200 bg-indigo-50 dark:bg-indigo-950/20 dark:border-indigo-800">
          <Shield className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          <AlertDescription className="text-sm font-medium text-indigo-900 dark:text-indigo-100">
            Your PAN is not stored. You will be redirected to the official
            registrar website to check your allotment status.
          </AlertDescription>
        </Alert>

        {!registrarUrl && (
          <Alert variant="destructive" className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <AlertDescription className="text-sm font-medium">
              Registrar website URL is not available. Please visit the
              registrar website directly to check allotment status.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
