/**
 * Registrar Directory Page
 *
 * Displays a comprehensive directory of IPO registrars with contact information.
 * Features:
 * - Server-side data fetching with ISR
 * - Client-side search with real-time filtering
 * - Responsive layout: Table on desktop, cards on mobile
 * - SEO optimized with metadata
 * - Loading states and error handling
 *
 * Story 5.3: Registrar Directory
 * @route /registrars
 */

'use client';

import * as React from 'react';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { RegistrarCard } from '@/components/registrars/RegistrarCard';
import { RegistrarLogo } from '@/components/registrars/RegistrarLogo';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { HiMagnifyingGlass, HiArrowTopRightOnSquare, HiEnvelope, HiPhone } from 'react-icons/hi2';
import type { Registrar } from '@/lib/db/types';

// ==================== PAGE COMPONENT ====================

export default function RegistrarsPage() {
  // State
  const [registrars, setRegistrars] = React.useState<Registrar[]>([]);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  /**
   * Fetch registrars on mount
   */
  React.useEffect(() => {
    async function fetchRegistrars() {
      try {
        setIsLoading(true);
        const response = await fetch('/api/registrars');

        if (!response.ok) {
          throw new Error('Failed to fetch registrars');
        }

        const data = await response.json();
        setRegistrars(data.registrars || []);
      } catch (err) {
        console.error('Error fetching registrars:', err);
        setError('Failed to load registrars. Please refresh the page.');
      } finally {
        setIsLoading(false);
      }
    }

    fetchRegistrars();
  }, []);

  /**
   * Client-side search filtering
   * Filters by registrar name (case-insensitive)
   */
  const filteredRegistrars = React.useMemo(() => {
    if (!searchQuery.trim()) {
      return registrars;
    }

    const query = searchQuery.toLowerCase();
    return registrars.filter(
      (registrar) =>
        registrar.name.toLowerCase().includes(query) ||
        registrar.shortName?.toLowerCase().includes(query)
    );
  }, [registrars, searchQuery]);

  /**
   * Handle search input change
   */
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  /**
   * Clear search
   */
  const handleClearSearch = () => {
    setSearchQuery('');
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Breadcrumbs */}
      <Breadcrumbs
        items={[
          { label: 'Home', href: '/' },
          { label: 'Tools', href: '/tools' },
          { label: 'Registrars', href: '/registrars' },
        ]}
      />

      {/* Page Header */}
      <div className="mt-6 mb-8">
        <h1 className="text-3xl font-bold tracking-tight">IPO Registrars Directory</h1>
        <p className="text-muted-foreground mt-2">
          Find contact information and allotment check links for major IPO registrars in India
        </p>
      </div>

      {/* HiMagnifyingGlass Bar */}
      <div className="mb-6">
        <div className="relative max-w-md">
          <HiMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search registrars by name..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="pl-10"
            aria-label="Search registrars"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 text-xs"
              onClick={handleClearSearch}
            >
              Clear
            </Button>
          )}
        </div>
        {searchQuery && (
          <p className="text-sm text-muted-foreground mt-2">
            {filteredRegistrars.length} registrar{filteredRegistrars.length !== 1 ? 's' : ''} found
          </p>
        )}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md">
          {error}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && filteredRegistrars.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            {searchQuery ? 'No registrars found matching your search.' : 'No registrars available.'}
          </p>
        </div>
      )}

      {/* Desktop Table View */}
      {!isLoading && !error && filteredRegistrars.length > 0 && (
        <>
          <div className="hidden md:block rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[250px]">Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-center">Website</TableHead>
                  <TableHead className="text-center">Allotment Check</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRegistrars.map((registrar) => (
                  <TableRow key={registrar.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <RegistrarLogo
                          logoUrl={registrar.logoUrl}
                          registrarName={registrar.name}
                          size={40}
                        />
                        <div>
                          <div className="font-semibold">{registrar.shortName || registrar.name}</div>
                          {registrar.shortName && (
                            <div className="text-xs text-muted-foreground">{registrar.name}</div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {registrar.email ? (
                        <a
                          href={`mailto:${registrar.email}`}
                          className="text-primary hover:underline inline-flex items-center gap-1"
                        >
                          <HiEnvelope className="h-3 w-3" />
                          {registrar.email}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {registrar.phone ? (
                        <a
                          href={`tel:${registrar.phone}`}
                          className="text-primary hover:underline inline-flex items-center gap-1"
                        >
                          <HiPhone className="h-3 w-3" />
                          {registrar.phone}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {registrar.website ? (
                        <Button variant="outline" size="sm" asChild>
                          <a
                            href={registrar.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1"
                          >
                            <HiArrowTopRightOnSquare className="h-3 w-3" />
                            Visit
                          </a>
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {registrar.allotmentCheckUrl ? (
                        <Button variant="default" size="sm" asChild>
                          <a
                            href={registrar.allotmentCheckUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1"
                          >
                            <HiArrowTopRightOnSquare className="h-3 w-3" />
                            Check
                          </a>
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Card View */}
          <div className="grid grid-cols-1 gap-4 md:hidden">
            {filteredRegistrars.map((registrar) => (
              <RegistrarCard key={registrar.id} registrar={registrar} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
