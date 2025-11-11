'use client';

import React, { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';

/**
 * SectorHeatMap - Phase 2: Data Intelligence Surface
 *
 * D3.js heat map visualization showing IPO performance by sector.
 * Color-coded cells indicate average scores, subscription rates, or listing gains.
 *
 * Features:
 * - Interactive hover with tooltips
 * - Click to filter IPOs by sector
 * - Color gradient from red (poor) to green (excellent)
 * - Sector averages with IPO count
 */

export interface SectorData {
  sector: string;
  avgScore: number;        // 0-10
  avgSubscription: number; // Subscription multiple
  avgListingGain: number;  // Percentage
  ipoCount: number;        // Number of IPOs in sector
  trend: 'up' | 'down' | 'stable';
}

interface SectorHeatMapProps {
  data: SectorData[];
  metric?: 'score' | 'subscription' | 'listing';
  width?: number;
  height?: number;
  onSectorClick?: (sector: string) => void;
  className?: string;
}

export function SectorHeatMap({
  data,
  metric = 'score',
  width = 600,
  height = 400,
  onSectorClick,
  className = ''
}: SectorHeatMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Get metric value from sector data
  const getMetricValue = (d: SectorData): number => {
    switch (metric) {
      case 'score':
        return d.avgScore;
      case 'subscription':
        return d.avgSubscription;
      case 'listing':
        return d.avgListingGain;
      default:
        return d.avgScore;
    }
  };

  // Get metric label
  const metricLabel = useMemo(() => {
    switch (metric) {
      case 'score':
        return 'Avg Score';
      case 'subscription':
        return 'Avg Subscription';
      case 'listing':
        return 'Avg Listing Gain';
      default:
        return 'Avg Score';
    }
  }, [metric]);

  // Get metric format
  const formatMetric = (value: number): string => {
    switch (metric) {
      case 'score':
        return value.toFixed(1);
      case 'subscription':
        return `${value.toFixed(1)}x`;
      case 'listing':
        return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
      default:
        return value.toFixed(1);
    }
  };

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    // Clear previous chart
    d3.select(svgRef.current).selectAll('*').remove();

    // Chart dimensions
    const margin = { top: 60, right: 20, bottom: 80, left: 120 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    // Create SVG
    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    // Calculate grid layout
    const columns = Math.ceil(Math.sqrt(data.length));
    const rows = Math.ceil(data.length / columns);
    const cellWidth = chartWidth / columns;
    const cellHeight = chartHeight / rows;

    // Color scale based on metric
    const values = data.map(getMetricValue);
    const minValue = d3.min(values) || 0;
    const maxValue = d3.max(values) || 10;

    const colorScale = d3.scaleSequential()
      .domain([minValue, maxValue])
      .interpolator(d3.interpolateRdYlGn);

    // Create cells
    const cells = g.selectAll('.heat-cell')
      .data(data)
      .enter()
      .append('g')
      .attr('class', 'heat-cell')
      .attr('transform', (d, i) => {
        const col = i % columns;
        const row = Math.floor(i / columns);
        return `translate(${col * cellWidth}, ${row * cellHeight})`;
      });

    // Draw cell rectangles
    cells.append('rect')
      .attr('width', cellWidth - 4)
      .attr('height', cellHeight - 4)
      .attr('rx', 8)
      .attr('fill', d => colorScale(getMetricValue(d)))
      .attr('stroke', 'hsl(var(--border))')
      .attr('stroke-width', 1)
      .attr('cursor', 'pointer')
      .style('transition', 'all 0.2s ease')
      .on('mouseenter', function(event, d) {
        // Highlight cell
        d3.select(this)
          .attr('stroke-width', 3)
          .attr('stroke', 'hsl(var(--primary))');

        // Show tooltip
        if (tooltipRef.current) {
          const tooltip = d3.select(tooltipRef.current);
          tooltip
            .style('opacity', 1)
            .style('left', `${event.pageX + 10}px`)
            .style('top', `${event.pageY - 10}px`)
            .html(`
              <div class="font-semibold">${d.sector}</div>
              <div class="text-sm mt-1">
                <div>${metricLabel}: <span class="font-mono">${formatMetric(getMetricValue(d))}</span></div>
                <div>IPO Count: ${d.ipoCount}</div>
                <div>Trend: ${d.trend === 'up' ? '📈' : d.trend === 'down' ? '📉' : '➡️'}</div>
              </div>
            `);
        }
      })
      .on('mouseleave', function() {
        // Reset cell
        d3.select(this)
          .attr('stroke-width', 1)
          .attr('stroke', 'hsl(var(--border))');

        // Hide tooltip
        if (tooltipRef.current) {
          d3.select(tooltipRef.current).style('opacity', 0);
        }
      })
      .on('click', function(event, d) {
        if (onSectorClick) {
          onSectorClick(d.sector);
        }
      });

    // Add sector labels
    cells.append('text')
      .attr('x', cellWidth / 2)
      .attr('y', cellHeight / 2 - 10)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .text(d => d.sector)
      .style('font-size', '12px')
      .style('font-weight', '600')
      .style('fill', d => {
        // Use contrasting text color based on background
        const value = getMetricValue(d);
        const mid = (minValue + maxValue) / 2;
        return value > mid ? '#000' : '#fff';
      })
      .style('pointer-events', 'none')
      .style('font-family', 'var(--font-inter)');

    // Add metric values
    cells.append('text')
      .attr('x', cellWidth / 2)
      .attr('y', cellHeight / 2 + 10)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .text(d => formatMetric(getMetricValue(d)))
      .style('font-size', '14px')
      .style('font-weight', '700')
      .style('fill', d => {
        const value = getMetricValue(d);
        const mid = (minValue + maxValue) / 2;
        return value > mid ? '#000' : '#fff';
      })
      .style('pointer-events', 'none')
      .style('font-family', 'var(--font-jetbrains-mono)');

    // Add IPO count badges
    cells.append('text')
      .attr('x', cellWidth - 18)
      .attr('y', 18)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .text(d => d.ipoCount)
      .style('font-size', '10px')
      .style('font-weight', '600')
      .style('fill', '#fff')
      .style('pointer-events', 'none')
      .style('font-family', 'var(--font-jetbrains-mono)');

    cells.append('circle')
      .attr('cx', cellWidth - 18)
      .attr('cy', 18)
      .attr('r', 12)
      .attr('fill', 'rgba(0,0,0,0.3)')
      .attr('stroke', 'rgba(255,255,255,0.5)')
      .attr('stroke-width', 1)
      .style('pointer-events', 'none');

    // Re-append text to bring to front
    cells.each(function() {
      const texts = d3.select(this).selectAll('text');
      texts.each(function() {
        const el = this as SVGTextElement;
        if (el && el.parentNode) {
          el.parentNode.appendChild(el);
        }
      });
    });

    // Add title
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', 30)
      .attr('text-anchor', 'middle')
      .text(`Sector Performance: ${metricLabel}`)
      .style('font-size', '16px')
      .style('font-weight', '600')
      .style('fill', 'hsl(var(--foreground))')
      .style('font-family', 'var(--font-inter)');

    // Add legend
    const legendWidth = 200;
    const legendHeight = 15;
    const legendX = (width - legendWidth) / 2;
    const legendY = height - 40;

    const legendScale = d3.scaleLinear()
      .domain([minValue, maxValue])
      .range([0, legendWidth]);

    const legendAxis = d3.axisBottom(legendScale)
      .ticks(5)
      .tickFormat(d => formatMetric(+d));

    // Create gradient for legend
    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient')
      .attr('id', 'legend-gradient')
      .attr('x1', '0%')
      .attr('x2', '100%');

    const numStops = 10;
    for (let i = 0; i <= numStops; i++) {
      const offset = (i / numStops) * 100;
      const value = minValue + (i / numStops) * (maxValue - minValue);
      gradient.append('stop')
        .attr('offset', `${offset}%`)
        .attr('stop-color', colorScale(value));
    }

    // Draw legend
    svg.append('rect')
      .attr('x', legendX)
      .attr('y', legendY)
      .attr('width', legendWidth)
      .attr('height', legendHeight)
      .attr('fill', 'url(#legend-gradient)')
      .attr('stroke', 'hsl(var(--border))')
      .attr('stroke-width', 1)
      .attr('rx', 4);

    svg.append('g')
      .attr('transform', `translate(${legendX}, ${legendY + legendHeight})`)
      .call(legendAxis)
      .style('font-size', '10px')
      .style('font-family', 'var(--font-jetbrains-mono)');

  }, [data, metric, width, height, onSectorClick, metricLabel, formatMetric, getMetricValue]);

  return (
    <div className={`sector-heat-map ${className}`}>
      <svg
        ref={svgRef}
        className="sector-heat-map-chart"
        role="img"
        aria-label="Sector performance heat map"
      />
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none bg-popover text-popover-foreground border border-border rounded-lg shadow-lg p-3 opacity-0 transition-opacity z-50"
        style={{ maxWidth: '250px' }}
      />
    </div>
  );
}

export default SectorHeatMap;
