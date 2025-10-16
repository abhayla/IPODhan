import type { Metadata } from 'next';
import Script from 'next/script';
import { generateRegistrarsMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = generateRegistrarsMetadata();

export default function RegistrarsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Structured Data for Registrars Directory */}
      <Script
        id="registrars-schema"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: 'IPO Registrars Directory',
            description:
              'Complete directory of IPO registrars in India with contact information and allotment status links',
            url: 'https://ipodhan.com/registrars',
            mainEntity: {
              '@type': 'ItemList',
              name: 'IPO Registrars',
              description: 'Major IPO registrars in India',
            },
          }),
        }}
      />
      {children}
    </>
  );
}
