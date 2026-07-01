'use client';

import React, { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';

/**
 * ScoreBreakdown - Phase 2: Data Intelligence Surface
 *
 * D3.js radar chart visualizing IPO's 5-component scoring breakdown.
 * Exposes the hidden real-time scoring system as the hero feature.
 *
 * Components visualized:
 * 1. Financial Strength (0-3)
 * 2. Valuation (0-2)
 * 3. Subscription Demand (0-2)
 * 4. Market Performance (0-2)
 * 5. Fundamentals (0-1)
 */

export interface ScoreBreakdownData {
  financialStrength: number;  // 0-3
  valuation: number;          // 0-2
  subscriptionDemand: number; // 0-2
  marketPerformance: number;  // 0-2
  fundamentals: number;       // 0-1
  total: number;              // 0-10
  rating: string;             // "Exceptional", "Strong", etc.
  confidence: number;         // 0-100
}

interface ScoreBreakdownProps {
  data: ScoreBreakdownData;
  width?: number;
  height?: number;
  className?: string;
}

interface RadarDataPoint {
  axis: string;
  value: number;
  max: number;
  percentage: number;
}

export function ScoreBreakdown({
  data,
  width = 280,
  height = 280,
  className = ''
}: ScoreBreakdownProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Transform scoring data to radar chart format
  const radarData: RadarDataPoint[] = useMemo(() => [
    {
      axis: 'Financial',
      value: data.financialStrength,
      max: 3,
      percentage: (data.financialStrength / 3) * 100
    },
    {
      axis: 'Valuation',
      value: data.valuation,
      max: 2,
      percentage: (data.valuation / 2) * 100
    },
    {
      axis: 'Subscription',
      value: data.subscriptionDemand,
      max: 2,
      percentage: (data.subscriptionDemand / 2) * 100
    },
    {
      axis: 'Market',
      value: data.marketPerformance,
      max: 2,
      percentage: (data.marketPerformance / 2) * 100
    },
    {
      axis: 'Fundamentals',
      value: data.fundamentals,
      max: 1,
      percentage: (data.fundamentals / 1) * 100
    }
  ], [data]);

  useEffect(() => {
    if (!svgRef.current) return;

    // Clear previous chart
    d3.select(svgRef.current).selectAll('*').remove();

    // Chart dimensions
    const margin = { top: 50, right: 50, bottom: 50, left: 50 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    const radius = Math.min(chartWidth, chartHeight) / 2;

    // Create SVG container
    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    const g = svg.append('g')
      .attr('transform', `translate(${width / 2}, ${height / 2})`);

    // Number of axes
    const totalAxes = radarData.length;
    const angleSlice = (Math.PI * 2) / totalAxes;

    // Scale for radius (normalized 0-100%)
    const rScale = d3.scaleLinear()
      .domain([0, 100])
      .range([0, radius]);

    // Draw background circles (grid)
    const levels = 5;
    const levelFactor = 1;

    for (let level = 1; level <= levels; level++) {
      const levelRadius = radius * (level / levels) * levelFactor;

      g.append('circle')
        .attr('r', levelRadius)
        .attr('class', 'radar-grid-circle')
        .style('fill', 'none')
        .style('stroke', 'var(--border)')
        .style('stroke-opacity', 0.3)
        .style('stroke-width', '1px');
    }

    // Draw axis lines
    const axis = g.selectAll('.axis')
      .data(radarData)
      .enter()
      .append('g')
      .attr('class', 'axis');

    axis.append('line')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', (d, i) => rScale(100) * Math.cos(angleSlice * i - Math.PI / 2))
      .attr('y2', (d, i) => rScale(100) * Math.sin(angleSlice * i - Math.PI / 2))
      .style('stroke', 'var(--border)')
      .style('stroke-opacity', 0.5)
      .style('stroke-width', '1px');

    // Add axis labels
    axis.append('text')
      .attr('class', 'radar-axis-label')
      .attr('data-testid', (d) => `radar-label-${d.axis.toLowerCase()}`)
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('x', (d, i) => {
        const angle = angleSlice * i - Math.PI / 2;
        return (rScale(100) + 20) * Math.cos(angle);
      })
      .attr('y', (d, i) => {
        const angle = angleSlice * i - Math.PI / 2;
        return (rScale(100) + 20) * Math.sin(angle);
      })
      .text(d => d.axis)
      .style('font-size', '12px')
      .style('font-weight', '500')
      .style('fill', 'var(--foreground)')
      .style('font-family', 'var(--font-inter)');

    // Add score values next to labels
    axis.append('text')
      .attr('class', 'radar-score-value')
      .attr('text-anchor', 'middle')
      .attr('dy', '1.5em')
      .attr('x', (d, i) => {
        const angle = angleSlice * i - Math.PI / 2;
        return (rScale(100) + 20) * Math.cos(angle);
      })
      .attr('y', (d, i) => {
        const angle = angleSlice * i - Math.PI / 2;
        return (rScale(100) + 20) * Math.sin(angle);
      })
      .text(d => `${d.value.toFixed(1)}/${d.max}`)
      .style('font-size', '11px')
      .style('font-weight', '600')
      .style('fill', 'var(--primary)')
      .style('font-family', 'var(--font-jetbrains-mono)');

    // Create radar area path generator
    const radarLine = d3.lineRadial<RadarDataPoint>()
      .radius(d => rScale(d.percentage))
      .angle((d, i) => i * angleSlice)
      .curve(d3.curveLinearClosed);

    // Draw the radar area (filled)
    g.append('path')
      .datum(radarData)
      .attr('class', 'radar-area')
      .attr('d', radarLine as any)
      .style('fill', 'oklch(var(--primary))')
      .style('fill-opacity', 0.25)
      .style('stroke', 'oklch(var(--primary))')
      .style('stroke-width', '2px')
      .style('stroke-opacity', 0.8);

    // Draw data points
    g.selectAll('.radar-point')
      .data(radarData)
      .enter()
      .append('circle')
      .attr('class', 'radar-point')
      .attr('r', 4)
      .attr('cx', (d, i) => rScale(d.percentage) * Math.cos(angleSlice * i - Math.PI / 2))
      .attr('cy', (d, i) => rScale(d.percentage) * Math.sin(angleSlice * i - Math.PI / 2))
      .style('fill', 'oklch(var(--primary))')
      .style('stroke', 'white')
      .style('stroke-width', '2px')
      .style('cursor', 'pointer')
      .on('mouseenter', function(event, d) {
        d3.select(this)
          .transition()
          .duration(150)
          .attr('r', 6);
      })
      .on('mouseleave', function(event, d) {
        d3.select(this)
          .transition()
          .duration(150)
          .attr('r', 4);
      });

  }, [radarData, width, height]);

  return (
    <div className={`score-breakdown ${className}`} data-testid="score-breakdown">
      <div className="flex flex-col items-center">
        {/* Total Score Display */}
        <div className="text-center mb-4">
          <div className="text-4xl font-bold text-primary font-serif">
            {data.total.toFixed(1)}
          </div>
          <div className="text-sm text-muted-foreground font-medium">
            {data.rating}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {data.confidence}% confidence
          </div>
        </div>

        {/* Radar Chart */}
        <svg
          ref={svgRef}
          className="score-breakdown-chart"
          role="img"
          aria-label={`IPO score breakdown: ${data.total.toFixed(1)} out of 10`}
        />

        {/* Legend */}
        <div className="text-xs text-muted-foreground text-center mt-3 max-w-[280px]">
          5-component real-time scoring • Updates every hour
        </div>
      </div>
    </div>
  );
}

export default ScoreBreakdown;
