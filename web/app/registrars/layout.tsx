import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'IPO Registrars Directory | IPODhan',
  description:
    'Find contact information for major IPO registrars in India. Get email, phone, website, and allotment check links for Link Intime, KFin Technologies, Bigshare, and more.',
  keywords: [
    'ipo registrars',
    'registrar directory',
    'link intime',
    'kfin technologies',
    'bigshare',
    'allotment check',
    'registrar contact',
    'ipo allotment status',
  ],
  openGraph: {
    title: 'IPO Registrars Directory | IPODhan',
    description:
      'Comprehensive directory of IPO registrars with contact information and allotment check links.',
    type: 'website',
  },
};

export default function RegistrarsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
