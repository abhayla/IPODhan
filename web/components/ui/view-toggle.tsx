'use client';

import { Grid, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, useSearchParams } from 'next/navigation';

interface ViewToggleProps {
  currentView: 'grid' | 'list';
}

export function ViewToggle({ currentView }: ViewToggleProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleViewChange = (newView: 'grid' | 'list') => {
    if (newView === currentView) return;

    const params = new URLSearchParams(searchParams);
    params.set('view', newView);
    router.push(`/dashboard?${params.toString()}`);
  };

  return (
    <div className="flex gap-2" role="group" aria-label="View toggle">
      <Button
        variant={currentView === 'grid' ? 'default' : 'outline'}
        size="sm"
        onClick={() => handleViewChange('grid')}
        aria-label="Grid view"
        aria-pressed={currentView === 'grid'}
        className="gap-2"
      >
        <Grid className="h-4 w-4" />
        <span className="hidden sm:inline">Grid</span>
      </Button>
      <Button
        variant={currentView === 'list' ? 'default' : 'outline'}
        size="sm"
        onClick={() => handleViewChange('list')}
        aria-label="List view"
        aria-pressed={currentView === 'list'}
        className="gap-2"
      >
        <List className="h-4 w-4" />
        <span className="hidden sm:inline">List</span>
      </Button>
    </div>
  );
}
