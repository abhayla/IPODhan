import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdminMobileNavToggle } from '@/components/admin/AdminMobileNavToggle';

const navigation = [
  { name: 'Dashboard', href: '/admin', icon: '📊' },
  { name: 'Settings', href: '/admin/settings', icon: '⚙️' },
];

describe('AdminMobileNavToggle (§9.2 item 21, OD-115)', () => {
  it('is collapsed by default: no nav links rendered', () => {
    render(<AdminMobileNavToggle navigation={navigation} pathname="/admin" />);
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });

  it('opens the menu on toggle click and shows every nav item', () => {
    render(<AdminMobileNavToggle navigation={navigation} pathname="/admin" />);
    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('closes the menu on a second toggle click', () => {
    render(<AdminMobileNavToggle navigation={navigation} pathname="/admin" />);
    const toggle = screen.getByRole('button', { name: /open navigation menu/i });
    fireEvent.click(toggle);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /close navigation menu/i }));
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('closes the menu when a nav link is clicked', () => {
    render(<AdminMobileNavToggle navigation={navigation} pathname="/admin" />);
    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));
    fireEvent.click(screen.getByText('Settings'));
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('the toggle button meets the 44x44 CSS px tap-target minimum via min-h/min-w classes', () => {
    render(<AdminMobileNavToggle navigation={navigation} pathname="/admin" />);
    const toggle = screen.getByRole('button', { name: /open navigation menu/i });
    expect(toggle.className).toMatch(/h-11/);
    expect(toggle.className).toMatch(/w-11/);
  });

  it('the toggle is scoped to phone widths via the md:hidden wrapper', () => {
    const { container } = render(<AdminMobileNavToggle navigation={navigation} pathname="/admin" />);
    expect(container.firstElementChild?.className).toMatch(/md:hidden/);
  });
});
