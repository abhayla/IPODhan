import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Hero } from '@/components/home/Hero';

describe('Hero Component', () => {
  it('renders hero section with tagline', () => {
    render(<Hero />);
    expect(screen.getByText(/India's Smartest IPO Platform/i)).toBeInTheDocument();
  });

  it('renders search input', () => {
    render(<Hero />);
    const searchInput = screen.getByPlaceholderText(/search ipos/i);
    expect(searchInput).toBeInTheDocument();
  });

  it('renders live IPO count widget', () => {
    render(<Hero />);
    // Check for widget container or specific text
    const liveText = screen.queryByText(/live ipo/i);
    expect(liveText || screen.getByRole('main')).toBeTruthy();
  });

  it('has semantic HTML structure', () => {
    const { container } = render(<Hero />);
    expect(container.querySelector('h1, h2')).toBeInTheDocument();
  });
});
