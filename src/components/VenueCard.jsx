import { useState } from 'react'
import { MapPin, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { formatShowDate } from '../lib/utils'
import ShowCard from './ShowCard'

export default function VenueCard({ venue, shows = [] }) {
  const [expanded, setExpanded] = useState(false)
  const preview = shows.slice(0, 3)
  const rest = shows.slice(3)
  const nextShow = shows[0]

  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#111111] overflow-hidden">
      <div
        className="p-5 cursor-pointer hover:bg-[#161616] transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="font-display font-bold text-2xl text-white tracking-wide truncate">
                {venue.name}
              </h2>
              <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-mono bg-[#e53e3e]/10 text-[#e53e3e] border border-[#e53e3e]/20">
                {shows.length} {shows.length === 1 ? 'show' : 'shows'}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-[#666] font-mono">
              <MapPin size={11} />
              {venue.location}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {venue.url && (
              <a
                href={venue.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded text-[#555] hover:text-[#e53e3e] transition-colors"
                onClick={e => e.stopPropagation()}
              >
                <ExternalLink size={14} />
              </a>
            )}
            {expanded ? (
              <ChevronUp size={18} className="text-[#555]" />
            ) : (
              <ChevronDown size={18} className="text-[#555]" />
            )}
          </div>
        </div>

        {nextShow && !expanded && (
          <p className="mt-2 text-xs font-mono text-[#555]">
            Next: <span className="text-[#e53e3e]">{formatShowDate(nextShow.date)}</span>
            {' — '}{nextShow.title}
          </p>
        )}
      </div>

      {expanded && (
        <div className="border-t border-[#2a2a2a] p-4 space-y-3">
          {shows.length === 0 ? (
            <p className="text-sm text-[#555] font-mono text-center py-4">No upcoming shows found</p>
          ) : (
            shows.map(show => (
              <ShowCard key={show.id} show={show} venueName={venue.name} />
            ))
          )}
        </div>
      )}

      {!expanded && preview.length > 0 && (
        <div className="border-t border-[#2a2a2a] px-4 py-3 space-y-2">
          {preview.map(show => (
            <ShowCard key={show.id} show={show} venueName={venue.name} compact />
          ))}
          {rest.length > 0 && (
            <button
              onClick={() => setExpanded(true)}
              className="w-full text-xs font-mono text-[#555] hover:text-[#e53e3e] transition-colors py-1"
            >
              +{rest.length} more show{rest.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
