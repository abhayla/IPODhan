'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useGestures } from '@/hooks/use-gestures';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

/**
 * ZoomableChart Component - Pinch-to-zoom wrapper for D3.js charts
 *
 * Phase 4: Mobile Excellence - Phase 2 Integration
 *
 * Features:
 * - Pinch-to-zoom gesture support
 * - Pan support after zooming
 * - Double-tap to zoom in/out
 * - Zoom controls (desktop + accessibility)
 * - Reset zoom button
 * - Smooth transitions
 * - Constrained zoom levels (0.5x - 3x)
 * - Prevents browser zoom interference
 *
 * Integration:
 * - Phase 2: Wraps D3.js visualizations (ScoreBreakdown, SectorHeatMap, etc.)
 * - Phase 1: Uses smooth 60fps animations
 *
 * @example
 * <ZoomableChart minZoom={0.8} maxZoom={4}>
 *   <SectorHeatMapDynamic data={data} />
 * </ZoomableChart>
 */

export interface ZoomableChartProps {
  children: React.ReactNode;
  minZoom?: number; // Minimum zoom level (default: 0.5)
  maxZoom?: number; // Maximum zoom level (default: 3)
  initialZoom?: number; // Initial zoom (default: 1)
  enablePan?: boolean; // Enable panning after zoom (default: true)
  className?: string;
}

export function ZoomableChart({
  children,
  minZoom = 0.5,
  maxZoom = 3,
  initialZoom = 1,
  enablePan = true,
  className = '',
}: ZoomableChartProps) {
  const [scale, setScale] = useState(initialZoom);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isZooming, setIsZooming] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastTapRef = useRef<number>(0);

  // Constrain zoom level
  const constrainZoom = (newScale: number) => {
    return Math.max(minZoom, Math.min(maxZoom, newScale));
  };

  // Constrain position (prevent over-panning)
  const constrainPosition = (newPosition: { x: number; y: number }, currentScale: number) => {
    if (!containerRef.current) return newPosition;

    const container = containerRef.current.getBoundingClientRect();
    const maxX = (container.width * (currentScale - 1)) / 2;
    const maxY = (container.height * (currentScale - 1)) / 2;

    return {
      x: Math.max(-maxX, Math.min(maxX, newPosition.x)),
      y: Math.max(-maxY, Math.min(maxY, newPosition.y)),
    };
  };

  // Handle pinch gesture
  const bind = useGestures({
    onPinch: ({ scale: newScale, delta }) => {
      setIsZooming(true);
      const constrainedScale = constrainZoom(newScale);
      setScale(constrainedScale);

      // Reset position when zooming out to 1x
      if (constrainedScale <= 1) {
        setPosition({ x: 0, y: 0 });
      }
    },
    onPinchEnd: () => {
      setTimeout(() => setIsZooming(false), 200);
    },
    pinchThreshold: 0.05,
  });

  // Handle double-tap to zoom
  const handleDoubleTap = (e: React.TouchEvent) => {
    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current;

    if (timeSinceLastTap < 300 && timeSinceLastTap > 0) {
      // Double tap detected
      e.preventDefault();

      if (scale > 1) {
        // Zoom out to normal
        setScale(1);
        setPosition({ x: 0, y: 0 });
      } else {
        // Zoom in
        setScale(2);
      }
    }

    lastTapRef.current = now;
  };

  // Manual zoom controls
  const zoomIn = () => {
    setScale((prev) => constrainZoom(prev + 0.2));
  };

  const zoomOut = () => {
    const newScale = constrainZoom(scale - 0.2);
    setScale(newScale);
    if (newScale <= 1) {
      setPosition({ x: 0, y: 0 });
    }
  };

  const resetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  // Prevent browser zoom on pinch (iOS)
  useEffect(() => {
    const preventDefault = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('touchmove', preventDefault, { passive: false });
      return () => container.removeEventListener('touchmove', preventDefault);
    }
  }, []);

  return (
    <div className={`relative ${className}`}>
      {/* Zoom controls (desktop + accessibility) */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
        <button
          onClick={zoomIn}
          disabled={scale >= maxZoom}
          className="flex items-center justify-center w-12 h-12
            bg-white dark:bg-gray-800 rounded-lg shadow-lg
            hover:bg-gray-50 dark:hover:bg-gray-700
            transition-all duration-200 hover:scale-110
            disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Zoom in"
        >
          <ZoomIn className="w-5 h-5" />
        </button>

        <button
          onClick={zoomOut}
          disabled={scale <= minZoom}
          className="flex items-center justify-center w-12 h-12
            bg-white dark:bg-gray-800 rounded-lg shadow-lg
            hover:bg-gray-50 dark:hover:bg-gray-700
            transition-all duration-200 hover:scale-110
            disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Zoom out"
        >
          <ZoomOut className="w-5 h-5" />
        </button>

        {scale !== 1 && (
          <button
            onClick={resetZoom}
            className="flex items-center justify-center w-12 h-12
              bg-white dark:bg-gray-800 rounded-lg shadow-lg
              hover:bg-gray-50 dark:hover:bg-gray-700
              transition-all duration-200 hover:scale-110"
            aria-label="Reset zoom"
          >
            <Maximize2 className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Zoom level indicator */}
      {scale !== 1 && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10
            px-3 py-1 bg-black/70 text-white text-sm rounded-full"
          aria-live="polite"
        >
          {Math.round(scale * 100)}%
        </div>
      )}

      {/* Zoomable container */}
      <div
        ref={containerRef}
        {...bind()}
        onTouchStart={handleDoubleTap}
        className="overflow-hidden touch-none select-none"
        style={{
          cursor: scale > 1 && enablePan ? 'grab' : 'default',
        }}
      >
        {/* Chart content */}
        <div
          className="origin-center"
          style={{
            transform: `scale(${scale}) translate(${position.x}px, ${position.y}px)`,
            transition: isZooming ? 'none' : 'transform 0.2s ease-out',
            willChange: 'transform',
          }}
        >
          {children}
        </div>
      </div>

      {/* Touch instructions (first time - could use localStorage) */}
      {scale === 1 && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2
            px-4 py-2 bg-black/50 text-white text-xs rounded-lg
            opacity-50 pointer-events-none
            md:hidden"
          aria-hidden="true"
        >
          Pinch to zoom • Double tap to zoom in
        </div>
      )}
    </div>
  );
}

/**
 * ZoomableD3Chart Component - Pre-configured for Phase 2 D3.js charts
 *
 * Optimized settings for D3.js visualizations with better defaults.
 *
 * @example
 * <ZoomableD3Chart>
 *   <ScoreBreakdownDynamic data={scoreData} />
 * </ZoomableD3Chart>
 */
export interface ZoomableD3ChartProps {
  children: React.ReactNode;
  chartType?: 'radar' | 'heatmap' | 'scatter' | 'gauge' | 'timeline';
  className?: string;
}

export function ZoomableD3Chart({
  children,
  chartType = 'radar',
  className = '',
}: ZoomableD3ChartProps) {
  // Chart-specific zoom settings
  const zoomSettings = {
    radar: { minZoom: 0.8, maxZoom: 2.5, initialZoom: 1 },
    heatmap: { minZoom: 1, maxZoom: 4, initialZoom: 1 },
    scatter: { minZoom: 0.8, maxZoom: 3, initialZoom: 1 },
    gauge: { minZoom: 0.9, maxZoom: 2, initialZoom: 1 },
    timeline: { minZoom: 1, maxZoom: 5, initialZoom: 1 },
  };

  const settings = zoomSettings[chartType];

  return (
    <ZoomableChart
      minZoom={settings.minZoom}
      maxZoom={settings.maxZoom}
      initialZoom={settings.initialZoom}
      className={className}
    >
      {children}
    </ZoomableChart>
  );
}
