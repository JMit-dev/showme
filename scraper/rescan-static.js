/**
 * Rescan all 0-show venues using only static strategies (no Puppeteer).
 * Fast way to pick up improvements to JSON-LD, generic HTML, Squarespace patterns.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import * as cheerio from 'cheerio'
import axios from 'axios'
import { parseDate, isUpcoming, makeShowId, dedup, resolveUrl, normalizeShow, extractJsonLd, DEFAULT_HEADERS, sleep } from './utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VENUES_JSON = path.join(__dirname, '../public/data/venues.json')
const SHOWS_JSON  = path.join(__dirname, '../public/data/shows.json')

const allVenues = JSON.parse(fs.readFileSync(VENUES_JSON, 'utf8')).venues
const existing  = JSON.parse(fs.readFileSync(SHOWS_JSON,  'utf8'))

// 0-show venues that have eventsUrl and are active
const targets = allVenues.filter(v => {
  if (!v.active || v.scraper !== 'auto' || !v.eventsUrl) return false
  const venueShows = existing.venues[v.id]
  return !venueShows || venueShows.shows.length === 0
})

console.log(`Rescanning ${targets.length} venues (static only)...\n`)

const MONTH_MAP = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' }

const GENERIC_PATTERNS = [
  { wrap: 'article[class*="eventlist-event"]', title: '[class*="eventlist-title"]', date: 'time.event-date[datetime]', link: 'a[class*="eventlist-title"]' },
  { wrap: '.event-item, .event-listing, .show-item, .show-listing, .concert-item', title: 'h1, h2, h3, h4, .event-title, .show-title, .title, .name', date: 'time[datetime], .event-date, .show-date, .date, [class*="date"]', link: 'a[href]' },
  { wrap: 'article, .card, [class*="event-card"], [class*="show-card"]', title: 'h1, h2, h3, h4', date: 'time[datetime], [class*="date"], [class*="when"]', link: 'a[href]' },
  { wrap: 'li[class*="event"], li[class*="show"], li[class*="concert"]', title: 'h2, h3, h4, strong, b, .title', date: 'time, [class*="date"]', link: 'a[href]' },
]

async function tryStaticScrape(venue) {
  let html
  try {
    const r = await axios.get(venue.eventsUrl, { timeout: 10000, headers: DEFAULT_HEADERS })
    html = r.data
  } catch { return [] }

  if (!html || html.length < 500) return []
  const $ = cheerio.load(html)

  // JSON-LD
  const events = extractJsonLd(html, $)
  if (events.length) {
    const shows = []
    for (const ev of events) {
      const raw = ev.startDate || ev.doorTime || ''
      const dateStr = parseDate(raw)
      if (!isUpcoming(dateStr)) continue
      const offers = Array.isArray(ev.offers) ? ev.offers[0] : ev.offers
      shows.push(normalizeShow({
        id: makeShowId(venue.id, dateStr, ev.name),
        title: ev.name,
        date: dateStr,
        time: null,
        ticketUrl: offers?.url || ev.url || null,
        imageUrl: null,
        sourceUrl: ev.url || venue.eventsUrl,
      }))
    }
    if (shows.length) return dedup(shows).sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  }

  // Next.js __NEXT_DATA__
  const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/)
  if (nextMatch) {
    try {
      const json = JSON.parse(nextMatch[1])
      const evts = json.props?.pageProps?.allEventsV2 || json.props?.pageProps?.events || []
      const shows = []
      for (const ev of evts) {
        const rawDate = ev.fullDate || ev.startDate || ev.date || ''
        const m = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
        let dateStr
        if (m) dateStr = `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`
        else dateStr = parseDate(rawDate)
        if (!isUpcoming(dateStr)) continue
        shows.push(normalizeShow({ id: makeShowId(venue.id, dateStr, ev.name || ev.title), title: ev.name || ev.title || 'TBA', date: dateStr, time: ev.hour || null, ticketUrl: ev.url || null, imageUrl: ev.image || null, price: ev.prices?.minPrice != null ? `$${Number(ev.prices.minPrice).toFixed(0)}` : null, sourceUrl: ev.url || venue.eventsUrl }))
      }
      if (shows.length) return dedup(shows).sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    } catch {}
  }

  // Generic HTML
  let best = []
  for (const pattern of GENERIC_PATTERNS) {
    const items = $(pattern.wrap)
    if (items.length < 2) continue
    const shows = []
    items.each((_, el) => {
      const title = $(el).find(pattern.title).first().text().trim()
      const timeEl = $(el).find('time[datetime]').first()
      const dateEl = timeEl.length ? timeEl : $(el).find(pattern.date).first()
      const rawDate = dateEl.attr('datetime') || dateEl.text().trim()
      const dateStr = parseDate(rawDate)
      if (!title || title.length < 3 || !isUpcoming(dateStr)) return
      const href = $(el).find('a[href]').first().attr('href')
      shows.push(normalizeShow({ id: makeShowId(venue.id, dateStr, title), title, date: dateStr, time: null, ticketUrl: resolveUrl(href, venue.eventsUrl), imageUrl: null, sourceUrl: resolveUrl(href, venue.eventsUrl) || venue.eventsUrl }))
    })
    if (shows.length > best.length) best = shows
  }
  return best
}

let found = 0
for (const venue of targets) {
  try {
    const shows = await tryStaticScrape(venue)
    if (shows.length) {
      console.log(`✓ [${venue.id}] ${venue.name}: ${shows.length} shows`)
      shows.slice(0, 2).forEach(s => console.log(`   ${s.date} — ${s.title}`))
      existing.venues[venue.id] = {
        id: venue.id, name: venue.name, location: venue.location, url: venue.url,
        coords: venue.coords || null, shows, scrapedAt: new Date().toISOString(), error: null,
      }
      found++
    }
  } catch (err) {
    // skip silently
  }
  await sleep(500)
}

existing.totalShows = Object.values(existing.venues).reduce((n, v) => n + v.shows.length, 0)
existing.lastUpdated = new Date().toISOString()
fs.writeFileSync(SHOWS_JSON, JSON.stringify(existing, null, 2))
console.log(`\nFound ${found} new venues with shows. Total: ${existing.totalShows} shows.`)
