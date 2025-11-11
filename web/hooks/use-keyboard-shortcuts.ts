import { useHotkeys } from 'react-hotkeys-hook';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keyboard Shortcuts Hook - Phase 5: Personalization Engine
 *
 * Provides global keyboard shortcuts for power users.
 * All shortcuts are disabled when user is typing in input fields.
 *
 * Keyboard Shortcuts:
 * - / : Focus search
 * - c : Open compare modal
 * - s : Save/bookmark current IPO
 * - f : Focus filters
 * - ? : Show keyboard shortcuts help
 * - Esc : Close modals/clear focus
 * - ↑/↓ : Navigate through IPO list
 * - Enter : Open selected IPO
 *
 * Integration:
 * - Phase 1: Navigate to IPO details
 * - Phase 2: Open comparison view
 * - Phase 5: Power user productivity
 *
 * @example
 * const { showHelp, setShowHelp } = useKeyboardShortcuts({
 *   onSearch: () => searchInputRef.current?.focus(),
 *   onCompare: () => setCompareModalOpen(true),
 *   onSave: (ipoId) => saveIPO(ipoId),
 * });
 */

export interface KeyboardShortcutHandlers {
  /** Handler for search shortcut (/) */
  onSearch?: () => void;

  /** Handler for compare shortcut (c) */
  onCompare?: () => void;

  /** Handler for save shortcut (s) - receives current IPO ID if available */
  onSave?: (ipoId?: string) => void;

  /** Handler for filter shortcut (f) */
  onFilter?: () => void;

  /** Handler for escape key */
  onEscape?: () => void;

  /** Handler for arrow navigation (up/down) */
  onNavigate?: (direction: 'up' | 'down') => void;

  /** Handler for enter key (open selected item) */
  onEnter?: () => void;

  /** Current IPO ID for save shortcut */
  currentIPOId?: string;

  /** Whether shortcuts should be enabled (default: true) */
  enabled?: boolean;
}

export interface KeyboardShortcut {
  key: string;
  description: string;
  category: 'Navigation' | 'Actions' | 'Filters' | 'Help';
}

export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  // Navigation
  { key: '/', description: 'Focus search', category: 'Navigation' },
  { key: '↑ / ↓', description: 'Navigate IPO list', category: 'Navigation' },
  { key: 'Enter', description: 'Open selected IPO', category: 'Navigation' },
  { key: 'Esc', description: 'Close modal / Clear focus', category: 'Navigation' },

  // Actions
  { key: 'c', description: 'Compare IPOs', category: 'Actions' },
  { key: 's', description: 'Save / Bookmark IPO', category: 'Actions' },

  // Filters
  { key: 'f', description: 'Focus filters', category: 'Filters' },

  // Help
  { key: '?', description: 'Show keyboard shortcuts', category: 'Help' },
];

/**
 * Hook to enable global keyboard shortcuts
 */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers = {}) {
  const {
    onSearch,
    onCompare,
    onSave,
    onFilter,
    onEscape,
    onNavigate,
    onEnter,
    currentIPOId,
    enabled = true,
  } = handlers;

  const router = useRouter();
  const [showHelp, setShowHelp] = useState(false);

  // Options for hotkeys to prevent triggering in input fields
  const hotkeyOptions = {
    enabled,
    enableOnFormTags: false, // Don't trigger when typing in inputs
    preventDefault: true,
  };

  // Search shortcut (/)
  useHotkeys(
    '/',
    (e) => {
      e.preventDefault();
      if (onSearch) {
        onSearch();
      } else {
        // Default: focus search input if it exists
        const searchInput = document.querySelector<HTMLInputElement>(
          'input[type="search"], input[placeholder*="Search"]'
        );
        searchInput?.focus();
      }
    },
    hotkeyOptions,
    [onSearch]
  );

  // Compare shortcut (c)
  useHotkeys(
    'c',
    (e) => {
      e.preventDefault();
      if (onCompare) {
        onCompare();
      } else {
        // Default: navigate to compare page
        router.push('/compare');
      }
    },
    hotkeyOptions,
    [onCompare]
  );

  // Save shortcut (s)
  useHotkeys(
    's',
    (e) => {
      e.preventDefault();
      if (onSave) {
        onSave(currentIPOId);
      }
    },
    hotkeyOptions,
    [onSave, currentIPOId]
  );

  // Filter shortcut (f)
  useHotkeys(
    'f',
    (e) => {
      e.preventDefault();
      if (onFilter) {
        onFilter();
      } else {
        // Default: focus first filter element
        const filterElement = document.querySelector<HTMLElement>(
          '[data-testid="filter-bar"] select, [data-testid="filter-bar"] button'
        );
        filterElement?.focus();
      }
    },
    hotkeyOptions,
    [onFilter]
  );

  // Help shortcut (?)
  useHotkeys(
    'shift+/',
    (e) => {
      e.preventDefault();
      setShowHelp((prev) => !prev);
    },
    { ...hotkeyOptions, enableOnFormTags: true }, // Allow in form tags for help
    []
  );

  // Escape shortcut
  useHotkeys(
    'escape',
    (e) => {
      e.preventDefault();
      if (showHelp) {
        setShowHelp(false);
      } else if (onEscape) {
        onEscape();
      } else {
        // Default: blur active element
        (document.activeElement as HTMLElement)?.blur();
      }
    },
    { ...hotkeyOptions, enableOnFormTags: true }, // Allow in form tags
    [showHelp, onEscape]
  );

  // Arrow navigation (up/down)
  useHotkeys(
    'up',
    (e) => {
      e.preventDefault();
      onNavigate?.('up');
    },
    hotkeyOptions,
    [onNavigate]
  );

  useHotkeys(
    'down',
    (e) => {
      e.preventDefault();
      onNavigate?.('down');
    },
    hotkeyOptions,
    [onNavigate]
  );

  // Enter shortcut
  useHotkeys(
    'enter',
    (e) => {
      // Only handle if not in an input field or button
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'BUTTON'
      ) {
        return;
      }

      e.preventDefault();
      onEnter?.();
    },
    { ...hotkeyOptions, enableOnFormTags: false },
    [onEnter]
  );

  // Add keyboard shortcut indicator to body (Cmd/Ctrl + K style)
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Show visual feedback for Cmd/Ctrl key
      if (e.metaKey || e.ctrlKey) {
        document.body.classList.add('keyboard-shortcuts-active');
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) {
        document.body.classList.remove('keyboard-shortcuts-active');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      document.body.classList.remove('keyboard-shortcuts-active');
    };
  }, [enabled]);

  return {
    showHelp,
    setShowHelp,
    shortcuts: KEYBOARD_SHORTCUTS,
  };
}

/**
 * Hook for IPO list navigation with keyboard
 */
export function useIPOListNavigation(ipoIds: string[], onSelect: (ipoId: string) => void) {
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const handlers: KeyboardShortcutHandlers = {
    onNavigate: useCallback(
      (direction: 'up' | 'down') => {
        setSelectedIndex((prev) => {
          if (direction === 'up') {
            return Math.max(-1, prev - 1);
          } else {
            return Math.min(ipoIds.length - 1, prev + 1);
          }
        });
      },
      [ipoIds.length]
    ),

    onEnter: useCallback(() => {
      if (selectedIndex >= 0 && selectedIndex < ipoIds.length) {
        onSelect(ipoIds[selectedIndex]);
      }
    }, [selectedIndex, ipoIds, onSelect]),

    onEscape: useCallback(() => {
      setSelectedIndex(-1);
    }, []),
  };

  useKeyboardShortcuts(handlers);

  return {
    selectedIndex,
    setSelectedIndex,
  };
}

/**
 * Hook for modal keyboard shortcuts
 */
export function useModalKeyboardShortcuts(isOpen: boolean, onClose: () => void) {
  useHotkeys(
    'escape',
    () => {
      if (isOpen) {
        onClose();
      }
    },
    { enabled: isOpen, enableOnFormTags: true },
    [isOpen, onClose]
  );
}

/**
 * Get platform-specific modifier key label
 */
export function getModifierKey(): string {
  if (typeof window === 'undefined') return 'Ctrl';

  const isMac =
    navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
    navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;

  return isMac ? '⌘' : 'Ctrl';
}

/**
 * Format keyboard shortcut for display
 */
export function formatShortcut(key: string): string {
  const modifier = getModifierKey();

  // Special keys
  const specialKeys: Record<string, string> = {
    up: '↑',
    down: '↓',
    left: '←',
    right: '→',
    escape: 'Esc',
    enter: '↵',
    space: 'Space',
    shift: '⇧',
  };

  const parts = key.toLowerCase().split('+');
  const formatted = parts.map((part) => {
    if (part === 'mod' || part === 'ctrl' || part === 'cmd') {
      return modifier;
    }
    return specialKeys[part] || part.toUpperCase();
  });

  return formatted.join(' + ');
}

export default useKeyboardShortcuts;
