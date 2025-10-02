import React from 'react';

export interface HeroProps {
  liveIPOCount: number;
  topIPO?: {
    name: string;
    score: number;
  };
  onSearch: (query: string) => void;
}

/**
 * Hero Component
 * Hero section for homepage with tagline and widgets
 */
export const Hero: React.FC<HeroProps> = ({ liveIPOCount, topIPO, onSearch }) => {
  const [searchQuery, setSearchQuery] = React.useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchQuery);
  };

  return (
    <section
      className="bg-gradient-to-br from-primary-600 to-primary-800 text-white py-16 px-4"
      aria-label="Hero section"
    >
      <div className="max-w-7xl mx-auto">
        {/* Tagline */}
        <div className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            India's Smartest IPO Platform
          </h1>
          <p className="text-xl md:text-2xl text-primary-100">
            Data-driven insights for smarter IPO investments
          </p>
        </div>

        {/* Widgets */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Live IPO Count */}
          <div className="bg-white bg-opacity-10 backdrop-blur-sm rounded-lg p-6 border border-white border-opacity-20">
            <p className="text-primary-100 text-sm mb-2">Live IPOs</p>
            <p className="text-5xl font-bold">{liveIPOCount}</p>
          </div>

          {/* Top IPO */}
          {topIPO && (
            <div className="bg-white bg-opacity-10 backdrop-blur-sm rounded-lg p-6 border border-white border-opacity-20">
              <p className="text-primary-100 text-sm mb-2">Today's Top IPO</p>
              <p className="text-xl font-semibold mb-1">{topIPO.name}</p>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{topIPO.score}</span>
                <span className="text-primary-100 text-sm">/100 Score</span>
              </div>
            </div>
          )}
        </div>

        {/* Quick Search */}
        <div className="max-w-2xl mx-auto">
          <form onSubmit={handleSearch} className="relative">
            <input
              type="text"
              placeholder="Search IPOs by company name, symbol, or sector..."
              className="w-full px-6 py-4 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-300"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              aria-label="Search IPOs"
            />
            <button
              type="submit"
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-primary-600 text-white px-6 py-2 rounded-lg hover:bg-primary-700 transition-colors"
              aria-label="Submit search"
            >
              Search
            </button>
          </form>
        </div>
      </div>
    </section>
  );
};
