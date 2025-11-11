'use client';

import React, { useState, useCallback } from 'react';

/**
 * ScoreRangeFilter - Phase 2: Data Intelligence Surface
 *
 * Interactive dual-handle slider for filtering IPOs by score range (0-10).
 * Exposes the hidden scoring system and allows users to find quality IPOs.
 *
 * Features:
 * - Dual-handle range slider
 * - Live value display
 * - Preset quality tiers
 * - Color-coded score ranges
 */

export interface ScoreRange {
  min: number;
  max: number;
}

interface ScoreRangeFilterProps {
  value: ScoreRange;
  onChange: (range: ScoreRange) => void;
  className?: string;
}

export function ScoreRangeFilter({
  value,
  onChange,
  className = ''
}: ScoreRangeFilterProps) {
  const [isChanging, setIsChanging] = useState(false);

  // Preset ranges
  const presets = [
    { label: 'All', min: 0, max: 10 },
    { label: 'Exceptional', min: 9, max: 10 },
    { label: 'Strong+', min: 7.5, max: 10 },
    { label: 'Good+', min: 6, max: 10 },
  ];

  const handleMinChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newMin = parseFloat(e.target.value);
    if (newMin <= value.max) {
      onChange({ min: newMin, max: value.max });
    }
  }, [value.max, onChange]);

  const handleMaxChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newMax = parseFloat(e.target.value);
    if (newMax >= value.min) {
      onChange({ min: value.min, max: newMax });
    }
  }, [value.min, onChange]);

  const applyPreset = (preset: { min: number; max: number }) => {
    onChange(preset);
  };

  // Get color for score range
  const getRangeColor = (): string => {
    const avgScore = (value.min + value.max) / 2;
    if (avgScore >= 9) return 'from-green-500 to-emerald-500';
    if (avgScore >= 7.5) return 'from-blue-500 to-green-500';
    if (avgScore >= 6) return 'from-yellow-500 to-blue-500';
    if (avgScore >= 4.5) return 'from-orange-500 to-yellow-500';
    return 'from-red-500 to-orange-500';
  };

  return (
    <div className={`score-range-filter ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-foreground">
          IPO Score Filter
        </div>
        <div className="text-xs text-muted-foreground">
          {value.min === 0 && value.max === 10 ? (
            'All IPOs'
          ) : (
            `${value.min.toFixed(1)} - ${value.max.toFixed(1)}`
          )}
        </div>
      </div>

      {/* Preset Buttons */}
      <div className="flex gap-2 mb-4">
        {presets.map((preset, index) => {
          const isActive = value.min === preset.min && value.max === preset.max;
          return (
            <button
              key={index}
              onClick={() => applyPreset(preset)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* Range Visualization */}
      <div className="relative h-2 mb-6">
        {/* Background track */}
        <div className="absolute w-full h-2 bg-muted rounded-full" />

        {/* Active range */}
        <div
          className={`absolute h-2 bg-gradient-to-r ${getRangeColor()} rounded-full transition-all duration-200`}
          style={{
            left: `${(value.min / 10) * 100}%`,
            width: `${((value.max - value.min) / 10) * 100}%`
          }}
        />

        {/* Min handle */}
        <div
          className="absolute w-4 h-4 bg-background border-2 border-primary rounded-full shadow-lg -translate-x-1/2 -translate-y-1/2 top-1/2 cursor-grab transition-transform hover:scale-110"
          style={{ left: `${(value.min / 10) * 100}%` }}
        />

        {/* Max handle */}
        <div
          className="absolute w-4 h-4 bg-background border-2 border-primary rounded-full shadow-lg -translate-x-1/2 -translate-y-1/2 top-1/2 cursor-grab transition-transform hover:scale-110"
          style={{ left: `${(value.max / 10) * 100}%` }}
        />
      </div>

      {/* Slider Inputs */}
      <div className="relative mb-2">
        {/* Min slider */}
        <input
          type="range"
          min="0"
          max="10"
          step="0.5"
          value={value.min}
          onChange={handleMinChange}
          onMouseDown={() => setIsChanging(true)}
          onMouseUp={() => setIsChanging(false)}
          onTouchStart={() => setIsChanging(true)}
          onTouchEnd={() => setIsChanging(false)}
          className="absolute w-full h-2 bg-transparent appearance-none cursor-pointer pointer-events-none
            [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-grab
            [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:transition-transform
            [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none
            [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:border-0"
          style={{ zIndex: value.min > 5 ? 2 : 1 }}
        />

        {/* Max slider */}
        <input
          type="range"
          min="0"
          max="10"
          step="0.5"
          value={value.max}
          onChange={handleMaxChange}
          onMouseDown={() => setIsChanging(true)}
          onMouseUp={() => setIsChanging(false)}
          onTouchStart={() => setIsChanging(true)}
          onTouchEnd={() => setIsChanging(false)}
          className="absolute w-full h-2 bg-transparent appearance-none cursor-pointer pointer-events-none
            [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-grab
            [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:transition-transform
            [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none
            [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:border-0"
          style={{ zIndex: value.max > 5 ? 2 : 1 }}
        />
      </div>

      {/* Value Labels */}
      <div className="flex justify-between text-xs text-muted-foreground mt-6">
        <div className="flex flex-col items-start">
          <span className="text-[10px] opacity-70">Min Score</span>
          <span className="font-mono font-semibold text-foreground">
            {value.min.toFixed(1)}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] opacity-70">Max Score</span>
          <span className="font-mono font-semibold text-foreground">
            {value.max.toFixed(1)}
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 pt-4 border-t border-border">
        <div className="text-[10px] text-muted-foreground space-y-1">
          <div className="flex items-center justify-between">
            <span>Exceptional (9.0-10.0)</span>
            <div className="w-12 h-1 bg-gradient-to-r from-green-500 to-emerald-500 rounded" />
          </div>
          <div className="flex items-center justify-between">
            <span>Strong (7.5-8.9)</span>
            <div className="w-12 h-1 bg-gradient-to-r from-blue-500 to-green-500 rounded" />
          </div>
          <div className="flex items-center justify-between">
            <span>Good (6.0-7.4)</span>
            <div className="w-12 h-1 bg-gradient-to-r from-yellow-500 to-blue-500 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default ScoreRangeFilter;
