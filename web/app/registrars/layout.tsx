import type { Metadata } from 'next';
import { generateRegistrarsMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = generateRegistrarsMetadata();

export default function RegistrarsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
