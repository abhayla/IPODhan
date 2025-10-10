'use client';

import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
      <Select value={value} onValueChange={onChange} disabled={isLoading}>
        <SelectTrigger
          className="w-full lg:w-[180px] transition-all duration-200 hover:border-primary hover:bg-muted/50 disabled:opacity-50"
          aria-label="Filter IPOs by sector"
          aria-disabled={isLoading}
          tabIndex={isLoading ? -1 : 0}
          title={error ? 'Sector list could not be loaded. Only "All Sectors" is available.' : undefined}
        >
          <Search className={`mr-2 h-4 w-4 transition-all duration-200 ${isLoading ? 'animate-pulse' : 'group-hover:text-primary'}`} />
          <SelectValue
            placeholder={
              isLoading
                ? 'Loading sectors...'
                : error
                ? 'All Sectors (Limited)'
                : 'All Sectors'
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All Sectors</SelectItem>
          {!error && sectors.map((sector) => (
            <SelectItem key={sector} value={sector}>
              {sector}
            </SelectItem>
          ))}
          {error && sectors.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              Failed to load sectors
            </div>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
