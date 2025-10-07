/**
 * Unit tests for HighlightedText component
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HighlightedText } from '@/components/search/HighlightedText';

describe('HighlightedText', () => {
  it('should render plain text when no query provided', () => {
    const { container } = render(<HighlightedText text="Reliance Industries" query="" />);

    const span = container.querySelector('span');
    expect(span).toBeInTheDocument();
    expect(span?.textContent).toBe('Reliance Industries');

    // Should not have any mark elements
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(0);
  });

  it('should highlight matching text (case-insensitive)', () => {
    const { container } = render(
      <HighlightedText text="Reliance Industries" query="reliance" />
    );

    const mark = container.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark?.textContent).toBe('Reliance');
    expect(mark).toHaveClass('bg-yellow-200', 'font-semibold');
  });

  it('should highlight multiple matches', () => {
    const { container } = render(
      <HighlightedText text="Technology and Technology Services" query="tech" />
    );

    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(2);
    marks.forEach((mark) => {
      expect(mark.textContent).toBe('Tech');
    });
  });

  it('should handle partial matches', () => {
    const { container } = render(
      <HighlightedText text="Technology Sector" query="tech" />
    );

    const mark = container.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark?.textContent).toBe('Tech');
  });

  it('should preserve original text casing', () => {
    const { container } = render(
      <HighlightedText text="RELIANCE Industries" query="reliance" />
    );

    const mark = container.querySelector('mark');
    expect(mark?.textContent).toBe('RELIANCE');
  });

  it('should handle query with different casing', () => {
    const { container } = render(
      <HighlightedText text="Reliance Industries" query="RELIANCE" />
    );

    const mark = container.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark?.textContent).toBe('Reliance');
  });

  it('should not highlight when query is whitespace only', () => {
    const { container } = render(
      <HighlightedText text="Reliance Industries" query="   " />
    );

    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(0);
  });

  it('should handle special regex characters safely', () => {
    const { container } = render(
      <HighlightedText text="Company (India) Ltd." query="(India)" />
    );

    const mark = container.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark?.textContent).toBe('(India)');
  });

  it('should handle text with no matches', () => {
    const { container } = render(
      <HighlightedText text="Reliance Industries" query="xyz" />
    );

    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(0);

    const span = container.querySelector('span');
    expect(span?.textContent).toBe('Reliance Industries');
  });

  it('should render non-matching parts as regular text', () => {
    render(<HighlightedText text="Reliance Industries Ltd" query="reliance" />);

    expect(screen.getByText(/Industries Ltd/)).toBeInTheDocument();
  });

  it('should handle empty text', () => {
    const { container } = render(<HighlightedText text="" query="test" />);

    const span = container.querySelector('span');
    expect(span).toBeInTheDocument();
    expect(span?.textContent).toBe('');
  });

  it('should handle query longer than text', () => {
    const { container } = render(
      <HighlightedText text="Tech" query="Technology" />
    );

    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(0);
  });

  it('should apply correct styling to highlighted text', () => {
    const { container } = render(
      <HighlightedText text="Reliance" query="Reliance" />
    );

    const mark = container.querySelector('mark');
    expect(mark).toHaveClass('bg-yellow-200');
    expect(mark).toHaveClass('font-semibold');
    expect(mark).toHaveClass('text-gray-900');
    expect(mark).toHaveClass('rounded');
    expect(mark).toHaveClass('px-0.5');
  });

  it('should handle consecutive matches', () => {
    const { container } = render(
      <HighlightedText text="aaa" query="a" />
    );

    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(3);
  });

  it('should handle text with numbers', () => {
    const { container } = render(
      <HighlightedText text="IPO 2024" query="2024" />
    );

    const mark = container.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark?.textContent).toBe('2024');
  });

  it('should handle regex special characters in query', () => {
    const specialChars = ['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\'];

    specialChars.forEach((char) => {
      const text = `Test ${char} Text`;
      const { container } = render(<HighlightedText text={text} query={char} />);

      const mark = container.querySelector('mark');
      expect(mark).toBeInTheDocument();
      expect(mark?.textContent).toBe(char);
    });
  });

  it('should not throw error with malformed regex', () => {
    // This should not throw due to escapeRegex function
    expect(() => {
      render(<HighlightedText text="Test [text]" query="[text]" />);
    }).not.toThrow();
  });
});
