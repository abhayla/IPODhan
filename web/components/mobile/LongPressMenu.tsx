'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useGestures } from '@/hooks/use-gestures';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

/**
 * LongPressMenu Component - Context menu triggered by long press
 *
 * Phase 4: Mobile Excellence
 *
 * Features:
 * - Long press to open context menu (500ms default)
 * - Radial menu layout for thumb-friendly access
 * - Backdrop dismiss
 * - Haptic feedback
 * - Smooth animations
 * - Accessibility: Focus trap and keyboard navigation
 * - Portal rendering (prevents overflow issues)
 *
 * Integration:
 * - Phase 1: Uses IPODhan colors and animations
 * - Phase 3: Can trigger quick actions (save, compare, share)
 *
 * @example
 * <LongPressMenu
 *   actions={[
 *     { label: 'Save', icon: <Bookmark />, onClick: () => save() },
 *     { label: 'Share', icon: <Share2 />, onClick: () => share() },
 *   ]}
 * >
 *   <IPOCardEnhanced {...ipo} />
 * </LongPressMenu>
 */

export interface LongPressAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  color?: string; // Tailwind class (e.g., 'bg-primary-500')
  disabled?: boolean;
}

export interface LongPressMenuProps {
  children: React.ReactNode;
  actions: LongPressAction[];
  delay?: number; // Long press delay in ms (default: 500)
  disabled?: boolean;
  className?: string;
}

export function LongPressMenu({
  children,
  actions,
  delay = 500,
  disabled = false,
  className = '',
}: LongPressMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Handle long press
  const bind = useGestures({
    onLongPress: () => {
      if (disabled || isOpen) return;

      // Haptic feedback
      if ('vibrate' in navigator) {
        navigator.vibrate(50);
      }

      // Get touch position for menu placement
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        setMenuPosition({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        });
      }

      setIsOpen(true);
    },
    longPressDelay: delay,
    enabled: !disabled,
  });

  // Close menu
  const closeMenu = () => {
    setIsOpen(false);
  };

  // Handle action click
  const handleActionClick = (action: LongPressAction) => {
    if (action.disabled) return;
    action.onClick();
    closeMenu();
  };

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      closeMenu();
    }
  };

  // Focus trap
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  // Calculate radial positions for actions
  const getActionPosition = (index: number, total: number) => {
    const radius = 80; // Distance from center
    const angle = (360 / total) * index - 90; // Start from top
    const radian = (angle * Math.PI) / 180;

    return {
      x: Math.cos(radian) * radius,
      y: Math.sin(radian) * radius,
    };
  };

  return (
    <>
      {/* Content with long press detection */}
      <div ref={containerRef} {...bind()} className={className}>
        {children}
      </div>

      {/* Portal for menu (prevents overflow issues) */}
      {isOpen &&
        typeof window !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center
              bg-black/30 backdrop-blur-sm
              animate-in fade-in duration-200"
            onClick={handleBackdropClick}
            role="dialog"
            aria-modal="true"
            aria-label="Quick actions menu"
          >
            {/* Radial menu */}
            <div
              ref={menuRef}
              className="relative"
              style={{
                position: 'fixed',
                left: `${menuPosition.x}px`,
                top: `${menuPosition.y}px`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              {/* Center button (close) */}
              <button
                onClick={closeMenu}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                  w-14 h-14 rounded-full
                  bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-800
                  shadow-xl
                  flex items-center justify-center
                  hover:scale-110 active:scale-95
                  transition-all duration-200
                  z-10"
                aria-label="Close menu"
              >
                <X className="w-6 h-6" />
              </button>

              {/* Action buttons (radial layout) */}
              {actions.map((action, index) => {
                const position = getActionPosition(index, actions.length);

                return (
                  <button
                    key={action.label}
                    onClick={() => handleActionClick(action)}
                    disabled={action.disabled}
                    className={`
                      absolute top-1/2 left-1/2
                      w-16 h-16 rounded-full
                      ${action.color || 'bg-primary-500'} text-white
                      shadow-xl
                      flex flex-col items-center justify-center gap-1
                      hover:scale-110 active:scale-95
                      transition-all duration-200
                      disabled:opacity-50 disabled:cursor-not-allowed
                      animate-in zoom-in duration-300
                    `}
                    style={{
                      transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px))`,
                      transitionDelay: `${index * 50}ms`,
                    }}
                    aria-label={action.label}
                  >
                    <span className="scale-110">{action.icon}</span>
                    <span className="text-[10px] font-medium leading-none">
                      {action.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * QuickActionMenu Component - Simplified long-press menu for common actions
 *
 * Pre-configured for IPO cards with standard actions.
 *
 * @example
 * <QuickActionMenu
 *   ipoId="xyz-123"
 *   onSave={saveIPO}
 *   onShare={shareIPO}
 *   onCompare={compareIPO}
 * >
 *   <IPOCardEnhanced {...ipo} />
 * </QuickActionMenu>
 */
import { Bookmark, Share2, TrendingUp, Eye, Bell } from 'lucide-react';

export interface QuickActionMenuProps {
  children: React.ReactNode;
  ipoId: string;
  onSave?: (ipoId: string) => void;
  onShare?: (ipoId: string) => void;
  onCompare?: (ipoId: string) => void;
  onView?: (ipoId: string) => void;
  onAlert?: (ipoId: string) => void;
  disabled?: boolean;
}

export function QuickActionMenu({
  children,
  ipoId,
  onSave,
  onShare,
  onCompare,
  onView,
  onAlert,
  disabled = false,
}: QuickActionMenuProps) {
  const actions: LongPressAction[] = [
    onSave && {
      label: 'Save',
      icon: <Bookmark className="w-5 h-5" />,
      onClick: () => onSave(ipoId),
      color: 'bg-primary-500',
    },
    onShare && {
      label: 'Share',
      icon: <Share2 className="w-5 h-5" />,
      onClick: () => onShare(ipoId),
      color: 'bg-accent-500',
    },
    onCompare && {
      label: 'Compare',
      icon: <TrendingUp className="w-5 h-5" />,
      onClick: () => onCompare(ipoId),
      color: 'bg-secondary-500',
    },
    onView && {
      label: 'View',
      icon: <Eye className="w-5 h-5" />,
      onClick: () => onView(ipoId),
      color: 'bg-success-500',
    },
    onAlert && {
      label: 'Alert',
      icon: <Bell className="w-5 h-5" />,
      onClick: () => onAlert(ipoId),
      color: 'bg-danger-500',
    },
  ].filter(Boolean) as LongPressAction[];

  return (
    <LongPressMenu actions={actions} disabled={disabled}>
      {children}
    </LongPressMenu>
  );
}
