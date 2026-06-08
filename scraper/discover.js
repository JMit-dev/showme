/**
 * Venue discovery script using Google Places API (New).
 * Queries multiple center points across Long Island to find all music venues and bars.
 *
 * Usage:
 *   GOOGLE_PLACES_API_KEY=your_key node discover.js
 *
 * Outputs: ../public/data/venues.json
 *
 * Cost estimate: ~40 API calls/run × $0.032 = ~$1.30/run — well within $200/month free tier.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { venues as manualVenues } from './venues.js'
import { sleep } from './utils.js'

// Load .env if present (local dev convenience — not needed in CI)
const __envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env')
if (fs.existsSync(__envPath)) {
  const lines = fs.readFileSync(__envPath, 'utf8').split('\n')
  for (const line of lines) {
    const [key, ...rest] = line.split('=')
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim()
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = path.join(__dirname, '../public/data/venues.json')

const API_KEY = process.env.GOOGLE_PLACES_API_KEY
if (!API_KEY) {
  console.error('GOOGLE_PLACES_API_KEY environment variable is required')
  process.exit(1)
}

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.websiteUri',
  'places.types',
  'places.rating',
  'places.userRatingCount',
].join(',')

// Six overlapping circles tiling all of Long Island
const SEARCH_ZONES = [
  { name: 'Nassau West',     lat: 40.7257, lng: -73.6688, radius: 14000 },
  { name: 'Nassau East',     lat: 40.7548, lng: -73.5100, radius: 16000 },
  { name: 'Suffolk West',    lat: 40.7652, lng: -73.2500, radius: 18000 },
  { name: 'Suffolk Central', lat: 40.8200, lng: -73.0100, radius: 20000 },
  { name: 'Suffolk East',    lat: 40.9000, lng: -72.6500, radius: 22000 },
  { name: 'East End',        lat: 41.0200, lng: -72.2100, radius: 20000 },
]

// Valid types for the Places API (New) — music_venue is NOT supported
const NEARBY_TYPES = [
  'night_club',
  'performing_arts_theater',
  'concert_hall',
]

// Text Search queries that catch bars with live music — run once across all of LI
const TEXT_SEARCHES = [
  'live music bar Long Island NY',
  'rock bar Long Island NY',
  'music hall Long Island NY',
  'live music venue Long Island NY',
]

// LI bounding box for filtering stray results
const LI_BOUNDS = { minLat: 40.45, maxLat: 41.30, minLng: -74.30, maxLng: -71.80 }

function isInLI(lat, lng) {
  return lat >= LI_BOUNDS.minLat && lat <= LI_BOUNDS.maxLat &&
         lng >= LI_BOUNDS.minLng && lng <= LI_BOUNDS.maxLng
}

// For Nearby results, all types are already relevant — no keyword filter needed
// Text search results are already filtered by query — include everything in LI

async function searchNearby(lat, lng, radius, type) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: [type],
      maxResultCount: 20,
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius },
      },
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Places API error ${res.status}: ${err}`)
  }
  return (await res.json()).places || []
}

async function searchText(query) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 20,
      locationRestriction: {
        rectangle: {
          low:  { latitude: LI_BOUNDS.minLat, longitude: LI_BOUNDS.minLng },
          high: { latitude: LI_BOUNDS.maxLat, longitude: LI_BOUNDS.maxLng },
        },
      },
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Places API error ${res.status}: ${err}`)
  }
  return (await res.json()).places || []
}

function placeToVenue(place) {
  const name = place.displayName?.text || 'Unknown Venue'
  const address = place.formattedAddress || ''
  const parts = address.split(',').map(s => s.trim())
  const city = parts[1] || ''
  const stateZip = (parts[2] || '').trim()
  const stateOnly = stateZip.split(' ')[0]
  const location = city && stateOnly ? `${city}, ${stateOnly}` : address

  const lat = place.location?.latitude
  const lng = place.location?.longitude

  return {
    id: `gp-${place.id.slice(-12)}`,
    googlePlaceId: place.id,
    name,
    location,
    coords: lat && lng ? [lat, lng] : null,
    url: place.websiteUri || null,
    eventsUrl: place.websiteUri ? guessEventsUrl(place.websiteUri) : null,
    facebook: null,
    instagram: null,
    scraper: place.websiteUri ? 'auto' : null,
    genre: inferGenre(place),
    active: true,
    source: 'google-places',
  }
}

function guessEventsUrl(websiteUrl) {
  try {
    const u = new URL(websiteUrl)
    return `${u.origin}/events`
  } catch {
    return null
  }
}

function inferGenre(place) {
  const name = (place.displayName?.text || '').toLowerCase()
  const types = place.types || []
  const genres = []
  if (/metal|rock|punk|hardcore/.test(name)) genres.push('rock', 'metal')
  if (/jazz/.test(name)) genres.push('jazz')
  if (/blues/.test(name)) genres.push('blues')
  if (/country/.test(name)) genres.push('country')
  if (/folk|acoustic/.test(name)) genres.push('folk')
  if (types.includes('concert_hall') || types.includes('performing_arts_theater')) genres.push('performing arts')
  return genres.length ? genres : ['live music']
}

async function discover() {
  console.log('Starting venue discovery across Long Island...\n')

  const seen = new Set()
  const discovered = []

  function addPlace(place) {
    if (seen.has(place.id)) return false
    const lat = place.location?.latitude
    const lng = place.location?.longitude
    if (!isInLI(lat, lng)) return false
    seen.add(place.id)
    discovered.push(placeToVenue(place))
    return true
  }

  // Phase 1: Nearby Search per type per zone
  console.log('Phase 1: Nearby Search by venue type\n')
  for (const zone of SEARCH_ZONES) {
    for (const type of NEARBY_TYPES) {
      process.stdout.write(`  ${zone.name} — ${type}... `)
      try {
        const places = await searchNearby(zone.lat, zone.lng, zone.radius, type)
        let added = 0
        for (const p of places) if (addPlace(p)) added++
        console.log(`${places.length} results, ${added} new`)
      } catch (err) {
        console.log(`ERROR: ${err.message}`)
      }
      await sleep(300)
    }
  }

  // Phase 2: Text Search for bars with live music (one pass across all of LI)
  console.log('\nPhase 2: Text Search for live music bars\n')
  for (const query of TEXT_SEARCHES) {
    process.stdout.write(`  "${query}"... `)
    try {
      const places = await searchText(query)
      let added = 0
      for (const p of places) if (addPlace(p)) added++
      console.log(`${places.length} results, ${added} new`)
    } catch (err) {
      console.log(`ERROR: ${err.message}`)
    }
    await sleep(300)
  }

  console.log(`\nDiscovered ${discovered.length} venues from Google Places`)

  // Merge: manual entries take precedence; merge coords/placeId into manual if missing
  const manualNames = new Map(manualVenues.map(v => [v.name.toLowerCase(), v]))

  const merged = [...manualVenues]
  let newCount = 0

  for (const venue of discovered) {
    const nameLower = venue.name.toLowerCase()
    if (manualNames.has(nameLower)) {
      const manual = manualNames.get(nameLower)
      if (!manual.coords && venue.coords) manual.coords = venue.coords
      if (!manual.googlePlaceId) manual.googlePlaceId = venue.googlePlaceId
      continue
    }
    merged.push(venue)
    newCount++
  }

  console.log(`Merged with ${manualVenues.length} manual venues — ${newCount} new venues added`)

  // Sort: manual entries first, then discovered, alphabetical within each group
  merged.sort((a, b) => {
    const aManual = !a.source
    const bManual = !b.source
    if (aManual && !bManual) return -1
    if (!aManual && bManual) return 1
    return a.name.localeCompare(b.name)
  })

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
    lastUpdated: new Date().toISOString(),
    total: merged.length,
    venues: merged,
  }, null, 2))

  console.log(`\nWrote ${merged.length} total venues to ${OUTPUT_PATH}`)
}

discover().catch(err => {
  console.error('Discovery failed:', err)
  process.exit(1)
})
