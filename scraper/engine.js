/**
 * Generic multi-strategy scraper engine.
 * Tries each strategy in order and returns on first success.
 *
 * Strategy order:
 *   1. JSON-LD  (schema.org Event markup in <script> tags)
 *   2. Bandsintown widget  (detects bt-widget embed, reads data-artist)
 *   3. Songkick widget  (detects sk-widget embed, reads event list)
 *   4. Eventbrite embed  (detects EB iframe/script, fetches their public JSON)
 *   5. Generic HTML  (tries a battery of common event-list CSS patterns)
 */

import * as cheerio from 'cheerio'
import axios from 'axios'
import axiosRetry from 'axios-retry'
import {
  parseDate, isUpcoming, makeShowId, dedup, resolveUrl,
  normalizeShow, extractJsonLd, DEFAULT_HEADERS, sleep,
} from './utils.js'

axiosRetry(axios, { retries: 2, retryDelay: axiosRetry.exponentialDelay })

async function fetchHtml(url) {
  const { data } = await axios.get(url, {
    timeout: 12000,
    headers: DEFAULT_HEADERS,
  })
  return data
}

// ─── Strategy 1: JSON-LD ────────────────────────────────────────────────────

function scrapeJsonLd(html, $, venueConfig) {
  const events = extractJsonLd(html, $)
  if (!events.length) return null

  const shows = []
  for (const ev of events) {
    const raw = ev.startDate || ev.doorTime || ''
    const dateStr = parseDate(raw)
    if (!isUpcoming(dateStr)) continue

    let time = null
    try {
      if (raw.includes('T')) {
        time = new Date(raw).toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
        })
      }
    } catch {}

    const offers = Array.isArray(ev.offers) ? ev.offers[0] : ev.offers
    shows.push(normalizeShow({
      id: makeShowId(venueConfig.id, dateStr, ev.name),
      title: ev.name,
      date: dateStr,
      time,
      ticketUrl: offers?.url || ev.url || null,
      imageUrl: resolveUrl(
        Array.isArray(ev.image) ? ev.image[0] : ev.image,
        venueConfig.eventsUrl
      ),
      price: offers?.price != null ? `$${offers.price}` : null,
      ages: null,
      description: typeof ev.description === 'string' ? ev.description.slice(0, 300) : null,
      sourceUrl: ev.url || venueConfig.eventsUrl,
    }))
  }

  return shows.length ? shows : null
}

// ─── Strategy 2: Bandsintown widget ─────────────────────────────────────────
// Many venues embed: <div class="bt-widget" data-artist="..." data-app-id="...">
// We read the artist slug and hit Bandsintown's public API.

async function scrapeBandsintown(html, $, venueConfig) {
  const widget = $('[class*="bt-widget"], [data-app-id][data-artist], script[src*="bandsintown"]').first()
  if (!widget.length) return null

  const artist = widget.attr('data-artist') || widget.attr('data-venue')
  if (!artist) return null

  const appId = widget.attr('data-app-id') || 'showme-li'
  const url = `https://rest.bandsintown.com/venues/${encodeURIComponent(artist)}/events?app_id=${appId}`

  try {
    const { data } = await axios.get(url, { timeout: 8000, headers: DEFAULT_HEADERS })
    if (!Array.isArray(data) || !data.length) return null

    const shows = []
    for (const ev of data) {
      const dateStr = parseDate(ev.datetime)
      if (!isUpcoming(dateStr)) continue
      shows.push(normalizeShow({
        id: makeShowId(venueConfig.id, dateStr, ev.title || ev.headliner_artist?.name),
        title: ev.title || ev.headliner_artist?.name || 'TBA',
        date: dateStr,
        time: ev.datetime?.includes('T') ? new Date(ev.datetime).toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
        }) : null,
        ticketUrl: ev.offers?.[0]?.url || null,
        imageUrl: ev.artist?.image_url || null,
        price: null,
        sourceUrl: ev.url || venueConfig.eventsUrl,
      }))
    }
    return shows.length ? shows : null
  } catch {
    return null
  }
}

// ─── Strategy 3: Songkick widget ────────────────────────────────────────────

async function scrapeSongkick($, venueConfig) {
  const skId = $('a[href*="songkick.com/venues/"]').first().attr('href')?.match(/venues\/(\d+)/)?.[1]
    || $('[data-venue-id]').first().attr('data-venue-id')
  if (!skId) return null

  const url = `https://www.songkick.com/venues/${skId}/calendar.json`
  try {
    const { data } = await axios.get(url, { timeout: 8000, headers: DEFAULT_HEADERS })
    const events = data?.resultsPage?.results?.event || []
    if (!events.length) return null

    const shows = []
    for (const ev of events) {
      const dateStr = parseDate(ev.start?.date)
      if (!isUpcoming(dateStr)) continue
      shows.push(normalizeShow({
        id: makeShowId(venueConfig.id, dateStr, ev.displayName),
        title: ev.displayName,
        date: dateStr,
        time: ev.start?.time || null,
        ticketUrl: ev.uri || null,
        imageUrl: null,
        sourceUrl: ev.uri || venueConfig.eventsUrl,
      }))
    }
    return shows.length ? shows : null
  } catch {
    return null
  }
}

// ─── Strategy 4: Eventbrite embed ───────────────────────────────────────────
// Detect Eventbrite organizer ID or event IDs embedded in page, fetch their API.

async function scrapeEventbrite(html, $, venueConfig) {
  // Look for organizer ID in EB widget script
  const orgMatch = html.match(/organizer[_-]?id["'\s:=]+(\d+)/i)
  const orgId = orgMatch?.[1]
  if (!orgId) return null

  const url = `https://www.eventbriteapi.com/v3/organizers/${orgId}/events/?status=live&order_by=start_asc&expand=venue`
  // Note: Eventbrite's public organizer event pages don't require a token for read
  // However their API does — so we scrape their public HTML instead
  const ebUrl = `https://www.eventbrite.com/o/${orgId}/`
  try {
    const ebHtml = await fetchHtml(ebUrl)
    const $eb = cheerio.load(ebHtml)
    const shows = []

    $eb('[data-event-id], .eds-event-card').each((_, el) => {
      const title = $eb(el).find('h3, .eds-event-card__formatted-name').first().text().trim()
      const rawDate = $eb(el).find('time, .eds-event-card__sub-title').first().attr('datetime')
        || $eb(el).find('time').first().text().trim()
      const dateStr = parseDate(rawDate)
      if (!title || !isUpcoming(dateStr)) return
      const href = $eb(el).find('a').first().attr('href')
      shows.push(normalizeShow({
        id: makeShowId(venueConfig.id, dateStr, title),
        title,
        date: dateStr,
        time: null,
        ticketUrl: resolveUrl(href, 'https://www.eventbrite.com'),
        imageUrl: null,
        sourceUrl: resolveUrl(href, 'https://www.eventbrite.com') || venueConfig.eventsUrl,
      }))
    })

    return shows.length ? shows : null
  } catch {
    return null
  }
}

// ─── Strategy 5: Generic HTML ───────────────────────────────────────────────
// Battery of common event-list patterns. Tries each selector set and picks
// whichever returns the most results.

const GENERIC_PATTERNS = [
  // Pattern A — explicit event item classes
  {
    wrap: '.event-item, .event-listing, .show-item, .show-listing, .concert-item',
    title: 'h1, h2, h3, h4, .event-title, .show-title, .title, .name',
    date: 'time[datetime], .event-date, .show-date, .date, [class*="date"]',
    link: 'a[href]',
    img: 'img',
  },
  // Pattern B — article/section cards
  {
    wrap: 'article, .card, [class*="event-card"], [class*="show-card"]',
    title: 'h1, h2, h3, h4',
    date: 'time[datetime], [class*="date"], [class*="when"]',
    link: 'a[href]',
    img: 'img',
  },
  // Pattern C — list items
  {
    wrap: 'li[class*="event"], li[class*="show"], li[class*="concert"]',
    title: 'h2, h3, h4, strong, b, .title',
    date: 'time, [class*="date"]',
    link: 'a[href]',
    img: 'img',
  },
  // Pattern D — table rows (some venue sites use tables)
  {
    wrap: 'tr[class*="event"], tr[class*="show"], tbody > tr',
    title: 'td:first-child, .artist, .show-name',
    date: 'td[class*="date"], time',
    link: 'a[href]',
    img: null,
  },
]

function scrapeGenericHtml($, venueConfig) {
  let best = []

  for (const pattern of GENERIC_PATTERNS) {
    const items = $(pattern.wrap)
    if (items.length < 2) continue  // skip if too few matches — likely wrong selector

    const shows = []
    items.each((_, el) => {
      const title = $(el).find(pattern.title).first().text().trim()
      const dateEl = $(el).find(pattern.date).first()
      const rawDate = dateEl.attr('datetime') || dateEl.text().trim()
      const dateStr = parseDate(rawDate)
      if (!title || title.length < 3) return
      if (!isUpcoming(dateStr)) return

      const href = $(el).find(pattern.link).first().attr('href')
      const src = pattern.img ? $(el).find(pattern.img).first().attr('src') : null

      shows.push(normalizeShow({
        id: makeShowId(venueConfig.id, dateStr, title),
        title,
        date: dateStr,
        time: null,
        ticketUrl: resolveUrl(href, venueConfig.eventsUrl),
        imageUrl: resolveUrl(src, venueConfig.eventsUrl),
        sourceUrl: resolveUrl(href, venueConfig.eventsUrl) || venueConfig.eventsUrl,
      }))
    })

    if (shows.length > best.length) best = shows
  }

  return best.length ? best : null
}

// ─── Main engine entry point ─────────────────────────────────────────────────

export async function scrapeVenue(venueConfig) {
  if (!venueConfig.eventsUrl) {
    return []  // map-only venue, no scraping
  }

  let html
  try {
    html = await fetchHtml(venueConfig.eventsUrl)
  } catch (err) {
    // Try homepage events path as fallback
    if (venueConfig.url && venueConfig.eventsUrl !== venueConfig.url + '/events') {
      try {
        html = await fetchHtml(venueConfig.url + '/events')
      } catch {
        throw new Error(`Failed to fetch ${venueConfig.eventsUrl}: ${err.message}`)
      }
    } else {
      throw err
    }
  }

  const $ = cheerio.load(html)

  // Strategy 1: JSON-LD
  const jsonLdShows = scrapeJsonLd(html, $, venueConfig)
  if (jsonLdShows) {
    console.log(`    ✓ JSON-LD: ${jsonLdShows.length} shows`)
    return sortAndDedup(jsonLdShows)
  }

  // Strategy 2: Bandsintown widget
  const btShows = await scrapeBandsintown(html, $, venueConfig)
  if (btShows) {
    console.log(`    ✓ Bandsintown: ${btShows.length} shows`)
    return sortAndDedup(btShows)
  }

  // Strategy 3: Songkick widget
  const skShows = await scrapeSongkick($, venueConfig)
  if (skShows) {
    console.log(`    ✓ Songkick: ${skShows.length} shows`)
    return sortAndDedup(skShows)
  }

  // Strategy 4: Eventbrite embed
  const ebShows = await scrapeEventbrite(html, $, venueConfig)
  if (ebShows) {
    console.log(`    ✓ Eventbrite: ${ebShows.length} shows`)
    return sortAndDedup(ebShows)
  }

  // Strategy 5: Generic HTML
  const genericShows = scrapeGenericHtml($, venueConfig)
  if (genericShows) {
    console.log(`    ✓ Generic HTML: ${genericShows.length} shows`)
    return sortAndDedup(genericShows)
  }

  console.log('    ✗ No shows found (page may require JS rendering)')
  return []
}

function sortAndDedup(shows) {
  return dedup(shows).sort((a, b) => (a.date || '').localeCompare(b.date || ''))
}
