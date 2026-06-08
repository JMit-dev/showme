import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { RefreshCw, Music, AlertCircle } from 'lucide-react'
import { useShows } from './hooks/useShows'
import { getAllShows, filterShows } from './lib/utils'
import ShowCard from './components/ShowCard'
import VenueCard from './components/VenueCard'
import FilterBar from './components/FilterBar'
import { VenueCardSkeleton } from './components/SkeletonCard'

const TABS = [
  { id: 'all', label: 'All Shows' },
  { id: 'venues', label: 'By Venue' },
  { id: 'week', label: 'This Week' },
]

export default function App() {
  const { data, isLoading, isError, refetch, isFetching } = useShows()
  const [activeTab, setActiveTab] = useState('all')
  const [filters, setFilters] = useState({ venueIds: [], dateRange: 'all', search: '' })

  const venues = data?.venues ? Object.values(data.venues) : []
  const allShows = getAllShows(data?.venues)

  const activeFilters = activeTab === 'week'
    ? { ...filters, dateRange: 'week' }
    : filters

  const filteredShows = filterShows(allShows, activeFilters)

  const lastUpdated = data?.lastUpdated
    ? (() => {
        try { return format(parseISO(data.lastUpdated), 'MMM d, h:mm a') } catch { return null }
      })()
    : null

  return (
    <div className="min-h-screen bg-[#0d0d0d]">
      <header className="border-b border-[#2a2a2a] bg-[#0d0d0d]/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#e53e3e] flex items-center justify-center">
                <Music size={16} className="text-white" />
              </div>
              <div>
                <h1 className="font-display font-black text-2xl text-white tracking-widest uppercase">
                  ShowMe
                </h1>
                <p className="text-[10px] font-mono text-[#555] -mt-0.5 uppercase tracking-widest">
                  LI Rock & Metal
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {lastUpdated && (
                <span className="hidden sm:block text-[10px] font-mono text-[#444]">
                  Updated {lastUpdated}
                </span>
              )}
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                className="p-2 rounded-lg border border-[#2a2a2a] text-[#555] hover:text-[#e53e3e] hover:border-[#e53e3e]/30 transition-colors disabled:opacity-40"
              >
                <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex gap-1 mb-2 p-1 rounded-xl bg-[#111111] border border-[#2a2a2a] w-fit">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-mono transition-colors ${
                activeTab === tab.id
                  ? 'bg-[#e53e3e] text-white'
                  : 'text-[#666] hover:text-[#e8e8e8]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab !== 'week' && (
          <FilterBar
            venues={venues}
            filters={filters}
            onFilterChange={setFilters}
          />
        )}

        {activeTab === 'week' && (
          <div className="py-3 mb-1">
            <p className="text-xs font-mono text-[#555]">
              Shows in the next 7 days across all Long Island venues
            </p>
          </div>
        )}

        {isLoading && (
          <div className="space-y-4 mt-4">
            {[...Array(3)].map((_, i) => <VenueCardSkeleton key={i} />)}
          </div>
        )}

        {isError && !isLoading && (
          <div className="mt-8 flex flex-col items-center gap-4 text-center">
            <AlertCircle size={40} className="text-[#e53e3e]/50" />
            <div>
              <p className="font-display font-bold text-xl text-[#e8e8e8]">Couldn&apos;t load shows</p>
              <p className="text-sm text-[#555] font-mono mt-1">Check your connection or try again</p>
            </div>
            <button
              onClick={() => refetch()}
              className="px-4 py-2 rounded-lg bg-[#e53e3e] hover:bg-[#c53030] text-white text-sm font-mono transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {!isLoading && !isError && (activeTab === 'all' || activeTab === 'week') && (
          <div>
            {filteredShows.length === 0 ? (
              <div className="mt-12 text-center">
                <p className="font-display font-bold text-2xl text-[#333]">No shows found</p>
                <p className="text-sm font-mono text-[#444] mt-2">
                  {activeTab === 'week' ? 'Nothing on the calendar this week.' : 'Try adjusting your filters.'}
                </p>
                {activeTab !== 'week' && (
                  <button
                    onClick={() => setFilters({ venueIds: [], dateRange: 'all', search: '' })}
                    className="mt-4 px-4 py-2 rounded-lg border border-[#2a2a2a] text-sm font-mono text-[#666] hover:text-[#e8e8e8] transition-colors"
                  >
                    Reset filters
                  </button>
                )}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredShows.map(show => (
                  <ShowCard key={show.id} show={show} venueName={show.venueName} />
                ))}
              </div>
            )}
          </div>
        )}

        {!isLoading && !isError && activeTab === 'venues' && (
          <div className="space-y-4 mt-2">
            {venues.length === 0 ? (
              <div className="mt-12 text-center">
                <p className="font-display font-bold text-2xl text-[#333]">No venue data yet</p>
                <p className="text-sm font-mono text-[#444] mt-2">Run the scraper to populate shows.</p>
              </div>
            ) : (
              venues
                .filter(venue => {
                  if (!filters.venueIds.length) return true
                  return filters.venueIds.includes(venue.id)
                })
                .map(venue => {
                  const vShows = filterShows(
                    (venue.shows || []).map(s => ({ ...s, venueId: venue.id, venueName: venue.name })),
                    filters
                  )
                  return (
                    <VenueCard
                      key={venue.id}
                      venue={venue}
                      shows={vShows}
                    />
                  )
                })
            )}
          </div>
        )}
      </main>

      <footer className="mt-16 border-t border-[#1a1a1a] py-6 text-center">
        <p className="text-xs font-mono text-[#333]">
          showme · LI rock & metal shows · data updated nightly
        </p>
      </footer>
    </div>
  )
}
