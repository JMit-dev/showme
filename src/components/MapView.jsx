import { useEffect, useRef, useState } from 'react'
import { Music } from 'lucide-react'
import { formatShowDate } from '../lib/utils'

// Leaflet is loaded dynamically to avoid SSR issues
let L = null

const LI_CENTER = [40.79, -73.13]
const LI_ZOOM = 10

function getMarkerColor(venue, showsData) {
  const venueShows = showsData?.venues?.[venue.id]
  if (!venue.scraper) return '#444444'           // map-only (gray)
  if (!venueShows) return '#555555'               // not yet scraped
  if (venueShows.error) return '#7a3030'          // scrape error (dark red)
  if (venueShows.shows?.length > 0) return '#e53e3e'  // has shows (red)
  return '#666666'                                // scraped, no upcoming shows
}

function createMarkerIcon(color) {
  return L.divIcon({
    html: `<div style="
      width: 14px; height: 14px;
      background: ${color};
      border: 2px solid ${color === '#e53e3e' ? '#ff6b6b' : '#333'};
      border-radius: 50%;
      box-shadow: 0 0 ${color === '#e53e3e' ? '6px rgba(229,62,62,0.6)' : '3px rgba(0,0,0,0.5)'};
      cursor: pointer;
    "></div>`,
    className: '',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })
}


export default function MapView({ allVenues = [], showsData }) {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markersRef = useRef([])
  const [leafletReady, setLeafletReady] = useState(false)
  const [stats, setStats] = useState({ total: 0, withShows: 0, mapOnly: 0 })

  // Dynamically load Leaflet CSS + JS (avoids bundling issues)
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Inject Leaflet CSS if not already present
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }

    import('leaflet').then(module => {
      L = module.default
      // Fix default marker icon path issue with bundlers
      delete L.Icon.Default.prototype._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })
      setLeafletReady(true)
    })
  }, [])

  // Initialize map once Leaflet is ready
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstanceRef.current) return

    mapInstanceRef.current = L.map(mapRef.current, {
      center: LI_CENTER,
      zoom: LI_ZOOM,
      zoomControl: true,
    })

    // Dark OpenStreetMap tiles via CartoDB Dark Matter (no API key)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(mapInstanceRef.current)
  }, [leafletReady])

  // Add/update markers whenever venues or show data changes
  useEffect(() => {
    if (!mapInstanceRef.current || !L || !leafletReady) return

    // Clear existing markers
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    const venuesWithCoords = allVenues.filter(v => v.coords && v.active)
    let withShows = 0
    let mapOnly = 0

    for (const venue of venuesWithCoords) {
      const venueShows = showsData?.venues?.[venue.id]
      const color = getMarkerColor(venue, showsData)
      if ((venueShows?.shows?.length || 0) > 0) withShows++
      if (!venue.scraper) mapOnly++

      const marker = L.marker(venue.coords, { icon: createMarkerIcon(color) })

      // Build popup content
      const popupContainer = document.createElement('div')
      popupContainer.style.cssText = 'background:#111;color:#e8e8e8;padding:12px;border-radius:8px;font-family:system-ui,sans-serif;'

      // Render popup HTML directly (no React in Leaflet popups)
      const upcoming = venueShows?.shows?.slice(0, 3) || []
      const total = venueShows?.shows?.length || 0

      popupContainer.innerHTML = `
        <div style="display:flex;align-items:start;justify-content:space-between;gap:8px;margin-bottom:8px">
          <strong style="font-size:14px;line-height:1.3;color:#fff;font-family:'Barlow Condensed',sans-serif;font-weight:700;letter-spacing:.5px">
            ${venue.name}
          </strong>
          ${venue.scraper && total > 0 ? `<span style="flex-shrink:0;padding:1px 6px;border-radius:999px;font-size:10px;font-family:monospace;background:rgba(229,62,62,.15);color:#e53e3e;border:1px solid rgba(229,62,62,.3)">${total}</span>` : ''}
        </div>
        <div style="font-size:11px;color:#888;font-family:monospace;margin-bottom:10px">📍 ${venue.location}</div>
        ${upcoming.length > 0
          ? upcoming.map(s => `
              <div style="margin-bottom:6px">
                <div style="font-size:12px;color:#e8e8e8;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px">${s.title}</div>
                <div style="font-size:10px;color:#e53e3e;font-family:monospace">${s.date}</div>
              </div>`).join('')
          : venue.scraper
            ? '<div style="font-size:11px;color:#555;font-family:monospace">No upcoming shows found</div>'
            : '<div style="font-size:11px;color:#555;font-family:monospace">Check their social pages for shows</div>'
        }
        ${total > 3 ? `<div style="font-size:10px;color:#555;font-family:monospace;margin-top:4px">+${total - 3} more shows</div>` : ''}
        <div style="display:flex;gap:8px;padding-top:8px;margin-top:8px;border-top:1px solid #2a2a2a">
          ${venue.url ? `<a href="${venue.url}" target="_blank" style="font-size:11px;color:#888;font-family:monospace;text-decoration:none" onmouseover="this.style.color='#e8e8e8'" onmouseout="this.style.color='#888'">↗ Website</a>` : ''}
          ${venue.facebook ? `<a href="${venue.facebook}" target="_blank" style="font-size:11px;color:#888;font-family:monospace;text-decoration:none" onmouseover="this.style.color='#4267B2'" onmouseout="this.style.color='#888'">fb</a>` : ''}
          ${venue.instagram ? `<a href="${venue.instagram}" target="_blank" style="font-size:11px;color:#888;font-family:monospace;text-decoration:none" onmouseover="this.style.color='#E1306C'" onmouseout="this.style.color='#888'">ig</a>` : ''}
        </div>
      `

      marker.bindPopup(L.popup({
        maxWidth: 280,
        className: 'showme-popup',
      }).setContent(popupContainer))

      marker.addTo(mapInstanceRef.current)
      markersRef.current.push(marker)
    }

    setStats({ total: venuesWithCoords.length, withShows, mapOnly })
  }, [allVenues, showsData, leafletReady])

  return (
    <div className="space-y-3">
      {/* Legend + stats */}
      <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-[#666]">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[#e53e3e] ring-1 ring-[#ff6b6b] inline-block" />
          Has upcoming shows ({stats.withShows})
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[#555] inline-block" />
          Scraped — no shows ({stats.total - stats.withShows - stats.mapOnly})
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[#333] border border-[#555] inline-block" />
          Map only — check social ({stats.mapOnly})
        </div>
      </div>

      {/* Map container */}
      <div className="relative rounded-xl overflow-hidden border border-[#2a2a2a]" style={{ height: '520px' }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%', background: '#0d0d0d' }} />

        {!leafletReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#111]">
            <div className="text-center">
              <Music size={32} className="text-[#333] mx-auto mb-2 animate-pulse" />
              <p className="text-xs font-mono text-[#444]">Loading map...</p>
            </div>
          </div>
        )}
      </div>

      {/* Popup styles injected globally */}
      <style>{`
        .showme-popup .leaflet-popup-content-wrapper {
          background: #111111 !important;
          border: 1px solid #2a2a2a !important;
          border-radius: 8px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.8) !important;
          padding: 0 !important;
        }
        .showme-popup .leaflet-popup-content {
          margin: 0 !important;
        }
        .showme-popup .leaflet-popup-tip {
          background: #111111 !important;
        }
        .showme-popup .leaflet-popup-close-button {
          color: #555 !important;
          font-size: 16px !important;
          padding: 6px 8px !important;
        }
        .showme-popup .leaflet-popup-close-button:hover {
          color: #e8e8e8 !important;
        }
      `}</style>
    </div>
  )
}
