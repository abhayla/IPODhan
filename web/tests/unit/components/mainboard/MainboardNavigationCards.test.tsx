/**
 * Unit Tests: MainboardNavigationCards Component
 * Story 9.15: Mainboard IPOs Landing Page
 *
 * Tests the navigation cards component with 4 links to dedicated pages.
 * Target: >80% code coverage for component
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MainboardNavigationCards } from '@/components/mainboard/MainboardNavigationCards';

describe('MainboardNavigationCards', () => {
  it('should render all 4 navigation cards', () => {
    // Act
    render(<MainboardNavigationCards />);

    // Assert - Check all 4 card titles
    expect(screen.getByText('Performance Tracker')).toBeInTheDocument();
    expect(screen.getByText('IPO Prospectus')).toBeInTheDocument();
    expect(screen.getByText('IPO Calendar')).toBeInTheDocument();
    expect(screen.getByText('IPO Reviews & Analysis')).toBeInTheDocument();
  });

  it('should display descriptions for all cards', () => {
    // Act
    render(<MainboardNavigationCards />);

    // Assert
    expect(screen.getByText('Track post-listing performance of Mainboard IPOs')).toBeInTheDocument();
    expect(screen.getByText('Download DRHP and RHP documents')).toBeInTheDocument();
    expect(screen.getByText('View Mainboard IPO events and timelines')).toBeInTheDocument();
    expect(screen.getByText('Expert recommendations and analysis')).toBeInTheDocument();
  });

  it('should render correct navigation links', () => {
    // Act
    const { container } = render(<MainboardNavigationCards />);

    // Assert - Check href attributes
    const links = container.querySelectorAll('a');
    const hrefs = Array.from(links).map((link) => link.getAttribute('href'));

    expect(hrefs).toContain('/mainboard-ipo-performance-tracker');
    expect(hrefs).toContain('/mainboard-ipo-prospectus');
    expect(hrefs).toContain('/mainboard-ipo-calendar');
    expect(hrefs).toContain('/mainboard-ipo-reviews');
  });

  it('should render icons for all cards', () => {
    // Act
    const { container } = render(<MainboardNavigationCards />);

    // Assert - Check for icon containers
    const iconContainers = container.querySelectorAll('.rounded-full');
    expect(iconContainers.length).toBe(4);
  });

  it('should apply responsive grid layout', () => {
    // Act
    const { container } = render(<MainboardNavigationCards />);

    // Assert - Check for responsive grid classes
    const gridContainer = container.querySelector('.grid');
    expect(gridContainer).toHaveClass('grid-cols-1');
    expect(gridContainer).toHaveClass('md:grid-cols-2');
    expect(gridContainer).toHaveClass('lg:grid-cols-4');
  });

  it('should apply hover effects to cards', () => {
    // Act
    const { container } = render(<MainboardNavigationCards />);

    // Assert - Check for hover classes
    const cards = container.querySelectorAll('.hover\\:shadow-lg');
    expect(cards.length).toBe(4);
  });

  it('should make entire cards clickable', () => {
    // Act
    const { container } = render(<MainboardNavigationCards />);

    // Assert - Each card is wrapped in a Link
    const linkWrappers = container.querySelectorAll('a.group');
    expect(linkWrappers.length).toBe(4);
  });

  it('should apply cursor pointer to cards', () => {
    // Act
    const { container } = render(<MainboardNavigationCards />);

    // Assert
    const cards = container.querySelectorAll('.cursor-pointer');
    expect(cards.length).toBe(4);
  });

  it('should center card titles', () => {
    // Act
    const { container } = render(<MainboardNavigationCards />);

    // Assert - Check for text-center class on titles
    const titles = container.querySelectorAll('.text-center.text-lg');
    expect(titles.length).toBe(4);
  });

  it('should center card descriptions', () => {
    // Act
    const { container } = render(<MainboardNavigationCards />);

    // Assert - Check for text-center class on descriptions
    const descriptions = container.querySelectorAll('p.text-center.text-sm');
    expect(descriptions.length).toBe(4);
  });

  it('should apply transition effects', () => {
    // Act
    const { container } = render(<MainboardNavigationCards />);

    // Assert - Check for transition classes
    const transitionElements = container.querySelectorAll('.transition-all, .transition-transform, .transition-colors');
    expect(transitionElements.length).toBeGreaterThanOrEqual(4);
  });

  it('should have consistent card heights', () => {
    // Act
    const { container } = render(<MainboardNavigationCards />);

    // Assert - All cards should have h-full class
    const cards = container.querySelectorAll('.h-full');
    expect(cards.length).toBe(4);
  });

  it('should apply group hover classes for icon scaling', () => {
    // Act
    const { container } = render(<MainboardNavigationCards />);

    // Assert
    const iconContainers = container.querySelectorAll('.group-hover\\:scale-110');
    expect(iconContainers.length).toBe(4);
  });

  it('should apply group hover classes for title color change', () => {
    // Act
    const { container } = render(<MainboardNavigationCards />);

    // Assert
    const titles = container.querySelectorAll('.group-hover\\:text-blue-600');
    expect(titles.length).toBe(4);
  });

  it('should have gap spacing between cards', () => {
    // Act
    const { container } = render(<MainboardNavigationCards />);

    // Assert
    const gridContainer = container.querySelector('.grid');
    expect(gridContainer).toHaveClass('gap-4');
  });

  it('should render cards in correct order', () => {
    // Act
    render(<MainboardNavigationCards />);

    // Assert - Get all card titles in order
    const titles = screen.getAllByRole('heading', { level: 3 });
    expect(titles[0]).toHaveTextContent('Performance Tracker');
    expect(titles[1]).toHaveTextContent('IPO Prospectus');
    expect(titles[2]).toHaveTextContent('IPO Calendar');
    expect(titles[3]).toHaveTextContent('IPO Reviews & Analysis');
  });
});
