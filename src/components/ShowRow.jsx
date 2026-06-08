import { ExternalLink, Clock, MapPin } from 'lucide-react'
import { decodeHtml } from '../lib/utils'

export default function ShowRow({ show, onVenueClick }) {
  const { venueName, venueId, time, imageUrl, ticketUrl, price } = show
  const title = decodeHtml(show.title)

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[#111] hover:bg-[#111] transition-colors group">
      {/* Thumbnail */}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="w-9 h-9 rounded object-cover flex-none bg-[#1a1a1a]"
          loading="lazy"
          onError={e => { e.target.style.display = 'none' }}
        />
      ) : (
        <div className="w-9 h-9 rounded flex-none bg-[#141414] flex items-center justify-center">
          <span className="text-[#282828] text-xs">♪</span>
        </div>
      )}

      {/* Title + venue */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#d0d0d0] truncate leading-tight group-hover:text-white transition-colors">
          {title}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <button
            onClick={() => onVenueClick(venueId)}
            className="flex items-center gap-0.5 text-[10px] font-mono text-[#3a3a3a] hover:text-[#e53e3e] transition-colors"
          >
            <MapPin size={8} />
            <span className="truncate max-w-[120px] sm:max-w-[200px]">{venueName}</span>
          </button>
          {time && (
            <span className="flex items-center gap-0.5 text-[10px] font-mono text-[#2a2a2a]">
              <Clock size={8} />
              {time}
            </span>
          )}
        </div>
      </div>

      {/* Price + ticket */}
      <div className="flex items-center gap-2 flex-none">
        {price && (
          <span className="text-[10px] font-mono text-[#3a3a3a]">${price}</span>
        )}
        {ticketUrl && (
          <a
            href={ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-[#1a1a1a] text-[#555] hover:bg-[#e53e3e] hover:text-white transition-colors"
          >
            Tickets
            <ExternalLink size={9} />
          </a>
        )}
      </div>
    </div>
  )
}
