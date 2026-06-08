import { ExternalLink, Clock, DollarSign, Users } from 'lucide-react'
import { formatShowDate } from '../lib/utils'

export default function ShowCard({ show, venueName, compact = false }) {
  return (
    <div className={`relative overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#111111] hover:border-[#e53e3e]/40 transition-all duration-200 group ${compact ? 'p-3' : 'p-4'}`}>
      {show.imageUrl && !compact && (
        <div className="mb-3 -mx-4 -mt-4 h-40 overflow-hidden">
          <img
            src={show.imageUrl}
            alt={show.title}
            loading="lazy"
            className="w-full h-full object-cover opacity-70 group-hover:opacity-90 transition-opacity duration-200"
          />
          <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-transparent to-[#111111]" />
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className={`font-display font-bold leading-tight text-[#e8e8e8] group-hover:text-white transition-colors ${compact ? 'text-base' : 'text-xl'}`}>
            {show.title || 'TBA'}
          </h3>
          {show.ticketUrl && (
            <a
              href={show.ticketUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-xs font-mono bg-[#e53e3e] hover:bg-[#c53030] text-white transition-colors"
              onClick={e => e.stopPropagation()}
            >
              <ExternalLink size={10} />
              Tickets
            </a>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono text-[#888888]">
          <span className="text-[#e53e3e] font-bold">{formatShowDate(show.date)}</span>

          {show.time && (
            <span className="flex items-center gap-1">
              <Clock size={10} />
              {show.time}
              {show.doors && <span className="text-[#555]">· Doors {show.doors}</span>}
            </span>
          )}

          {!compact && venueName && (
            <span className="text-[#666]">{venueName}</span>
          )}
        </div>

        {!compact && (
          <div className="flex flex-wrap gap-1.5">
            {show.price && (
              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs border border-[#2a2a2a] text-[#888] font-mono">
                <DollarSign size={10} />
                {show.price.replace(/^\$/, '')}
              </span>
            )}
            {show.ages && (
              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs border border-[#2a2a2a] text-[#888] font-mono">
                <Users size={10} />
                {show.ages}
              </span>
            )}
          </div>
        )}

        {show.description && !compact && (
          <p className="text-xs text-[#666] line-clamp-2 leading-relaxed">{show.description}</p>
        )}
      </div>
    </div>
  )
}
