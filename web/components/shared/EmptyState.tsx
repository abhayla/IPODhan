'use client';

import { IconType } from 'react-icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: IconType;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 px-4 text-center',
        'animate-in fade-in slide-in-from-bottom-4 duration-500',
        className
      )}
      data-testid="empty-state"
    >
      {Icon && (
        <div className="mb-6 rounded-full bg-gradient-to-br from-primary/10 to-primary/5 p-8 shadow-lg border-2 border-primary/10 animate-float">
          <Icon className="h-12 w-12 text-primary animate-in zoom-in duration-300 delay-100" />
        </div>
      )}
      <h3 className="text-2xl font-bold mb-3 bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text animate-in slide-in-from-bottom-2 duration-300 delay-200">
        {title}
      </h3>
      {description && (
        <p className="text-muted-foreground mb-8 max-w-md text-lg leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-300 delay-300">
          {description}
        </p>
      )}
      {action && (
        <Button
          onClick={action.onClick}
          variant="outline"
          className="transition-all duration-200 hover:scale-105 hover:border-primary hover:bg-primary/5 animate-in zoom-in duration-300 delay-400"
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
