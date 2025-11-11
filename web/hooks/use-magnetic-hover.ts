'use client';

import { useRef, useState, useEffect, RefObject } from 'react';

interface Position {
  x: number;
  y: number;
}

interface MagneticHoverOptions {
  /**
   * Maximum distance (in pixels) the element can move toward the cursor
   * @default 8
   */
  magnetStrength?: number;

  /**
   * Transition duration in milliseconds
   * @default 200
   */
  transitionDuration?: number;

  /**
   * Enable/disable magnetic effect
   * @default true
   */
  enabled?: boolean;
}

/**
 * Custom hook for magnetic cursor hover effect
 *
 * Creates a subtle "magnetic" effect where elements move slightly toward
 * the cursor on hover, enhancing the premium feel of the UI.
 *
 * @example
 * ```tsx
 * const { ref, style } = useMagneticHover({ magnetStrength: 12 });
 *
 * return (
 *   <div ref={ref} style={style} className="card">
 *     Content
 *   </div>
 * );
 * ```
 */
export function useMagneticHover<T extends HTMLElement = HTMLDivElement>(
  options: MagneticHoverOptions = {}
): {
  ref: RefObject<T | null>;
  style: React.CSSProperties;
  isHovered: boolean;
} {
  const {
    magnetStrength = 8,
    transitionDuration = 200,
    enabled = true,
  } = options;

  const ref = useRef<T>(null);
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // Calculate distance from cursor to center
      const deltaX = e.clientX - centerX;
      const deltaY = e.clientY - centerY;

      // Apply magnetic strength with subtle easing
      const moveX = (deltaX / rect.width) * magnetStrength;
      const moveY = (deltaY / rect.height) * magnetStrength;

      setPosition({ x: moveX, y: moveY });
    };

    const handleMouseEnter = () => {
      setIsHovered(true);
    };

    const handleMouseLeave = () => {
      setIsHovered(false);
      setPosition({ x: 0, y: 0 });
    };

    element.addEventListener('mouseenter', handleMouseEnter);
    element.addEventListener('mouseleave', handleMouseLeave);
    element.addEventListener('mousemove', handleMouseMove);

    return () => {
      element.removeEventListener('mouseenter', handleMouseEnter);
      element.removeEventListener('mouseleave', handleMouseLeave);
      element.removeEventListener('mousemove', handleMouseMove);
    };
  }, [enabled, magnetStrength]);

  const style: React.CSSProperties = enabled
    ? {
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        transition: `transform ${transitionDuration}ms cubic-bezier(0.23, 1, 0.32, 1)`,
        willChange: 'transform',
      }
    : {};

  return {
    ref,
    style,
    isHovered,
  };
}
