import { Search, X } from 'lucide-react'

const DATE_RANGES = [
  { value: 'all', label: 'All Dates' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
]

export default function FilterBar({ venues = [], filters, onFilterChange }) {
  const { venueIds = [], dateRange = 'all', search = '' } = filters

  function toggleVenue(id) {
    const next = venueIds.includes(id)
      ? venueIds.filter(v => v !== id)
      : [...venueIds, id]
    onFilterChange({ ...filters, venueIds: next })
  }

  function resetFilters() {
    onFilterChange({ venueIds: [], dateRange: 'all', search: '' })
  }

  const hasActiveFilters = venueIds.length > 0 || dateRange !== 'all' || search

  return (
    <div className="space-y-3 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
          <input
            type="text"
            placeholder="Search shows or venues..."
            value={search}
            onChange={e => onFilterChange({ ...filters, search: e.target.value })}
            className="w-full pl-9 pr-4 py-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-sm font-mono text-[#e8e8e8] placeholder-[#444] focus:outline-none focus:border-[#e53e3e]/50 transition-colors"
          />
          {search && (
            <button
              onClick={() => onFilterChange({ ...filters, search: '' })}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#e8e8e8]"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="flex gap-1">
          {DATE_RANGES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onFilterChange({ ...filters, dateRange: value })}
              className={`px-3 py-2 rounded-lg text-xs font-mono transition-colors ${
                dateRange === value
                  ? 'bg-[#e53e3e] text-white'
                  : 'bg-[#1a1a1a] border border-[#2a2a2a] text-[#888] hover:text-[#e8e8e8] hover:border-[#444]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {hasActiveFilters && (
          <button
            onClick={resetFilters}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-mono text-[#e53e3e] border border-[#e53e3e]/30 hover:bg-[#e53e3e]/10 transition-colors"
          >
            <X size={12} />
            Reset
          </button>
        )}
      </div>

      {venues.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {venues.map(venue => (
            <button
              key={venue.id}
              onClick={() => toggleVenue(venue.id)}
              className={`px-3 py-1 rounded-full text-xs font-mono transition-colors ${
                venueIds.includes(venue.id)
                  ? 'bg-[#e53e3e]/20 text-[#e53e3e] border border-[#e53e3e]/40'
                  : 'bg-[#1a1a1a] text-[#666] border border-[#2a2a2a] hover:text-[#888] hover:border-[#444]'
              }`}
            >
              {venue.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
