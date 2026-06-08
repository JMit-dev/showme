/**
 * Venue discovery script using Google Places API (New).
 * Queries multiple center points across Long Island to find all music venues and bars.
 *
 * Usage:
 *   GOOGLE_PLACES_API_KEY=your_key node discover.js
 *
 * Outputs: ../public/data/venues.json
 *
 * The Google Places API free tier covers $200/month in credits.
 * This script makes ~30-40 API calls per run (Nearby Search = $0.032/call = ~$1.30/run).
 * Running weekly costs pennies and stays well within free tier.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { venues as manualVenues } from './venues.js'
import { sleep, slugify } from './utils.js'

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

// Six overlapping circles that tile all of Long Island
const SEARCH_ZONES = [
  { name: 'Nassau West',    lat: 40.7257, lng: -73.6688, radius: 14000 },
  { name: 'Nassau East',    lat: 40.7548, lng: -73.5100, radius: 16000 },
  { name: 'Suffolk West',   lat: 40.7652, lng: -73.2500, radius: 18000 },
  { name: 'Suffolk Central',lat: 40.8200, lng: -73.0100, radius: 20000 },
  { name: 'Suffolk East',   lat: 40.9000, lng: -72.6500, radius: 22000 },
  { name: 'East End',       lat: 41.0200, lng: -72.2100, radius: 20000 },
]

// Place types to search — we cast a wide net and filter by name/keyword later
const PLACE_TYPES = [
  'music_venue',
  'night_club',
  'performing_arts_theater',
  'concert_hall',
  'bar',
]

// LI bounding box — reject results clearly outside Long Island
const LI_BOUNDS = { minLat: 40.45, maxLat: 41.30, minLng: -74.30, maxLng: -71.80 }

// Keywords that suggest a venue has live music (used when filtering bars)
const LIVE_MUSIC_KEYWORDS = [
  'music', 'live', 'concert', 'show', 'stage', 'band', 'rock', 'metal',
  'punk', 'jazz', 'blues', 'acoustic', 'venue', 'hall', 'lounge',
]

function isInLI(lat, lng) {
  return lat >= LI_BOUNDS.minLat && lat <= LI_BOUNDS.maxLat &&
         lng >= LI_BOUNDS.minLng && lng <= LI_BOUNDS.maxLng
}

function likelyHasLiveMusic(place) {
  const name = (place.displayName?.text || '').toLowerCase()
  const types = place.types || []

  // Always include dedicated music/performance spaces
  if (types.includes('music_venue') || types.includes('concert_hall') ||
      types.includes('performing_arts_theater')) return true

  // For bars and night clubs, require a live-music keyword in the name
  if (types.includes('bar') || types.includes('night_club')) {
    return LIVE_MUSIC_KEYWORDS.some(kw => name.includes(kw))
  }

  return true
}

async function searchNearby(lat, lng, radius, type) {
  const url = 'https://places.googleapis.com/v1/places:searchNearby'
  const body = {
    includedTypes: [type],
    maxResultCount: 20,
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius,
      },
    },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.location',
        'places.websiteUri',
        'places.types',
        'places.rating',
        'places.userRatingCount',
      ].join(','),
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Places API error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return data.places || []
}

function placeToVenue(place) {
  const name = place.displayName?.text || 'Unknown Venue'
  const address = place.formattedAddress || ''
  // Extract city from address like "123 Main St, Patchogue, NY 11772, USA"
  const parts = address.split(',').map(s => s.trim())
  const city = parts[1] || ''
  const stateZip = parts[2] || ''
  const location = city && stateZip ? `${city}, ${stateZip.split(' ')[0]}` : address

  const lat = place.location?.latitude
  const lng = place.location?.longitude

  return {
    id: `gp-${place.id.slice(-12)}`,  // prefix to distinguish from manual entries
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
  // Many venues host events at /events — try it, scraper handles 404s gracefully
  try {
    const u = new URL(websiteUrl)
    return `${u.origin}/events`
  } catch {
    return null
  }
}

function inferGenre(place) {
  const name = (place.displayName?.text || '').toLowerCase()
  const genres = []
  if (/metal|rock|punk|hardcore/.test(name)) genres.push('rock', 'metal')
  if (/jazz/.test(name)) genres.push('jazz')
  if (/blues/.test(name)) genres.push('blues')
  if (/country/.test(name)) genres.push('country')
  if (/folk|acoustic/.test(name)) genres.push('folk')
  return genres.length ? genres : ['live music']
}

async function discover() {
  console.log('Starting venue discovery across Long Island...\n')

  const seen = new Set()
  const discovered = []

  for (const zone of SEARCH_ZONES) {
    for (const type of PLACE_TYPES) {
      process.stdout.write(`  ${zone.name} — ${type}... `)
      try {
        const places = await searchNearby(zone.lat, zone.lng, zone.radius, type)
        let added = 0
        for (const place of places) {
          if (seen.has(place.id)) continue
          const lat = place.location?.latitude
          const lng = place.location?.longitude
          if (!isInLI(lat, lng)) continue
          if (!likelyHasLiveMusic(place)) continue
          seen.add(place.id)
          discovered.push(placeToVenue(place))
          added++
        }
        console.log(`${places.length} results, ${added} new`)
      } catch (err) {
        console.log(`ERROR: ${err.message}`)
      }
      await sleep(300) // stay well within rate limits
    }
  }

  console.log(`\nDiscovered ${discovered.length} venues from Google Places`)

  // Merge: manual entries take precedence over discovered ones
  // Manual entries are matched by ID first, then by name similarity
  const manualIds = new Set(manualVenues.map(v => v.id))
  const manualNames = new Map(manualVenues.map(v => [v.name.toLowerCase(), v]))

  const merged = [...manualVenues]
  let newCount = 0

  for (const venue of discovered) {
    const nameLower = venue.name.toLowerCase()
    if (manualNames.has(nameLower)) {
      // Manual entry exists — merge coords/placeId if manual doesn't have them
      const manual = manualNames.get(nameLower)
      if (!manual.coords && venue.coords) manual.coords = venue.coords
      if (!manual.googlePlaceId) manual.googlePlaceId = venue.googlePlaceId
      continue
    }
    merged.push(venue)
    newCount++
  }

  console.log(`Merged with ${manualVenues.length} manual venues — ${newCount} new venues added`)

  // Sort: manual entries first (no source field), then discovered, alphabetical within each group
  merged.sort((a, b) => {
    const aIsManual = !a.source
    const bIsManual = !b.source
    if (aIsManual && !bIsManual) return -1
    if (!aIsManual && bIsManual) return 1
    return a.name.localeCompare(b.name)
  })

  // Write output
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
