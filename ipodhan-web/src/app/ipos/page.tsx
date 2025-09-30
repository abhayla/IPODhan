import Navigation from '@/components/Navigation'
import IPOFilters from '@/components/IPOFilters'
import IPOTable from '@/components/IPOTable'

export default function IPOsPage() {
  return (
    <>
      <Navigation />
      <main className="bg-gray-50 min-h-screen">
        <div className="container py-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">
            All IPOs
          </h1>
          <IPOFilters />
          <IPOTable />
        </div>
      </main>
    </>
  )
}