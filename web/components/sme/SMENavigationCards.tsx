/**
 * SME Navigation Cards Component
 *
 * Displays 4 navigation cards linking to SME IPO dedicated pages:
 * 1. SME IPO Performance Tracker
 * 2. SME IPO Prospectus
 * 3. SME IPO HiCalendar
 * 4. SME IPO Reviews
 *
 * Story 9.16: SME IPOs Landing Page
 * AC#6: Four navigation cards displayed with links to dedicated pages
 * AC#20: Responsive (1 col mobile, 2 col tablet, 4 col desktop)
 */

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { HiArrowTrendingUp, HiDocumentText, HiCalendar, HiStar } from 'react-icons/hi2';

const navigationCards = [
  {
    id: 'performance-tracker',
    icon: HiArrowTrendingUp,
    title: 'Performance Tracker',
    description: 'Track post-listing performance of SME IPOs',
    href: '/sme-ipo-performance-tracker',
    iconColor: 'text-blue-600',
    bgColor: 'bg-blue-50',
  },
  {
    id: 'prospectus',
    icon: HiDocumentText,
    title: 'IPO Prospectus',
    description: 'Download DRHP and RHP documents',
    href: '/sme-ipo-prospectus',
    iconColor: 'text-green-600',
    bgColor: 'bg-green-50',
  },
  {
    id: 'calendar',
    icon: HiCalendar,
    title: 'IPO Calendar',
    description: 'View SME IPO events and timelines',
    href: '/sme-ipo-calendar',
    iconColor: 'text-purple-600',
    bgColor: 'bg-purple-50',
  },
  {
    id: 'reviews',
    icon: HiStar,
    title: 'IPO Reviews & Analysis',
    description: 'Expert recommendations and analysis',
    href: '/sme-ipo-reviews',
    iconColor: 'text-orange-600',
    bgColor: 'bg-orange-50',
  },
];

export function SMENavigationCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {navigationCards.map((card) => {
        const Icon = card.icon;
        return (
          <Link key={card.id} href={card.href} className="block group">
            <Card className="h-full transition-all duration-200 hover:shadow-lg hover:scale-105 hover:border-gray-400 cursor-pointer">
              <CardContent className="p-6">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className={`p-4 rounded-full ${card.bgColor}`}>
                    <Icon className={`h-8 w-8 ${card.iconColor}`} />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">
                      {card.title}
                    </h3>
                    <p className="text-sm text-gray-600">{card.description}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
