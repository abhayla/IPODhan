/**
 * Layout for IPO Comparison Tool
 *
 * Provides metadata and layout wrapper for the comparison page
 */

import { Metadata } from 'next';
import { generateComparisonToolMetadata } from '@/lib/seo/metadata';

// ==================== METADATA ====================

export const metadata: Metadata = generateComparisonToolMetadata();

// ==================== LAYOUT COMPONENT ====================

export default function CompareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
