import { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';

/**
 * Tools index / hub page.
 *
 * Exists so the "Tools" breadcrumb (linked from lot-calculator, compare,
 * registrars, market-holidays) resolves instead of 404ing (GitHub #12), and to
 * give users a single entry point to the IPO tools.
 */
export const metadata: Metadata = {
  title: 'IPO Tools — Lot Calculator & Comparison | IPODhan',
  description:
    'Free tools for Indian IPO investors: calculate lot sizes for your investment amount and compare IPOs side by side.',
  alternates: { canonical: '/tools' },
};

const TOOLS = [
  {
    href: '/tools/lot-calculator',
    name: 'Lot Size Calculator',
    description:
      'Work out how many lots you can apply for with a given investment amount, across retail and HNI categories.',
  },
  {
    href: '/tools/compare',
    name: 'Compare IPOs',
    description:
      'Compare IPOs side by side on price band, lot size, subscription, GMP, financials and more.',
  },
];

export default function ToolsIndexPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-muted/30">
        <div className="container mx-auto px-4 py-3">
          <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Tools' }]} />
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">IPO Tools</h1>
        <p className="text-muted-foreground mb-8">
          Free calculators and comparison tools for Indian IPO investors.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="block rounded-lg border p-6 transition-colors hover:border-primary hover:bg-muted/40"
            >
              <h2 className="text-xl font-semibold text-foreground mb-2">{tool.name}</h2>
              <p className="text-sm text-muted-foreground">{tool.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
