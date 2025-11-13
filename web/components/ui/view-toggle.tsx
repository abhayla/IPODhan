'use client';

import { LayoutGrid, List } from 'lucide-react';
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
    <div className="flex gap-1 p-1 bg-muted/50 rounded-lg border border-border/50 backdrop-blur-sm" role="group" aria-label="View toggle">
      <Button
        variant={currentView === 'grid' ? 'default' : 'ghost'}
        size="sm"
        onClick={() => handleViewChange('grid')}
        aria-label="Grid view"
        aria-pressed={currentView === 'grid'}
        className={`gap-2 transition-all duration-200 ${
          currentView === 'grid'
            ? 'scale-105 shadow-md'
            : 'hover:bg-background hover:scale-105'
        }`}
      >
        <LayoutGrid className={`h-4 w-4 transition-transform duration-200 ${
          currentView === 'grid' ? 'rotate-0' : 'group-hover:rotate-12'
        }`} />
        <span className="hidden sm:inline">Grid</span>
      </Button>
      <Button
        variant={currentView === 'list' ? 'default' : 'ghost'}
        size="sm"
        onClick={() => handleViewChange('list')}
        aria-label="List view"
        aria-pressed={currentView === 'list'}
        className={`gap-2 transition-all duration-200 ${
          currentView === 'list'
            ? 'scale-105 shadow-md'
            : 'hover:bg-background hover:scale-105'
        }`}
      >
        <List className={`h-4 w-4 transition-transform duration-200 ${
          currentView === 'list' ? 'rotate-0' : 'group-hover:rotate-12'
        }`} />
        <span className="hidden sm:inline">List</span>
      </Button>
    </div>
  );
}
