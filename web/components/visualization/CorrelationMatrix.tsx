'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

/**
 * CorrelationMatrix - Phase 2: Data Intelligence Surface
 *
 * D3.js scatter plot showing correlation between two IPO metrics.
 * Interactive visualization with trend line, R² value, and zoom capabilities.
 *
 * Features:
 * - Interactive scatter plot with zoom/pan
 * - Linear regression trend line
 * - R² correlation coefficient
 * - Hover tooltips with IPO details
 * - Click to navigate to IPO detail page
 */

export interface CorrelationDataPoint {
  ipoId: string;
  companyName: string;
  xValue: number;
  yValue: number;
  score?: number;
  status?: string;
}

interface CorrelationMatrixProps {
  data: CorrelationDataPoint[];
  xLabel: string;
  yLabel: string;
  width?: number;
  height?: number;
  onPointClick?: (ipoId: string) => void;
  className?: string;
}

export function CorrelationMatrix({
  data,
  xLabel,
  yLabel,
  width = 600,
  height = 400,
  onPointClick,
  className = ''
}: CorrelationMatrixProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [rSquared, setRSquared] = useState<number>(0);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    // Clear previous chart
    d3.select(svgRef.current).selectAll('*').remove();

    // Chart dimensions
    const margin = { top: 40, right: 30, bottom: 70, left: 80 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    // Create SVG
    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    // Scales
    const xExtent = d3.extent(data, d => d.xValue) as [number, number];
    const yExtent = d3.extent(data, d => d.yValue) as [number, number];

    // Add 10% padding to extents
    const xPadding = (xExtent[1] - xExtent[0]) * 0.1;
    const yPadding = (yExtent[1] - yExtent[0]) * 0.1;

    const xScale = d3.scaleLinear()
      .domain([xExtent[0] - xPadding, xExtent[1] + xPadding])
      .range([0, chartWidth])
      .nice();

    const yScale = d3.scaleLinear()
      .domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
      .range([chartHeight, 0])
      .nice();

    // Calculate linear regression
    const n = data.length;
    const sumX = d3.sum(data, d => d.xValue);
    const sumY = d3.sum(data, d => d.yValue);
    const sumXY = d3.sum(data, d => d.xValue * d.yValue);
    const sumX2 = d3.sum(data, d => d.xValue * d.xValue);
    const sumY2 = d3.sum(data, d => d.yValue * d.yValue);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R²
    const meanY = sumY / n;
    const ssTotal = d3.sum(data, d => Math.pow(d.yValue - meanY, 2));
    const ssResidual = d3.sum(data, d => {
      const predicted = slope * d.xValue + intercept;
      return Math.pow(d.yValue - predicted, 2);
    });
    const r2 = 1 - (ssResidual / ssTotal);
    setRSquared(r2);

    // Axes
    const xAxis = d3.axisBottom(xScale)
      .ticks(8)
      .tickFormat(d => d3.format('.2s')(+d));

    const yAxis = d3.axisLeft(yScale)
      .ticks(8)
      .tickFormat(d => d3.format('.2s')(+d));

    // Draw X axis
    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0, ${chartHeight})`)
      .call(xAxis)
      .style('font-family', 'var(--font-jetbrains-mono)')
      .style('font-size', '11px');

    // Draw Y axis
    g.append('g')
      .attr('class', 'y-axis')
      .call(yAxis)
      .style('font-family', 'var(--font-jetbrains-mono)')
      .style('font-size', '11px');

    // X axis label
    g.append('text')
      .attr('x', chartWidth / 2)
      .attr('y', chartHeight + 50)
      .attr('text-anchor', 'middle')
      .text(xLabel)
      .style('font-size', '12px')
      .style('font-weight', '600')
      .style('fill', 'hsl(var(--foreground))')
      .style('font-family', 'var(--font-inter)');

    // Y axis label
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -chartHeight / 2)
      .attr('y', -60)
      .attr('text-anchor', 'middle')
      .text(yLabel)
      .style('font-size', '12px')
      .style('font-weight', '600')
      .style('fill', 'hsl(var(--foreground))')
      .style('font-family', 'var(--font-inter)');

    // Draw regression line
    const lineX1 = xScale.domain()[0];
    const lineX2 = xScale.domain()[1];
    const lineY1 = slope * lineX1 + intercept;
    const lineY2 = slope * lineX2 + intercept;

    g.append('line')
      .attr('class', 'regression-line')
      .attr('x1', xScale(lineX1))
      .attr('y1', yScale(lineY1))
      .attr('x2', xScale(lineX2))
      .attr('y2', yScale(lineY2))
      .style('stroke', 'oklch(var(--primary))')
      .style('stroke-width', 2)
      .style('stroke-dasharray', '5,5')
      .style('opacity', 0.6);

    // Color scale for score (if available)
    const scoreExtent = d3.extent(data.filter(d => d.score !== undefined), d => d.score!) as [number, number];
    const colorScale = d3.scaleSequential()
      .domain(scoreExtent || [0, 10])
      .interpolator(d3.interpolateRdYlGn);

    // Draw data points
    g.selectAll('.data-point')
      .data(data)
      .enter()
      .append('circle')
      .attr('class', 'data-point')
      .attr('cx', d => xScale(d.xValue))
      .attr('cy', d => yScale(d.yValue))
      .attr('r', 6)
      .attr('fill', d => d.score !== undefined ? colorScale(d.score) : 'oklch(var(--accent))')
      .attr('stroke', 'white')
      .attr('stroke-width', 2)
      .attr('opacity', 0.8)
      .style('cursor', 'pointer')
      .on('mouseenter', function(event, d) {
        // Highlight point
        d3.select(this)
          .transition()
          .duration(150)
          .attr('r', 9)
          .attr('opacity', 1);

        // Show tooltip
        if (tooltipRef.current) {
          const tooltip = d3.select(tooltipRef.current);
          tooltip
            .style('opacity', 1)
            .style('left', `${event.pageX + 10}px`)
            .style('top', `${event.pageY - 10}px`)
            .html(`
              <div class="font-semibold">${d.companyName}</div>
              <div class="text-sm mt-1 space-y-0.5">
                <div>${xLabel}: <span class="font-mono">${d.xValue.toFixed(2)}</span></div>
                <div>${yLabel}: <span class="font-mono">${d.yValue.toFixed(2)}</span></div>
                ${d.score !== undefined ? `<div>Score: <span class="font-mono">${d.score.toFixed(1)}/10</span></div>` : ''}
                ${d.status ? `<div>Status: <span class="capitalize">${d.status.toLowerCase()}</span></div>` : ''}
              </div>
            `);
        }
      })
      .on('mouseleave', function() {
        // Reset point
        d3.select(this)
          .transition()
          .duration(150)
          .attr('r', 6)
          .attr('opacity', 0.8);

        // Hide tooltip
        if (tooltipRef.current) {
          d3.select(tooltipRef.current).style('opacity', 0);
        }
      })
      .on('click', function(event, d) {
        if (onPointClick) {
          onPointClick(d.ipoId);
        }
      });

    // Add grid lines
    g.append('g')
      .attr('class', 'grid')
      .attr('opacity', 0.1)
      .call(d3.axisLeft(yScale)
        .tickSize(-chartWidth)
        .tickFormat(() => '')
      );

    g.append('g')
      .attr('class', 'grid')
      .attr('transform', `translate(0, ${chartHeight})`)
      .attr('opacity', 0.1)
      .call(d3.axisBottom(xScale)
        .tickSize(-chartHeight)
        .tickFormat(() => '')
      );

    // Add title with R²
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .text(`${xLabel} vs ${yLabel} (R² = ${r2.toFixed(3)})`)
      .style('font-size', '14px')
      .style('font-weight', '600')
      .style('fill', 'hsl(var(--foreground))')
      .style('font-family', 'var(--font-inter)');

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 5])
      .extent([[0, 0], [chartWidth, chartHeight]])
      .translateExtent([[0, 0], [chartWidth, chartHeight]])
      .on('zoom', (event) => {
        const newXScale = event.transform.rescaleX(xScale);
        const newYScale = event.transform.rescaleY(yScale);

        // Update axes
        g.select<SVGGElement>('.x-axis').call(xAxis.scale(newXScale));
        g.select<SVGGElement>('.y-axis').call(yAxis.scale(newYScale));

        // Update points
        g.selectAll<SVGCircleElement, CorrelationDataPoint>('.data-point')
          .attr('cx', d => newXScale(d.xValue))
          .attr('cy', d => newYScale(d.yValue));

        // Update regression line
        g.select<SVGLineElement>('.regression-line')
          .attr('x1', newXScale(lineX1))
          .attr('y1', newYScale(lineY1))
          .attr('x2', newXScale(lineX2))
          .attr('y2', newYScale(lineY2));
      });

    svg.call(zoom as any);

  }, [data, xLabel, yLabel, width, height, onPointClick]);

  return (
    <div className={`correlation-matrix ${className}`}>
      <svg
        ref={svgRef}
        className="correlation-matrix-chart"
        role="img"
        aria-label={`Correlation scatter plot: ${xLabel} vs ${yLabel}`}
      />
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none bg-popover text-popover-foreground border border-border rounded-lg shadow-lg p-3 opacity-0 transition-opacity z-50"
        style={{ maxWidth: '250px' }}
      />
      <div className="text-xs text-muted-foreground text-center mt-2">
        {data.length} IPOs • R² = {rSquared.toFixed(3)} • {rSquared > 0.7 ? 'Strong' : rSquared > 0.4 ? 'Moderate' : 'Weak'} correlation
      </div>
    </div>
  );
}

export default CorrelationMatrix;
