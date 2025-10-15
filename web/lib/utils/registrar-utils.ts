/**
 * Registrar Utilities
 *
 * Helper functions for registrar-related operations.
 * Supports logo placeholder generation with initials and colors.
 *
 * Story 5.8: Registrar Logos
 */

/**
 * Extract initials from registrar name
 * Takes first letter of first 2 words
 *
 * @param name - Registrar name
 * @returns Initials (2 characters max)
 *
 * @example
 * getInitials("Link Intime India Private Limited") // "LI"
 * getInitials("KFin Technologies Limited") // "KT"
 * getInitials("Bigshare") // "B"
 */
export function getInitials(name: string): string {
  if (!name || typeof name !== 'string') {
    return '?';
  }

  // Split by spaces and filter out empty strings
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return '?';
  }

  // Take first letter of first 2 words
  const initials = words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  return initials;
}

/**
 * Generate a consistent color based on name hash
 * Uses simple hash algorithm to ensure same name always gets same color
 *
 * @param name - Registrar name
 * @returns Tailwind CSS color class
 *
 * @example
 * getColorFromName("Link Intime") // "bg-blue-500"
 * getColorFromName("KFin Technologies") // "bg-green-500"
 */
export function getColorFromName(name: string): string {
  const colors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-purple-500',
    'bg-orange-500',
    'bg-pink-500',
    'bg-cyan-500',
    'bg-indigo-500',
    'bg-teal-500',
  ];

  if (!name || typeof name !== 'string') {
    return colors[0];
  }

  // Simple hash algorithm: sum of character codes
  const hash = name
    .split('')
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);

  // Use modulo to get consistent index
  return colors[hash % colors.length];
}

/**
 * Get text color class based on background color
 * All backgrounds are dark (500 shade), so text should be white
 *
 * @param bgColor - Background color class
 * @returns Text color class
 */
export function getTextColor(bgColor: string): string {
  return 'text-white';
}
