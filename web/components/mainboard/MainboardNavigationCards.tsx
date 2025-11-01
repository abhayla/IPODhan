/**
 * Mainboard Navigation Cards Component
 *
 * Displays 4 navigation cards linking to dedicated Mainboard IPO pages:
 * 1. Mainboard IPO Performance Tracker
 * 2. Mainboard IPO Prospectus
 * 3. Mainboard IPO HiCalendar
 * 4. Mainboard IPO Reviews
 *
 * Each card is fully clickable with hover effects.
 * Server component with responsive grid layout.
 *
 * Story 9.15 - AC#6: Four navigation cards displayed with links to dedicated pages
 */

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { HiArrowTrendingUp, HiDocumentText, HiCalendar, HiStar } from 'react-icons/hi2';

interface NavigationCard {
  id: string;
  title: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  bgColor: string;
}

const navigationCards: NavigationCard[] = [
  {
    id: 'performance-tracker',
    title: 'Performance Tracker',
    description: 'Track post-listing performance of Mainboard IPOs',
    href: '/mainboard-ipo-performance-tracker',
    icon: HiArrowTrendingUp,
    iconColor: 'text-green-600',
    bgColor: 'bg-green-50',
  },
  {
    id: 'prospectus',
    title: 'IPO Prospectus',
    description: 'Download DRHP and RHP documents',
    href: '/mainboard-ipo-prospectus',
    icon: HiDocumentText,
    iconColor: 'text-blue-600',
    bgColor: 'bg-blue-50',
  },
  {
    id: 'calendar',
    title: 'IPO Calendar',
    description: 'View Mainboard IPO events and timelines',
    href: '/mainboard-ipo-calendar',
    icon: HiCalendar,
    iconColor: 'text-purple-600',
    bgColor: 'bg-purple-50',
  },
  {
    id: 'reviews',
    title: 'IPO Reviews & Analysis',
    description: 'Expert recommendations and analysis',
    href: '/mainboard-ipo-reviews',
    icon: HiStar,
    iconColor: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
  },
];

/**
 * Mainboard Navigation Cards Component
 */
export function MainboardNavigationCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {navigationCards.map((card) => {
        const Icon = card.icon;
        return (
          <Link key={card.id} href={card.href} className="group">
            <Card className="h-full transition-all duration-200 hover:shadow-lg hover:border-blue-400 cursor-pointer">
              <CardHeader>
                <div className="flex items-center justify-center mb-3">
                  <div className={`p-4 rounded-full ${card.bgColor} group-hover:scale-110 transition-transform`}>
                    <Icon className={`h-8 w-8 ${card.iconColor}`} />
                  </div>
                </div>
                <CardTitle className="text-center text-lg group-hover:text-blue-600 transition-colors">
                  {card.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-center text-sm">
                  {card.description}
                </CardDescription>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
