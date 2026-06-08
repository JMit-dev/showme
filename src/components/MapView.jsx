import { useEffect, useRef, useState } from 'react'
import { Music } from 'lucide-react'

let L = null

const LI_CENTER = [40.79, -73.13]

function esc(str) {
  if (!str) return ''
  const el = document.createElement('textarea')
  el.innerHTML = str
  return el.value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
const LI_ZOOM = 10

function getMarkerColor(venue, showsData) {
  const venueShows = showsData?.venues?.[venue.id]
  if (!venue.scraper) return '#444444'
  if (!venueShows) return '#555555'
  if (venueShows.error) return '#7a3030'
  if (venueShows.shows?.length > 0) return '#e53e3e'
  return '#505050'
}

function createMarkerIcon(color, selected = false) {
  const size = selected ? 18 : 12
  const glow = selected
    ? '0 0 10px rgba(229,62,62,0.9), 0 0 20px rgba(229,62,62,0.4)'
    : color === '#e53e3e' ? '0 0 5px rgba(229,62,62,0.5)' : '0 0 3px rgba(0,0,0,0.5)'
  const border = selected ? '#fff' : (color === '#e53e3e' ? '#ff8080' : '#222')
  const borderW = selected ? 2 : 1.5
  return L.divIcon({
    html: `<div style="
      width:${size}px;height:${size}px;
      background:${color};
      border:${borderW}px solid ${border};
      border-radius:50%;
      box-shadow:${glow};
      cursor:pointer;
      transition:all .15s;
    "></div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

export default function MapView({ allVenues = [], showsData, selectedVenueId, onVenueClick }) {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markersRef = useRef(new Map())   // venueId → marker
  const colorsRef = useRef(new Map())    // venueId → color
  const onVenueClickRef = useRef(onVenueClick)
  const [leafletReady, setLeafletReady] = useState(false)

  // Keep callback ref fresh without triggering marker rebuild
  useEffect(() => { onVenueClickRef.current = onVenueClick }, [onVenueClick])

  // Load Leaflet
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }
    import('leaflet').then(module => {
      L = module.default
      delete L.Icon.Default.prototype._getIconUrl
      setLeafletReady(true)
    })
  }, [])

  // Init map
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstanceRef.current) return
    mapInstanceRef.current = L.map(mapRef.current, {
      center: LI_CENTER,
      zoom: LI_ZOOM,
      zoomControl: true,
    })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(mapInstanceRef.current)
  }, [leafletReady])

  // Build/rebuild markers
  useEffect(() => {
    if (!mapInstanceRef.current || !L || !leafletReady) return

    markersRef.current.forEach(m => m.remove())
    markersRef.current = new Map()
    colorsRef.current = new Map()

    const venuesWithCoords = allVenues.filter(v => v.coords && v.active !== false)

    for (const venue of venuesWithCoords) {
      const color = getMarkerColor(venue, showsData)
      colorsRef.current.set(venue.id, color)

      const isSelected = venue.id === selectedVenueId
      const marker = L.marker(venue.coords, { icon: createMarkerIcon(color, isSelected) })

      // Popup HTML
      const el = document.createElement('div')
      el.style.cssText = 'background:#111;color:#e8e8e8;padding:12px 14px;border-radius:8px;font-family:system-ui,sans-serif;min-width:200px;max-width:260px'
      const venueShows = showsData?.venues?.[venue.id]
      const upcoming = venueShows?.shows?.slice(0, 3) || []
      const total = venueShows?.shows?.length || 0
      el.innerHTML = `
        <div style="display:flex;align-items:start;justify-content:space-between;gap:8px;margin-bottom:6px">
          <strong style="font-size:13px;line-height:1.3;color:#fff;font-weight:700;letter-spacing:.3px">${venue.name}</strong>
          ${total > 0 ? `<span style="flex-shrink:0;padding:1px 6px;border-radius:999px;font-size:10px;font-family:monospace;background:rgba(229,62,62,.15);color:#e53e3e;border:1px solid rgba(229,62,62,.3)">${total}</span>` : ''}
        </div>
        <div style="font-size:10px;color:#555;font-family:monospace;margin-bottom:8px">${venue.location || ''}</div>
        ${upcoming.length > 0
          ? upcoming.map(s => `<div style="margin-bottom:5px">
              <div style="font-size:12px;color:#ddd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.title)}</div>
              <div style="font-size:10px;color:#e53e3e;font-family:monospace">${s.date}</div>
            </div>`).join('')
          : `<div style="font-size:10px;color:#444;font-family:monospace">${venue.scraper ? 'No upcoming shows' : 'Check social for shows'}</div>`
        }
        ${total > 3 ? `<div style="font-size:10px;color:#444;font-family:monospace;margin-top:3px">+${total - 3} more</div>` : ''}
        ${total > 0 ? `<button data-venue-id="${venue.id}" style="margin-top:8px;padding:3px 10px;font-size:10px;font-family:monospace;background:#e53e3e;color:#fff;border:none;border-radius:4px;cursor:pointer">Filter list</button>` : ''}
        ${venue.url ? `<div style="margin-top:6px"><a href="${venue.url}" target="_blank" style="font-size:10px;color:#555;font-family:monospace;text-decoration:none">↗ website</a></div>` : ''}
      `

      // Delegate click on "Filter list" button
      el.addEventListener('click', e => {
        const btn = e.target.closest('[data-venue-id]')
        if (btn) onVenueClickRef.current?.(btn.dataset.venueId)
      })

      marker.bindPopup(L.popup({ maxWidth: 280, className: 'showme-popup' }).setContent(el))
      marker.addTo(mapInstanceRef.current)
      markersRef.current.set(venue.id, marker)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allVenues, showsData, leafletReady])

  // Update selected marker icon without rebuilding all markers
  useEffect(() => {
    if (!L || !leafletReady) return
    markersRef.current.forEach((marker, venueId) => {
      const color = colorsRef.current.get(venueId) || '#555'
      marker.setIcon(createMarkerIcon(color, venueId === selectedVenueId))
    })
  }, [selectedVenueId, leafletReady])

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="w-full h-full" style={{ background: '#0a0a0a' }} />

      {!leafletReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]">
          <div className="text-center">
            <Music size={24} className="text-[#222] mx-auto mb-2 animate-pulse" />
            <p className="text-[10px] font-mono text-[#333]">Loading map…</p>
          </div>
        </div>
      )}

      <style>{`
        .showme-popup .leaflet-popup-content-wrapper {
          background:#111 !important;
          border:1px solid #222 !important;
          border-radius:8px !important;
          box-shadow:0 4px 24px rgba(0,0,0,.9) !important;
          padding:0 !important;
        }
        .showme-popup .leaflet-popup-content { margin:0 !important; }
        .showme-popup .leaflet-popup-tip { background:#111 !important; }
        .showme-popup .leaflet-popup-close-button { color:#444 !important;padding:6px 8px !important; }
        .showme-popup .leaflet-popup-close-button:hover { color:#aaa !important; }
        .leaflet-control-zoom { border:1px solid #222 !important; }
        .leaflet-control-zoom a { background:#111 !important;color:#555 !important;border-bottom:1px solid #222 !important; }
        .leaflet-control-zoom a:hover { background:#1a1a1a !important;color:#aaa !important; }
        .leaflet-control-attribution { background:rgba(0,0,0,.6) !important;color:#333 !important;font-size:9px !important; }
        .leaflet-control-attribution a { color:#444 !important; }
      `}</style>
    </div>
  )
}
