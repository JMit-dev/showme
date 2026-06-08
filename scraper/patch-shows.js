/**
 * Targeted patch: re-scrapes specific venues with improved strategies
 * and merges results into existing shows.json.
 * Run after engine updates to avoid re-scraping all 142 venues.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { scrapeVenue } from './engine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VENUES_JSON = path.join(__dirname, '../public/data/venues.json')
const SHOWS_JSON  = path.join(__dirname, '../public/data/shows.json')

// Venues to re-scrape (IDs from venues.json)
const TARGET_IDS = [
  '89north',
  'gp-RZmkkLSJKP0M', // Stephen Talkhouse
  'gp-Rd5KA853eGSQ', // My Father's Place (Wix Events)
]

const allVenues = JSON.parse(fs.readFileSync(VENUES_JSON, 'utf8')).venues
const existing  = JSON.parse(fs.readFileSync(SHOWS_JSON,  'utf8'))

// Remove deactivated venue entries from shows
const deactivatedIds = allVenues.filter(v => !v.active).map(v => v.id)
deactivatedIds.forEach(id => {
  if (existing.venues[id]) {
    console.log(`Removing deactivated venue: ${existing.venues[id].name}`)
    delete existing.venues[id]
  }
})

// Re-scrape targets
for (const id of TARGET_IDS) {
  const venue = allVenues.find(v => v.id === id)
  if (!venue || !venue.active) { console.log(`Skip ${id}: not active`); continue }

  console.log(`\n[${venue.id}] ${venue.name}`)
  try {
    const shows = await scrapeVenue(venue)
    existing.venues[venue.id] = {
      id: venue.id,
      name: venue.name,
      location: venue.location,
      url: venue.url,
      coords: venue.coords || null,
      shows,
      scrapedAt: new Date().toISOString(),
      error: null,
    }
    console.log(`    → ${shows.length} shows`)
  } catch (err) {
    console.error(`    ✗ ERROR: ${err.message}`)
  }
}

// Recompute total
existing.totalShows = Object.values(existing.venues).reduce((n, v) => n + v.shows.length, 0)
existing.lastUpdated = new Date().toISOString()

fs.writeFileSync(SHOWS_JSON, JSON.stringify(existing, null, 2))
console.log(`\nDone. ${existing.totalShows} total shows.`)
