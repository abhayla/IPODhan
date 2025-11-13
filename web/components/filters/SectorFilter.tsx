'use client';

import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';

interface SectorFilterProps {
  value: string;
  onChange: (value: string) => void;
}

interface SectorsResponse {
  sectors: string[];
}

/**
 * Sector filter with searchable dropdown
 * Fetches available sectors from API on mount
 * Native select implementation (replaces Radix UI to fix webpack errors)
 */
export function SectorFilter({ value, onChange }: SectorFilterProps) {
  const [sectors, setSectors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSectors() {
      try {
        setIsLoading(true);
        const response = await fetch('/api/sectors');

        if (!response.ok) {
          throw new Error('Failed to fetch sectors');
        }

        const data: SectorsResponse = await response.json();
        setSectors(data.sectors);
      } catch (err) {
        console.error('Error fetching sectors:', err);
        setError('Failed to load sectors');
      } finally {
        setIsLoading(false);
      }
    }

    fetchSectors();
  }, []);

  return (
    <div className="w-full lg:w-auto">
      <div className="relative">
        <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10 transition-all duration-200 ${isLoading ? 'animate-pulse' : ''}`} />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={isLoading}
          className="w-full lg:w-[180px] h-12 pl-10 pr-10 rounded-md border border-input bg-background text-sm transition-all duration-200 hover:border-primary hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Filter IPOs by sector"
          aria-disabled={isLoading}
          title={error ? 'Sector list could not be loaded. Only "All Sectors" is available.' : undefined}
        >
          <option value="ALL">
            {isLoading ? 'Loading sectors...' : error ? 'All Sectors (Limited)' : 'All Sectors'}
          </option>
          {!error && sectors.map((sector) => (
            <option key={sector} value={sector}>
              {sector}
            </option>
          ))}
        </select>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
    </div>
  );
}
