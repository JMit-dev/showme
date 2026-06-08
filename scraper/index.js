/**
 * Scraper orchestrator.
 * Reads venue list from public/data/venues.json (if it exists from discovery)
 * or falls back to the manual venues.js registry.
 * Runs the engine against every active venue with an eventsUrl.
 * Writes results to public/data/shows.json.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { venues as manualVenues } from './venues.js'
import { scrapeVenue } from './engine.js'
import { sleep } from './utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VENUES_JSON = path.join(__dirname, '../public/data/venues.json')
const SHOWS_JSON  = path.join(__dirname, '../public/data/shows.json')

function loadVenues() {
  // Prefer the auto-discovered+merged venues.json if it exists
  if (fs.existsSync(VENUES_JSON)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(VENUES_JSON, 'utf8'))
      const list = parsed.venues || parsed
      if (Array.isArray(list) && list.length) return list
    } catch {}
  }
  return manualVenues
}

async function run() {
  const allVenues = loadVenues()
  const scrapeable = allVenues.filter(v => v.active && v.scraper === 'auto' && v.eventsUrl)

  console.log(`ShowMe scraper — ${new Date().toISOString()}`)
  console.log(`${allVenues.length} total venues, ${scrapeable.length} to scrape\n`)

  const results = {}
  const errors = []

  for (const venue of scrapeable) {
    console.log(`[${venue.id}] ${venue.name}`)
    try {
      const shows = await scrapeVenue(venue)
      results[venue.id] = {
        id: venue.id,
        name: venue.name,
        location: venue.location,
        url: venue.url,
        coords: venue.coords || null,
        shows,
        scrapedAt: new Date().toISOString(),
        error: null,
      }
      console.log(`    → ${shows.length} upcoming shows`)
    } catch (err) {
      console.error(`    ✗ ERROR: ${err.message}`)
      errors.push({ venue: venue.id, error: err.message })
      results[venue.id] = {
        id: venue.id,
        name: venue.name,
        location: venue.location,
        url: venue.url,
        coords: venue.coords || null,
        shows: [],
        scrapedAt: new Date().toISOString(),
        error: err.message,
      }
    }

    await sleep(1500)  // be polite between requests
  }

  const output = {
    lastUpdated: new Date().toISOString(),
    totalShows: Object.values(results).reduce((n, v) => n + v.shows.length, 0),
    errors: errors.length,
    venues: results,
  }

  fs.mkdirSync(path.dirname(SHOWS_JSON), { recursive: true })
  fs.writeFileSync(SHOWS_JSON, JSON.stringify(output, null, 2))

  console.log(`\n─────────────────────────────────`)
  console.log(`Done. ${output.totalShows} shows across ${scrapeable.length} venues.`)
  if (errors.length) console.log(`${errors.length} venue(s) failed — see errors above.`)

  // Always exit 0 — partial data is better than no data
  process.exit(0)
}

run()
