/**
 * GlobalKeyboardShortcuts - Phase 5: Personalization Engine
 *
 * Provides global keyboard shortcuts across all pages.
 * This component is mounted in the root layout to ensure
 * shortcuts work everywhere in the application.
 *
 * Uses native browser APIs for maximum compatibility with E2E tests.
 */

'use client';

import { useLayoutEffect } from 'react';

export function GlobalKeyboardShortcuts() {
  useLayoutEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Get the active element
      const activeElement = document.activeElement as HTMLElement;
      const isTyping = activeElement?.tagName === 'INPUT' ||
                       activeElement?.tagName === 'TEXTAREA' ||
                       activeElement?.isContentEditable;

      // Slash key (/) - Focus search (don't prevent if already typing)
      if (event.key === '/' && !isTyping) {
        event.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>(
          'input[type="search"], input[placeholder*="Search" i]'
        );
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // F key - Focus filters (don't prevent if already typing)
      if (event.key === 'f' && !isTyping && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        const filterElement = document.querySelector<HTMLElement>(
          '[data-testid="filter-bar"] select, [data-testid="filter-bar"] button, .filter-bar select, .filter-bar button'
        );
        if (filterElement) {
          filterElement.focus();
        }
        return;
      }

      // Escape key - Blur active element
      if (event.key === 'Escape') {
        if (activeElement) {
          activeElement.blur();
        }
        return;
      }
    };

    // Add event listener to document IMMEDIATELY
    document.addEventListener('keydown', handleKeyDown);

    // Wait for page elements to be ready, then signal readiness
    // This ensures tests don't run before the page is fully hydrated
    const checkReady = () => {
      // Check if the page is fully loaded and hydrated
      if (document.readyState === 'complete') {
        // Wait additional 100ms for React hydration
        setTimeout(() => {
          document.body.setAttribute('data-keyboard-shortcuts-ready', 'true');
        }, 100);
      } else {
        // If not ready, wait for load event
        window.addEventListener('load', () => {
          setTimeout(() => {
            document.body.setAttribute('data-keyboard-shortcuts-ready', 'true');
          }, 100);
        }, { once: true });
      }
    };

    checkReady();

    // Cleanup
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.removeAttribute('data-keyboard-shortcuts-ready');
    };
  }, []);

  // This component doesn't render anything
  return null;
}
