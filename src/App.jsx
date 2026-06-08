import { useState, useCallback } from 'react'
import { format, parseISO, addDays } from 'date-fns'
import { Search, X, Music, MapPin } from 'lucide-react'
import { useShows, useVenues } from './hooks/useShows'
import { getAllShows, filterShows } from './lib/utils'
import MapView from './components/MapView'
import ShowRow from './components/ShowRow'

const DATE_FILTERS = [
  { value: 'all',   label: 'All'   },
  { value: 'today', label: 'Today' },
  { value: 'week',  label: 'Week'  },
  { value: 'month', label: 'Month' },
]

function groupByDate(shows) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd')

  const groups = new Map()
  for (const show of shows) {
    const date = show.date
    if (!date) continue
    if (!groups.has(date)) groups.set(date, [])
    groups.get(date).push(show)
  }

  return [...groups.entries()].map(([date, shows]) => {
    let prefix
    if (date === today) prefix = 'Today · '
    else if (date === tomorrow) prefix = 'Tomorrow · '
    else prefix = ''
    let label
    try { label = prefix + format(parseISO(date), 'EEE, MMM d') }
    catch { label = date }
    return { date, label, shows }
  })
}

export default function App() {
  const { data: showsData, isLoading, isError, refetch } = useShows()
  const { data: venuesData } = useVenues()

  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('all')
  const [selectedVenueId, setSelectedVenueId] = useState(null)
  const [mapVisible, setMapVisible] = useState(true)

  const allVenuesFromRegistry = venuesData?.venues || []
  const showVenues = showsData?.venues ? Object.values(showsData.venues) : []
  const mapVenues = allVenuesFromRegistry.length > 0 ? allVenuesFromRegistry : showVenues

  const allShows = getAllShows(showsData?.venues)
  const filteredShows = filterShows(allShows, {
    venueIds: selectedVenueId ? [selectedVenueId] : [],
    dateRange: dateFilter,
    search,
  })
  const showGroups = groupByDate(filteredShows)

  const selectedVenueName = selectedVenueId
    ? (mapVenues.find(v => v.id === selectedVenueId)?.name || showsData?.venues?.[selectedVenueId]?.name)
    : null

  const handleVenueClick = useCallback((venueId) => {
    setSelectedVenueId(prev => prev === venueId ? null : venueId)
  }, [])

  const clearVenue = useCallback(() => setSelectedVenueId(null), [])

  const totalCount = filteredShows.length

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#0d0d0d]">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="flex-none bg-[#0a0a0a] border-b border-[#1e1e1e] z-50">
        {/* Row 1: logo + search + filters (single row on md+, wraps on mobile) */}
        <div className="px-3 py-2 flex flex-wrap items-center gap-2">
          {/* Logo */}
          <div className="flex items-center gap-2 flex-none">
            <div className="w-6 h-6 rounded bg-[#e53e3e] flex items-center justify-center">
              <Music size={11} className="text-white" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-display font-black text-white text-sm tracking-widest uppercase">
                ShowMe
              </span>
              <span className="text-[#333] text-[8px] font-mono uppercase tracking-widest hidden sm:block">
                LI Show Tracker
              </span>
            </div>
          </div>

          {/* Search — grows to fill available space */}
          <div className="relative flex-1 min-w-[120px]">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#3a3a3a]" />
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-7 pr-6 py-1.5 bg-[#131313] border border-[#222] rounded text-xs text-[#e0e0e0] placeholder-[#3a3a3a] focus:outline-none focus:border-[#e53e3e]/30 transition-colors"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#444] hover:text-[#888]">
                <X size={10} />
              </button>
            )}
          </div>

          {/* Date filters */}
          <div className="flex gap-0.5 flex-none">
            {DATE_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setDateFilter(value)}
                className={`px-2 py-1.5 rounded text-[11px] font-mono transition-colors ${
                  dateFilter === value
                    ? 'bg-[#e53e3e] text-white'
                    : 'text-[#444] hover:text-[#aaa]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Body: Map + List ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">

        {/* Map panel */}
        <div
          className={`flex-none border-b lg:border-b-0 lg:border-r border-[#1a1a1a] transition-all duration-300 lg:w-[45%] ${
            mapVisible ? 'h-[220px] sm:h-[280px] lg:h-full' : 'h-0 lg:h-full lg:w-0 overflow-hidden'
          }`}
        >
          <MapView
            allVenues={mapVenues}
            showsData={showsData}
            selectedVenueId={selectedVenueId}
            onVenueClick={handleVenueClick}
          />
        </div>

        {/* List panel */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* List toolbar */}
          <div className="flex-none flex items-center gap-2 px-4 py-1.5 border-b border-[#1a1a1a] bg-[#0a0a0a]">
            {/* Mobile map toggle */}
            <button
              onClick={() => setMapVisible(v => !v)}
              className="lg:hidden flex items-center gap-1 text-[10px] font-mono text-[#444] hover:text-[#888] transition-colors"
            >
              <MapPin size={10} />
              {mapVisible ? 'Hide map' : 'Show map'}
            </button>

            {selectedVenueName ? (
              <div className="flex items-center gap-1.5 text-xs font-mono">
                <MapPin size={10} className="text-[#e53e3e]" />
                <span className="text-[#e53e3e]">{selectedVenueName}</span>
                <button onClick={clearVenue} className="text-[#444] hover:text-[#888] ml-1">
                  <X size={11} />
                </button>
              </div>
            ) : (
              <span className="text-[10px] font-mono text-[#2a2a2a]">
                {isLoading ? 'Loading…' : `${totalCount} show${totalCount !== 1 ? 's' : ''}`}
              </span>
            )}
          </div>

          {/* Show list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading && (
              <div className="flex items-center justify-center h-32 text-[#333] text-sm font-mono">
                Loading shows…
              </div>
            )}

            {isError && (
              <div className="flex flex-col items-center justify-center h-32 gap-3">
                <p className="text-[#555] text-sm font-mono">Couldn't load shows</p>
                <button
                  onClick={() => refetch()}
                  className="px-3 py-1.5 rounded bg-[#e53e3e] text-white text-xs font-mono hover:bg-[#c53030] transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {!isLoading && !isError && showGroups.length === 0 && (
              <div className="flex flex-col items-center justify-center h-32 gap-2">
                <p className="text-[#333] text-sm font-mono">No shows found</p>
                {(search || selectedVenueId || dateFilter !== 'all') && (
                  <button
                    onClick={() => { setSearch(''); clearVenue(); setDateFilter('all') }}
                    className="text-[10px] font-mono text-[#444] hover:text-[#888] underline underline-offset-2"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}

            {!isLoading && !isError && showGroups.map(({ date, label, shows }) => (
              <div key={date}>
                <div className="sticky top-0 z-10 px-4 py-1.5 bg-[#0a0a0a]/95 backdrop-blur-sm border-b border-[#1a1a1a]">
                  <span className="text-[10px] font-mono font-bold text-[#e53e3e] uppercase tracking-widest">
                    {label}
                  </span>
                </div>
                {shows.map(show => (
                  <ShowRow key={show.id} show={show} onVenueClick={handleVenueClick} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
