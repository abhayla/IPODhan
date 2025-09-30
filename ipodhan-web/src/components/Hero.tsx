export default function Hero() {
  return (
    <section className="bg-gradient-to-b from-primary-50 to-white py-20">
      <div className="container">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl font-bold text-gray-900 mb-6">
            Your Gateway to <span className="text-primary-600">Smart IPO Investments</span>
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Track live IPOs, analyze grey market premiums, compare brokers, and make informed investment decisions with India's premier IPO platform.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <button className="btn-primary px-8 py-4 text-lg">
              Track Live IPOs
            </button>
            <button className="btn-secondary px-8 py-4 text-lg">
              Check GMP Rates
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div>
              <div className="text-3xl font-bold text-primary-600">500+</div>
              <div className="text-gray-600">IPOs Tracked</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary-600">₹2.5Cr+</div>
              <div className="text-gray-600">Investments Guided</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary-600">50K+</div>
              <div className="text-gray-600">Active Users</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary-600">15+</div>
              <div className="text-gray-600">Partner Brokers</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}