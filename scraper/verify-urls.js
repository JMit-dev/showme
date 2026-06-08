/**
 * URL verification script.
 * Reads public/data/venues.json, checks every venue URL, finds real events pages,
 * and writes the verified results back.
 *
 * Usage: node verify-urls.js
 *
 * What it does:
 *   1. For each venue with a url: verify the homepage loads (200)
 *   2. If homepage loads: crawl it to find the real events/shows/calendar page
 *   3. Verify the found eventsUrl actually returns content
 *   4. Update venues.json with verified urls + eventsUrls
 *   5. Mark dead sites as url: null, eventsUrl: null, scraper: null
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'
import axiosRetry from 'axios-retry'
import * as cheerio from 'cheerio'
import { sleep, DEFAULT_HEADERS, resolveUrl } from './utils.js'

// Load .env
const __envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env')
if (fs.existsSync(__envPath)) {
  const lines = fs.readFileSync(__envPath, 'utf8').split('\n')
  for (const line of lines) {
    const [key, ...rest] = line.split('=')
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim()
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VENUES_JSON = path.join(__dirname, '../public/data/venues.json')

axiosRetry(axios, { retries: 1, retryDelay: () => 1000 })

const EVENTS_LINK_PATTERNS = /^(events?|shows?|calendar|concerts?|tickets?|schedule|gigs?|upcoming|performances?|whats.?on)$/i
const EVENTS_PATH_GUESSES = ['/events', '/shows', '/calendar', '/concerts', '/schedule', '/tickets', '/upcoming', '/live-music']

async function checkUrl(url, timeout = 8000) {
  try {
    const res = await axios.get(url, {
      timeout,
      headers: DEFAULT_HEADERS,
      maxRedirects: 5,
      validateStatus: s => s < 400,
    })
    return { ok: true, finalUrl: res.request?.res?.responseUrl || url, html: res.data }
  } catch {
    return { ok: false, finalUrl: null, html: null }
  }
}

async function findEventsUrl(homepageUrl, homepageHtml) {
  const $ = cheerio.load(homepageHtml)
  const candidates = new Map() // url -> score (higher = more likely events page)

  // Score links by how much they look like an events page
  $('a[href]').each((_, el) => {
    const text = $(el).text().trim().toLowerCase()
    const href = $(el).attr('href')
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return

    let score = 0
    const resolved = resolveUrl(href, homepageUrl)
    if (!resolved) return

    // Text match — strongest signal
    if (EVENTS_LINK_PATTERNS.test(text)) score += 10
    else if (text.includes('event') || text.includes('show') || text.includes('concert') || text.includes('calendar')) score += 5
    else if (text.includes('ticket') || text.includes('schedule')) score += 3

    // Href path match
    const hrefLower = href.toLowerCase()
    if (/\/events?\b/.test(hrefLower)) score += 8
    else if (/\/shows?\b/.test(hrefLower)) score += 7
    else if (/\/calendar/.test(hrefLower)) score += 6
    else if (/\/concerts?/.test(hrefLower)) score += 6
    else if (/\/tickets?/.test(hrefLower)) score += 4
    else if (/\/schedule/.test(hrefLower)) score += 4

    // Navigation context (in nav/header/menu = more likely the real events link)
    const inNav = $(el).closest('nav, header, [class*="nav"], [class*="menu"], [role="navigation"]').length > 0
    if (inNav) score += 3

    if (score > 0) {
      const existing = candidates.get(resolved) || 0
      candidates.set(resolved, Math.max(existing, score))
    }
  })

  // Also try common path guesses
  for (const p of EVENTS_PATH_GUESSES) {
    try {
      const u = new URL(p, homepageUrl).href
      if (!candidates.has(u)) candidates.set(u, 1)
    } catch {}
  }

  // Sort by score desc, try each candidate
  const sorted = [...candidates.entries()].sort((a, b) => b[1] - a[1])

  for (const [url, score] of sorted.slice(0, 8)) { // try top 8 candidates
    if (url === homepageUrl) continue
    const result = await checkUrl(url, 6000)
    if (result.ok && result.html && result.html.length > 800) {
      return { url, score }
    }
    await sleep(200)
  }

  return null
}

async function verifyAll() {
  const raw = JSON.parse(fs.readFileSync(VENUES_JSON, 'utf8'))
  const venues = raw.venues || raw

  const total = venues.length
  let verified = 0, dead = 0, foundEvents = 0, unchanged = 0

  console.log(`Verifying URLs for ${total} venues...\n`)
  console.log('Legend: ✓ live  ✗ dead  → found events URL  = unchanged\n')

  for (let i = 0; i < venues.length; i++) {
    const venue = venues[i]
    const prefix = `[${i + 1}/${total}] ${venue.name}`

    // No URL at all — skip (map-only or already marked dead)
    if (!venue.url) {
      process.stdout.write(`${prefix}: (no URL — skipping)\n`)
      unchanged++
      continue
    }

    // Check homepage
    const homeResult = await checkUrl(venue.url)
    await sleep(400)

    if (!homeResult.ok) {
      process.stdout.write(`${prefix}: ✗ dead (${venue.url})\n`)
      venue.url = null
      venue.eventsUrl = null
      venue.scraper = null
      dead++
      continue
    }

    // Homepage is live — update url to final redirected URL
    if (homeResult.finalUrl && homeResult.finalUrl !== venue.url) {
      venue.url = homeResult.finalUrl
    }

    // Find real events URL
    const eventsResult = await findEventsUrl(homeResult.finalUrl || venue.url, homeResult.html)
    await sleep(400)

    if (eventsResult) {
      const changed = eventsResult.url !== venue.eventsUrl
      venue.eventsUrl = eventsResult.url
      if (!venue.scraper) venue.scraper = 'auto'
      process.stdout.write(`${prefix}: ✓${changed ? ` → events: ${eventsResult.url}` : ' (events URL confirmed)'}\n`)
      if (changed) foundEvents++
      else unchanged++
    } else {
      // No events page found — set eventsUrl to homepage so engine crawls it
      venue.eventsUrl = homeResult.finalUrl || venue.url
      if (!venue.scraper) venue.scraper = 'auto'
      process.stdout.write(`${prefix}: ✓ (no events page found — will crawl homepage)\n`)
      unchanged++
    }

    verified++
  }

  // Write updated venues.json
  raw.venues = venues
  raw.lastVerified = new Date().toISOString()
  fs.writeFileSync(VENUES_JSON, JSON.stringify(raw, null, 2))

  console.log(`\n─────────────────────────────────────────`)
  console.log(`Done. ${total} venues processed:`)
  console.log(`  ✓ ${verified} live sites`)
  console.log(`  → ${foundEvents} events URLs updated`)
  console.log(`  ✗ ${dead} dead/unreachable sites (marked map-only)`)
  console.log(`\nUpdated venues.json written.`)
}

verifyAll().catch(err => {
  console.error('Verification failed:', err)
  process.exit(1)
})
