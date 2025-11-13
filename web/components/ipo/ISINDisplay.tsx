'use client';

import { Clipboard, Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ISINDisplayProps {
  isin: string | null | undefined;
  className?: string;
}

/**
 * ISIN Display Component
 *
 * Displays the ISIN (International Securities Identification Number)
 * with copy-to-clipboard functionality and tooltip explanation.
 *
 * @param isin - ISIN code (12 characters, e.g., "INE002A01018")
 * @param className - Additional CSS classes
 */
export function ISINDisplay({ isin, className }: ISINDisplayProps) {
  const [copied, setCopied] = useState(false);

  // Handle null/undefined ISIN (very new IPOs may not have ISIN yet)
  if (!isin) {
    return (
      <div className={cn('text-sm text-muted-foreground', className)}>
        <span className="font-medium">ISIN:</span> Not assigned
      </div>
    );
  }

  const copyToClipboard = async () => {
    try {
      // Modern clipboard API
      await navigator.clipboard.writeText(isin);
      setCopied(true);
      toast.success('ISIN copied to clipboard');

      // Reset copied state after 2 seconds
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = isin;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.select();

      try {
        document.execCommand('copy');
        setCopied(true);
        toast.success('ISIN copied to clipboard');
        setTimeout(() => setCopied(false), 2000);
      } catch (fallbackError) {
        toast.error('Failed to copy ISIN');
      }

      document.body.removeChild(textArea);
    }
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">ISIN:</span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="font-mono text-sm cursor-help">
                {isin}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-sm">
                ISIN (International Securities Identification Number) is a
                unique 12-character code identifying this security globally.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={copyToClipboard}
        aria-label="Copy ISIN to clipboard"
      >
        {copied ? (
          <Check className="h-4 w-4 text-green-600" />
        ) : (
          <Clipboard className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
