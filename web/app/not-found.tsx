import Link from 'next/link';
import { Home, Search, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="max-w-2xl w-full text-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        {/* Error Code */}
        <div className="relative">
          <h1 className="text-9xl font-bold text-primary/20">404</h1>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-background px-4 py-2 rounded-lg shadow-2xl">
              <h2 className="text-2xl font-semibold">Page Not Found</h2>
            </div>
          </div>
        </div>

        {/* Message */}
        <div className="space-y-4">
          <p className="text-lg text-muted-foreground">
            Sorry, we couldn't find the page you're looking for.
          </p>
          <p className="text-sm text-muted-foreground">
            The page may have been moved, deleted, or the URL might be incorrect.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
          <Link href="/" passHref>
            <Button
              size="lg"
              className="group min-w-[160px] transition-all duration-300 hover:shadow-lg hover:scale-105"
            >
              <Home className="mr-2 h-4 w-4 transition-transform group-hover:scale-110" />
              Go Home
            </Button>
          </Link>
          <Link href="/dashboard" passHref>
            <Button
              size="lg"
              variant="outline"
              className="group min-w-[160px] transition-all duration-300 hover:shadow-lg hover:scale-105 hover:border-primary/50"
            >
              <TrendingUp className="mr-2 h-4 w-4 transition-transform group-hover:scale-110" />
              Browse IPOs
            </Button>
          </Link>
        </div>

        {/* Suggestions */}
        <div className="pt-8 border-t animate-in fade-in slide-in-from-bottom-4 duration-700 delay-450">
          <h3 className="text-sm font-medium mb-4 text-muted-foreground">
            Popular Pages
          </h3>
          <div className="flex flex-wrap gap-2 justify-center">
            {[
              { label: 'Active IPOs', href: '/dashboard?status=OPEN' },
              { label: 'Lot Calculator', href: '/tools/lot-calculator' },
              { label: 'Compare IPOs', href: '/tools/compare' },
              { label: 'IPO History', href: '/history' },
              { label: 'Market Holidays', href: '/market-holidays' },
            ].map((item) => (
              <Link key={item.href} href={item.href} passHref>
                <Button
                  variant="ghost"
                  size="sm"
                  className="transition-all duration-300 hover:scale-105 hover:bg-primary/10"
                >
                  {item.label}
                </Button>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}