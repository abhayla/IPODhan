import { Metadata } from 'next';
import { BookOpen, FileText, Video, Download, ExternalLink, Calculator, ChartBar, Newspaper, GraduationCap } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Resources - IPODhan',
  description: 'Educational resources, guides, and tools to help you understand and invest in IPOs effectively.',
};

export default function ResourcesPage() {
  const guides = [
    {
      title: 'IPO Basics: A Beginner\'s Guide',
      description: 'Everything you need to know about Initial Public Offerings',
      icon: BookOpen,
      topics: ['What is an IPO?', 'Types of IPOs', 'IPO Process', 'How to Apply'],
      difficulty: 'Beginner',
      readTime: '15 min',
    },
    {
      title: 'Understanding IPO Financials',
      description: 'Learn how to analyze financial statements in DRHP',
      icon: ChartBar,
      topics: ['Reading DRHP', 'Key Financial Metrics', 'Valuation Methods', 'Risk Analysis'],
      difficulty: 'Intermediate',
      readTime: '25 min',
    },
    {
      title: 'IPO Allotment Process',
      description: 'Complete guide to IPO allotment and listing',
      icon: FileText,
      topics: ['Allotment Rules', 'Basis of Allotment', 'Checking Status', 'Listing Day Strategy'],
      difficulty: 'Beginner',
      readTime: '10 min',
    },
    {
      title: 'Advanced IPO Strategies',
      description: 'Professional techniques for IPO investments',
      icon: GraduationCap,
      topics: ['GMP Analysis', 'Subscription Patterns', 'Exit Strategies', 'Portfolio Management'],
      difficulty: 'Advanced',
      readTime: '30 min',
    },
  ];

  const tools = [
    {
      title: 'Lot Size Calculator',
      description: 'Calculate how many lots you can buy with your investment amount',
      icon: Calculator,
      href: '/tools/lot-calculator',
      badge: 'Popular',
    },
    {
      title: 'IPO Comparison Tool',
      description: 'Compare multiple IPOs side-by-side',
      icon: ChartBar,
      href: '/tools/compare',
      badge: 'New',
    },
  ];

  const downloads = [
    {
      title: 'IPO Checklist',
      description: 'Essential points to check before investing',
      format: 'PDF',
      size: '245 KB',
    },
    {
      title: 'IPO Glossary',
      description: 'Common terms and definitions',
      format: 'PDF',
      size: '380 KB',
    },
    {
      title: 'Investment Tracker',
      description: 'Excel template to track your IPO investments',
      format: 'XLSX',
      size: '125 KB',
    },
  ];

  const videos = [
    {
      title: 'How to Apply for an IPO',
      duration: '8:45',
      views: '12.5K',
    },
    {
      title: 'Understanding Grey Market Premium',
      duration: '12:30',
      views: '8.3K',
    },
    {
      title: 'IPO Allotment Explained',
      duration: '10:15',
      views: '15.2K',
    },
  ];

  const news = [
    {
      title: 'SEBI Updates IPO Listing Timeline',
      date: 'Jan 8, 2025',
      category: 'Regulation',
    },
    {
      title: 'Record IPO Fundraising in 2024',
      date: 'Jan 5, 2025',
      category: 'Market Update',
    },
    {
      title: 'New UPI Payment Limit for IPO Applications',
      date: 'Jan 2, 2025',
      category: 'Policy',
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white dark:from-gray-950 dark:to-gray-900">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-50 to-blue-100 dark:from-purple-950/20 dark:to-blue-950/20" />
        <div className="relative container mx-auto px-4 py-20">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-5xl font-bold text-gray-900 dark:text-gray-100 mb-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
              IPO Resources
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-400 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
              Learn, analyze, and make informed IPO investment decisions
            </p>
          </div>
        </div>
      </section>

      {/* Educational Guides */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <BookOpen className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Educational Guides</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {guides.map((guide, index) => (
              <div
                key={index}
                className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm hover:shadow-lg transition-all duration-300 cursor-pointer group"
              >
                <div className="flex items-start justify-between mb-4">
                  <guide.icon className="h-10 w-10 text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-transform duration-300" />
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      guide.difficulty === 'Beginner' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                      guide.difficulty === 'Intermediate' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    }`}>
                      {guide.difficulty}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{guide.readTime}</span>
                  </div>
                </div>
                <h3 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {guide.title}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mb-4">{guide.description}</p>
                <div className="space-y-1">
                  {guide.topics.map((topic, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                      <span className="w-1 h-1 bg-blue-600 dark:bg-blue-400 rounded-full" />
                      {topic}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tools Section */}
      <section className="bg-gray-50 dark:bg-gray-900/50 py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center gap-3 mb-8">
              <Calculator className="h-8 w-8 text-green-600 dark:text-green-400" />
              <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100">IPO Tools</h2>
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              {tools.map((tool, index) => (
                <a
                  key={index}
                  href={tool.href}
                  className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm hover:shadow-lg transition-all duration-300 group flex items-start justify-between"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <tool.icon className="h-8 w-8 text-green-600 dark:text-green-400 group-hover:scale-110 transition-transform duration-300" />
                      {tool.badge && (
                        <span className="text-xs px-2 py-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full">
                          {tool.badge}
                        </span>
                      )}
                    </div>
                    <h3 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100 group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors">
                      {tool.title}
                    </h3>
                    <p className="text-gray-600 dark:text-gray-400">{tool.description}</p>
                  </div>
                  <ExternalLink className="h-5 w-5 text-gray-400 group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Downloads Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <Download className="h-8 w-8 text-purple-600 dark:text-purple-400" />
            <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Free Downloads</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {downloads.map((download, index) => (
              <div
                key={index}
                className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm hover:shadow-lg transition-all duration-300 cursor-pointer group"
              >
                <div className="flex items-start justify-between mb-4">
                  <FileText className="h-8 w-8 text-purple-600 dark:text-purple-400" />
                  <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 rounded">
                    {download.format}
                  </span>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                  {download.title}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{download.description}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 dark:text-gray-400">{download.size}</span>
                  <Download className="h-4 w-4 text-purple-600 dark:text-purple-400 group-hover:animate-bounce" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Video Tutorials */}
      <section className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20 py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center gap-3 mb-8">
              <Video className="h-8 w-8 text-red-600 dark:text-red-400" />
              <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Video Tutorials</h2>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              {videos.map((video, index) => (
                <div
                  key={index}
                  className="bg-white dark:bg-gray-800 rounded-xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 cursor-pointer group"
                >
                  <div className="aspect-video bg-gradient-to-br from-red-100 to-pink-100 dark:from-red-900/30 dark:to-pink-900/30 flex items-center justify-center">
                    <div className="bg-white dark:bg-gray-700 rounded-full p-4 group-hover:scale-110 transition-transform duration-300">
                      <Video className="h-8 w-8 text-red-600 dark:text-red-400" />
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">
                      {video.title}
                    </h3>
                    <div className="flex items-center justify-between mt-2 text-sm text-gray-500 dark:text-gray-400">
                      <span>{video.duration}</span>
                      <span>{video.views} views</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Latest News */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <Newspaper className="h-8 w-8 text-orange-600 dark:text-orange-400" />
            <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Latest IPO News</h2>
          </div>
          <div className="space-y-4">
            {news.map((item, index) => (
              <div
                key={index}
                className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer group flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-xs px-2 py-1 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 rounded">
                      {item.category}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{item.date}</span>
                  </div>
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">
                    {item.title}
                  </h3>
                </div>
                <ExternalLink className="h-5 w-5 text-gray-400 group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-gradient-to-br from-blue-600 to-purple-600 py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl font-bold text-white mb-6">
              Stay Updated with IPO Knowledge
            </h2>
            <p className="text-blue-100 mb-8">
              Get the latest IPO guides, market updates, and investment strategies delivered to your inbox.
            </p>
            <div className="flex gap-4 justify-center">
              <input
                type="email"
                placeholder="Enter your email"
                className="px-6 py-3 rounded-lg bg-white/10 backdrop-blur border border-white/20 text-white placeholder-white/60 focus:outline-none focus:border-white/40 min-w-[300px]"
              />
              <button className="bg-white text-blue-600 px-8 py-3 rounded-lg hover:bg-blue-50 transition-colors duration-200 font-semibold">
                Subscribe
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}