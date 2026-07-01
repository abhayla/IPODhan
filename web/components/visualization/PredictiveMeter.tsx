'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

/**
 * PredictiveMeter - Phase 2: Data Intelligence Surface
 *
 * D3.js gauge (arc) chart showing ML-based listing gain probability.
 * Animated gauge from 0-100% with confidence intervals.
 *
 * Features:
 * - Animated arc gauge visualization
 * - Color gradient from red (low) to green (high)
 * - Confidence interval display
 * - Smooth animation on value changes
 */

export interface PredictionData {
  probability: number;           // 0-100 (percentage likelihood of positive listing)
  expectedGain: number;          // Expected listing gain percentage
  confidenceLow: number;         // Lower bound of 95% confidence interval
  confidenceHigh: number;        // Upper bound of 95% confidence interval
  factors: {
    financial: number;           // 0-1 weight
    subscription: number;        // 0-1 weight
    gmp: number;                // 0-1 weight
    market: number;             // 0-1 weight
  };
}

interface PredictiveMeterProps {
  data: PredictionData;
  width?: number;
  height?: number;
  className?: string;
}

export function PredictiveMeter({
  data,
  width = 300,
  height = 250,
  className = ''
}: PredictiveMeterProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [animatedValue, setAnimatedValue] = useState(0);

  // Animate value on mount and changes
  useEffect(() => {
    const duration = 1000; // 1 second animation
    const startValue = animatedValue;
    const endValue = data.probability;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Cubic easeOut for smooth animation
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      const currentValue = startValue + (endValue - startValue) * easeProgress;

      setAnimatedValue(currentValue);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, [data.probability]);

  useEffect(() => {
    if (!svgRef.current) return;

    // Clear previous chart
    d3.select(svgRef.current).selectAll('*').remove();

    // Chart dimensions
    const margin = { top: 20, right: 20, bottom: 60, left: 20 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    const radius = Math.min(chartWidth, chartHeight) / 2;

    // Create SVG
    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    const g = svg.append('g')
      .attr('transform', `translate(${width / 2}, ${height / 2 + 10})`);

    // Arc generator for background
    const backgroundArc = d3.arc<any>()
      .innerRadius(radius * 0.65)
      .outerRadius(radius)
      .startAngle(-Math.PI / 2)
      .endAngle(Math.PI / 2);

    // Draw background arc
    g.append('path')
      .attr('d', backgroundArc as any)
      .style('fill', 'var(--muted)')
      .style('opacity', 0.2);

    // Color scale for probability
    const colorScale = d3.scaleSequential()
      .domain([0, 100])
      .interpolator(d3.interpolateRdYlGn);

    // Arc generator for value
    const valueArc = d3.arc<any>()
      .innerRadius(radius * 0.65)
      .outerRadius(radius)
      .startAngle(-Math.PI / 2);

    // Draw value arc
    const valueArcPath = g.append('path')
      .attr('class', 'value-arc')
      .style('fill', colorScale(animatedValue));

    // Animate arc
    const endAngle = -Math.PI / 2 + (animatedValue / 100) * Math.PI;
    valueArcPath
      .transition()
      .duration(50)
      .attr('d', valueArc.endAngle(endAngle) as any)
      .style('fill', colorScale(animatedValue));

    // Add tick marks
    const numTicks = 11;
    for (let i = 0; i < numTicks; i++) {
      const angle = -Math.PI / 2 + (i / (numTicks - 1)) * Math.PI;
      const tickLength = i % 2 === 0 ? 15 : 8;
      const innerRadius = radius + 5;
      const outerRadius = radius + 5 + tickLength;

      g.append('line')
        .attr('x1', Math.cos(angle) * innerRadius)
        .attr('y1', Math.sin(angle) * innerRadius)
        .attr('x2', Math.cos(angle) * outerRadius)
        .attr('y2', Math.sin(angle) * outerRadius)
        .style('stroke', 'var(--border)')
        .style('stroke-width', i % 2 === 0 ? 2 : 1);

      // Add labels for major ticks
      if (i % 2 === 0) {
        const labelRadius = radius + 30;
        const value = (i / (numTicks - 1)) * 100;
        g.append('text')
          .attr('x', Math.cos(angle) * labelRadius)
          .attr('y', Math.sin(angle) * labelRadius)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .text(`${value}%`)
          .style('font-size', '11px')
          .style('font-weight', '500')
          .style('fill', 'var(--muted-foreground)')
          .style('font-family', 'var(--font-jetbrains-mono)');
      }
    }

    // Add center value display
    g.append('text')
      .attr('class', 'center-value')
      .attr('x', 0)
      .attr('y', -10)
      .attr('text-anchor', 'middle')
      .text(`${Math.round(animatedValue)}%`)
      .style('font-size', '36px')
      .style('font-weight', '700')
      .style('fill', colorScale(animatedValue))
      .style('font-family', 'var(--font-jetbrains-mono)');

    g.append('text')
      .attr('x', 0)
      .attr('y', 15)
      .attr('text-anchor', 'middle')
      .text('Listing Probability')
      .style('font-size', '12px')
      .style('font-weight', '500')
      .style('fill', 'var(--muted-foreground)')
      .style('font-family', 'var(--font-inter)');

    // Add needle/pointer
    const needleAngle = -Math.PI / 2 + (animatedValue / 100) * Math.PI;
    const needleLength = radius * 0.6;

    const needle = g.append('line')
      .attr('class', 'needle')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', Math.cos(needleAngle) * needleLength)
      .attr('y2', Math.sin(needleAngle) * needleLength)
      .style('stroke', 'var(--foreground)')
      .style('stroke-width', 3)
      .style('stroke-linecap', 'round');

    // Add needle center dot
    g.append('circle')
      .attr('cx', 0)
      .attr('cy', 0)
      .attr('r', 8)
      .style('fill', 'var(--background)')
      .style('stroke', 'var(--foreground)')
      .style('stroke-width', 3);

  }, [animatedValue, width, height]);

  // Determine prediction quality
  const getPredictionQuality = (): { label: string; color: string } => {
    if (data.probability >= 75) return { label: 'Strong', color: 'text-success' };
    if (data.probability >= 50) return { label: 'Moderate', color: 'text-accent' };
    if (data.probability >= 25) return { label: 'Weak', color: 'text-warning' };
    return { label: 'Low', color: 'text-danger' };
  };

  const quality = getPredictionQuality();

  return (
    <div className={`predictive-meter ${className}`}>
      <div className="flex flex-col items-center">
        {/* Gauge Chart */}
        <svg
          ref={svgRef}
          className="predictive-meter-chart"
          role="img"
          aria-label={`Listing probability gauge: ${Math.round(data.probability)}%`}
        />

        {/* Expected Gain */}
        <div className="text-center mt-2">
          <div className="text-sm text-muted-foreground">
            Expected Gain:
            <span className={`ml-2 font-mono font-semibold ${data.expectedGain > 0 ? 'text-success' : 'text-danger'}`}>
              {data.expectedGain > 0 ? '+' : ''}{data.expectedGain.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Confidence Interval */}
        <div className="text-xs text-muted-foreground text-center mt-1">
          95% CI: [{data.confidenceLow.toFixed(1)}%, {data.confidenceHigh.toFixed(1)}%]
        </div>

        {/* Prediction Quality */}
        <div className="mt-3 px-4 py-2 rounded-lg bg-muted/50 text-center">
          <div className="text-xs text-muted-foreground">Prediction Strength</div>
          <div className={`text-sm font-semibold ${quality.color}`}>
            {quality.label}
          </div>
        </div>

        {/* Contributing Factors */}
        <div className="mt-3 w-full max-w-[280px] space-y-1">
          <div className="text-xs text-muted-foreground mb-2">Contributing Factors:</div>
          {Object.entries(data.factors).map(([key, weight]) => (
            <div key={key} className="flex items-center justify-between text-xs">
              <span className="capitalize text-muted-foreground">{key}</span>
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${weight * 100}%` }}
                  />
                </div>
                <span className="font-mono text-muted-foreground w-10 text-right">
                  {(weight * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Disclaimer */}
        <div className="text-xs text-muted-foreground text-center mt-4 max-w-[280px] opacity-70">
          ML-based prediction • Not financial advice
        </div>
      </div>
    </div>
  );
}

export default PredictiveMeter;
