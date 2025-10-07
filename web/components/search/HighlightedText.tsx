/**
 * HighlightedText Component
 *
 * Highlights matching text in search results.
 * Splits text into parts and highlights the query matches.
 *
 * @param text - The text to display
 * @param query - The search query to highlight
 */

'use client';

import React from 'react';

interface HighlightedTextProps {
  text: string;
  query: string;
}

/**
 * Escape special regex characters in search query
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function HighlightedText({ text, query }: HighlightedTextProps) {
  // If no query, return plain text
  if (!query || !query.trim()) {
    return <span>{text}</span>;
  }

  try {
    // Split text by query matches (case-insensitive)
    const escapedQuery = escapeRegex(query);
    const parts = text.split(new RegExp(`(${escapedQuery})`, 'gi'));

    return (
      <span>
        {parts.map((part, index) => {
          // Check if this part matches the query (case-insensitive)
          const isMatch = part.toLowerCase() === query.toLowerCase();

          return isMatch ? (
            <mark
              key={index}
              className="bg-yellow-200 font-semibold text-gray-900 rounded px-0.5"
            >
              {part}
            </mark>
          ) : (
            <span key={index}>{part}</span>
          );
        })}
      </span>
    );
  } catch (error) {
    // Fallback to plain text if regex fails
    console.error('Failed to highlight text:', error);
    return <span>{text}</span>;
  }
}
