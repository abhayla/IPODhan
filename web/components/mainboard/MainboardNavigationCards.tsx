/**
 * Mainboard Navigation Cards Component
 *
 * Displays 4 navigation cards linking to dedicated Mainboard IPO pages.
 * Server component - static navigation links.
 */

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart3, FileText, Calendar, Star } from 'lucide-react';

export function MainboardNavigationCards() {
  const navigationCards = [
    {
      title: 'Performance Tracker',
      description: 'Track post-listing performance of Mainboard IPOs',
      href: '/mainboard-ipo-performance-tracker',
      icon: BarChart3,
    },
    {
      title: 'IPO Prospectus',
      description: 'Download DRHP and RHP documents',
      href: '/mainboard-ipo-prospectus',
      icon: FileText,
    },
    {
      title: 'IPO Calendar',
      description: 'View Mainboard IPO events and timelines',
      href: '/mainboard-ipo-calendar',
      icon: Calendar,
    },
    {
      title: 'IPO Reviews & Analysis',
      description: 'Expert recommendations and analysis',
      href: '/mainboard-ipo-reviews',
      icon: Star,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {navigationCards.map((card) => (
        <Link key={card.href} href={card.href} className="group">
          <Card className="hover:shadow-lg hover:border-blue-600 transition-all cursor-pointer">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors">
                  <card.icon className="h-6 w-6 text-blue-600" />
                </div>
                <CardTitle className="text-lg">{card.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-sm">{card.description}</CardDescription>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
