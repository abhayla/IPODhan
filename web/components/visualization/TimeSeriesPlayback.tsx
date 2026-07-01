'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { Play, Pause, RotateCcw, FastForward } from 'lucide-react';

/**
 * TimeSeriesPlayback - Phase 2: Data Intelligence Surface
 *
 * D3.js animated time series showing IPO journey from announcement to listing.
 * Interactive playback with play/pause, speed control, and scrubbing.
 *
 * Features:
 * - Animated line chart playback
 * - Play/pause/reset controls
 * - Speed adjustment (0.5x, 1x, 2x)
 * - Scrubbing timeline
 * - Event markers (announcement, open, close, listing)
 */

export interface TimeSeriesDataPoint {
  date: Date;
  value: number;
  label?: string;
  event?: 'announcement' | 'open' | 'close' | 'listing';
}

interface TimeSeriesPlaybackProps {
  data: TimeSeriesDataPoint[];
  title: string;
  yAxisLabel: string;
  width?: number;
  height?: number;
  className?: string;
}

export function TimeSeriesPlayback({
  data,
  title,
  yAxisLabel,
  width = 700,
  height = 350,
  className = ''
}: TimeSeriesPlaybackProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1); // 0.5x, 1x, 2x
  const animationRef = useRef<number | undefined>(undefined);

  const sortedData = [...data].sort((a, b) => a.date.getTime() - b.date.getTime());
  const totalFrames = sortedData.length;

  // Play/pause animation
  const togglePlayback = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);

  // Reset animation
  const resetPlayback = useCallback(() => {
    setIsPlaying(false);
    setCurrentFrame(0);
  }, []);

  // Cycle playback speed
  const cycleSpeed = useCallback(() => {
    setPlaybackSpeed(prev => {
      if (prev === 0.5) return 1;
      if (prev === 1) return 2;
      return 0.5;
    });
  }, []);

  // Animation loop
  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      return;
    }

    let lastTimestamp = performance.now();
    const frameInterval = (1000 / 30) / playbackSpeed; // 30 fps adjusted by speed

    const animate = (timestamp: number) => {
      if (timestamp - lastTimestamp >= frameInterval) {
        setCurrentFrame(prev => {
          if (prev >= totalFrames - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
        lastTimestamp = timestamp;
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, playbackSpeed, totalFrames]);

  // Draw chart
  useEffect(() => {
    if (!svgRef.current || sortedData.length === 0) return;

    // Clear previous chart
    d3.select(svgRef.current).selectAll('*').remove();

    // Chart dimensions
    const margin = { top: 40, right: 40, bottom: 70, left: 70 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    // Create SVG
    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    // Scales
    const xScale = d3.scaleTime()
      .domain(d3.extent(sortedData, d => d.date) as [Date, Date])
      .range([0, chartWidth]);

    const yExtent = d3.extent(sortedData, d => d.value) as [number, number];
    const yPadding = (yExtent[1] - yExtent[0]) * 0.1;

    const yScale = d3.scaleLinear()
      .domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
      .range([chartHeight, 0])
      .nice();

    // Axes
    const xAxis = d3.axisBottom(xScale)
      .ticks(6)
      .tickFormat(d => d3.timeFormat('%b %d')(d as Date));

    const yAxis = d3.axisLeft(yScale)
      .ticks(6);

    // Draw axes
    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0, ${chartHeight})`)
      .call(xAxis)
      .style('font-family', 'var(--font-inter)')
      .style('font-size', '11px');

    g.append('g')
      .attr('class', 'y-axis')
      .call(yAxis)
      .style('font-family', 'var(--font-jetbrains-mono)')
      .style('font-size', '11px');

    // Y axis label
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -chartHeight / 2)
      .attr('y', -50)
      .attr('text-anchor', 'middle')
      .text(yAxisLabel)
      .style('font-size', '12px')
      .style('font-weight', '600')
      .style('fill', 'var(--foreground)')
      .style('font-family', 'var(--font-inter)');

    // Grid lines
    g.append('g')
      .attr('class', 'grid')
      .attr('opacity', 0.1)
      .call(d3.axisLeft(yScale)
        .tickSize(-chartWidth)
        .tickFormat(() => '')
      );

    // Draw full path (faded)
    const line = d3.line<TimeSeriesDataPoint>()
      .x(d => xScale(d.date))
      .y(d => yScale(d.value))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(sortedData)
      .attr('class', 'full-path')
      .attr('d', line)
      .style('fill', 'none')
      .style('stroke', 'var(--muted-foreground)')
      .style('stroke-width', 2)
      .style('stroke-opacity', 0.2)
      .style('stroke-dasharray', '5,5');

    // Draw animated path (up to current frame)
    const currentData = sortedData.slice(0, currentFrame + 1);

    if (currentData.length > 1) {
      g.append('path')
        .datum(currentData)
        .attr('class', 'animated-path')
        .attr('d', line)
        .style('fill', 'none')
        .style('stroke', 'oklch(var(--primary))')
        .style('stroke-width', 3);

      // Draw area under curve
      const area = d3.area<TimeSeriesDataPoint>()
        .x(d => xScale(d.date))
        .y0(chartHeight)
        .y1(d => yScale(d.value))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(currentData)
        .attr('class', 'animated-area')
        .attr('d', area)
        .style('fill', 'oklch(var(--primary))')
        .style('opacity', 0.1);
    }

    // Draw event markers
    sortedData.forEach((d, i) => {
      if (d.event && i <= currentFrame) {
        const eventColors = {
          announcement: '#3b82f6',
          open: '#10b981',
          close: '#f59e0b',
          listing: '#8b5cf6'
        };

        // Event marker circle
        g.append('circle')
          .attr('cx', xScale(d.date))
          .attr('cy', yScale(d.value))
          .attr('r', 6)
          .style('fill', eventColors[d.event])
          .style('stroke', 'white')
          .style('stroke-width', 2);

        // Event label
        g.append('text')
          .attr('x', xScale(d.date))
          .attr('y', yScale(d.value) - 15)
          .attr('text-anchor', 'middle')
          .text(d.event.charAt(0).toUpperCase() + d.event.slice(1))
          .style('font-size', '10px')
          .style('font-weight', '600')
          .style('fill', eventColors[d.event])
          .style('font-family', 'var(--font-inter)');
      }
    });

    // Draw current data point
    if (currentData.length > 0) {
      const currentPoint = currentData[currentData.length - 1];

      g.append('circle')
        .attr('class', 'current-point')
        .attr('cx', xScale(currentPoint.date))
        .attr('cy', yScale(currentPoint.value))
        .attr('r', 5)
        .style('fill', 'oklch(var(--primary))')
        .style('stroke', 'white')
        .style('stroke-width', 2);

      // Pulse animation
      g.append('circle')
        .attr('class', 'pulse')
        .attr('cx', xScale(currentPoint.date))
        .attr('cy', yScale(currentPoint.value))
        .attr('r', 5)
        .style('fill', 'none')
        .style('stroke', 'oklch(var(--primary))')
        .style('stroke-width', 2)
        .style('opacity', 0.5)
        .transition()
        .duration(1000)
        .ease(d3.easeLinear)
        .attr('r', 15)
        .style('opacity', 0);

      // Value label
      g.append('text')
        .attr('x', xScale(currentPoint.date))
        .attr('y', yScale(currentPoint.value) - 15)
        .attr('text-anchor', 'middle')
        .text(currentPoint.value.toFixed(2))
        .style('font-size', '12px')
        .style('font-weight', '700')
        .style('fill', 'var(--foreground)')
        .style('font-family', 'var(--font-jetbrains-mono)');
    }

    // Title
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .text(title)
      .style('font-size', '14px')
      .style('font-weight', '600')
      .style('fill', 'var(--foreground)')
      .style('font-family', 'var(--font-inter)');

  }, [sortedData, currentFrame, title, yAxisLabel, width, height]);

  return (
    <div className={`time-series-playback ${className}`}>
      <div className="flex flex-col">
        {/* Chart */}
        <svg
          ref={svgRef}
          className="time-series-playback-chart"
          role="img"
          aria-label={`Time series playback: ${title}`}
        />

        {/* Controls */}
        <div className="flex items-center justify-center gap-4 mt-4">
          {/* Play/Pause */}
          <button
            onClick={togglePlayback}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2"
          >
            {isPlaying ? (
              <>
                <Pause className="w-4 h-4" />
                Pause
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Play
              </>
            )}
          </button>

          {/* Reset */}
          <button
            onClick={resetPlayback}
            className="px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors flex items-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            Reset
          </button>

          {/* Speed */}
          <button
            onClick={cycleSpeed}
            className="px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors flex items-center gap-2"
          >
            <FastForward className="w-4 h-4" />
            {playbackSpeed}x
          </button>
        </div>

        {/* Progress bar / scrubber */}
        <div className="mt-4 px-4">
          <div className="flex items-center gap-3">
            <div className="text-xs text-muted-foreground font-mono">
              {currentFrame + 1}/{totalFrames}
            </div>
            <input
              type="range"
              min="0"
              max={totalFrames - 1}
              value={currentFrame}
              onChange={(e) => {
                setCurrentFrame(parseInt(e.target.value));
                setIsPlaying(false);
              }}
              className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
            />
            <div className="text-xs text-muted-foreground">
              {sortedData[currentFrame]?.date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TimeSeriesPlayback;
