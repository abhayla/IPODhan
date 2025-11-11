'use client';

import React from 'react';
import { X, Keyboard } from 'lucide-react';
import { KEYBOARD_SHORTCUTS, formatShortcut, getModifierKey } from '@/hooks/use-keyboard-shortcuts';
import type { KeyboardShortcut } from '@/hooks/use-keyboard-shortcuts';

/**
 * KeyboardShortcutsHelp Component - Phase 5: Personalization Engine
 *
 * Modal displaying all available keyboard shortcuts.
 * Triggered by pressing "?" or can be opened programmatically.
 *
 * Features:
 * - Categorized shortcuts (Navigation, Actions, Filters, Help)
 * - Platform-specific modifier keys (⌘ on Mac, Ctrl on Windows)
 * - Keyboard-accessible (Esc to close)
 * - Responsive design
 *
 * Integration:
 * - Phase 5: Works with use-keyboard-shortcuts hook
 *
 * @example
 * const { showHelp, setShowHelp } = useKeyboardShortcuts();
 * <KeyboardShortcutsHelp isOpen={showHelp} onClose={() => setShowHelp(false)} />
 */

export interface KeyboardShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsHelp({ isOpen, onClose }: KeyboardShortcutsHelpProps) {
  if (!isOpen) return null;

  // Group shortcuts by category
  const categories = KEYBOARD_SHORTCUTS.reduce((acc, shortcut) => {
    if (!acc[shortcut.category]) {
      acc[shortcut.category] = [];
    }
    acc[shortcut.category].push(shortcut);
    return acc;
  }, {} as Record<string, KeyboardShortcut[]>);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
      >
        <div
          className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl max-w-2xl w-full pointer-events-auto animate-in zoom-in-95 fade-in duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Keyboard className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2
                  id="keyboard-shortcuts-title"
                  className="text-xl font-serif font-semibold text-foreground"
                >
                  Keyboard Shortcuts
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Power user productivity tools
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close shortcuts help"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 max-h-[60vh] overflow-y-auto">
            <div className="space-y-6">
              {Object.entries(categories).map(([category, shortcuts]) => (
                <div key={category}>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    {category}
                  </h3>
                  <div className="space-y-2">
                    {shortcuts.map((shortcut) => (
                      <div
                        key={shortcut.key}
                        className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                      >
                        <span className="text-sm text-foreground">
                          {shortcut.description}
                        </span>
                        <kbd className="px-3 py-1.5 text-xs font-mono font-semibold text-foreground bg-background border border-border rounded shadow-sm">
                          {formatShortcut(shortcut.key)}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-border bg-muted/30">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Tip: Press <kbd className="px-2 py-1 bg-background border border-border rounded text-foreground">?</kbd> anytime to view this help</span>
              <span>Platform: {getModifierKey() === '⌘' ? 'macOS' : 'Windows/Linux'}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Compact keyboard shortcut badge for inline display
 */
export interface ShortcutBadgeProps {
  keys: string;
  className?: string;
}

export function ShortcutBadge({ keys, className = '' }: ShortcutBadgeProps) {
  return (
    <kbd
      className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-mono font-semibold text-muted-foreground bg-muted border border-border rounded ${className}`}
    >
      {formatShortcut(keys)}
    </kbd>
  );
}

export default KeyboardShortcutsHelp;
