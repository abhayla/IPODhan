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
          className="w-full lg:w-[180px]"
          aria-label="Filter by sector"
        >
          <Search className="mr-2 h-4 w-4" />
          <SelectValue
            placeholder={
              isLoading
                ? 'Loading...'
                : error
                ? 'Error loading sectors'
                : 'All Sectors'
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All Sectors</SelectItem>
          {sectors.map((sector) => (
            <SelectItem key={sector} value={sector}>
              {sector}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
