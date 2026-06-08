/**
 * Template for new venue scrapers.
 * Copy this file, rename it to <venueId>.js, and implement the scrape logic.
 *
 * Strategy order (try each, stop at first success):
 * 1. JSON-LD / <script type="application/ld+json">
 * 2. Embedded widget data (Eventbrite iframe, window.__INITIAL_STATE__, etc.)
 * 3. Static HTML cheerio selectors
 * 4. Puppeteer (JS-rendered pages only — last resort)
 *
 * Inspect the live page first:
 *   curl -sA 'Mozilla/5.0' https://venue-url/events | grep -i 'event\|show\|concert' | head -60
 */

import * as cheerio from 'cheerio'
import axios from 'axios'
import {
  parseDate, isUpcoming, makeShowId, dedup, resolveUrl,
  normalizeShow, extractJsonLd, DEFAULT_HEADERS,
} from '../utils.js'

export default async function scrapeTemplate(venueConfig) {
  const { data: html } = await axios.get(venueConfig.eventsUrl, {
    timeout: 10000,
    headers: DEFAULT_HEADERS,
  })

  const $ = cheerio.load(html)
  let shows = []

  // --- Strategy 1: JSON-LD ---
  const jsonLdEvents = extractJsonLd(html, $)
  if (jsonLdEvents.length > 0) {
    for (const event of jsonLdEvents) {
      const dateStr = parseDate(event.startDate)
      if (!isUpcoming(dateStr)) continue
      shows.push(normalizeShow({
        id: makeShowId(venueConfig.id, dateStr, event.name),
        title: event.name,
        date: dateStr,
        time: event.startDate ? new Date(event.startDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null,
        ticketUrl: event.url || event.offers?.url || null,
        imageUrl: resolveUrl(event.image, venueConfig.eventsUrl),
        price: event.offers?.price ? `$${event.offers.price}` : null,
        description: event.description || null,
        sourceUrl: event.url || venueConfig.eventsUrl,
      }))
    }
    if (shows.length > 0) return dedup(shows)
  }

  // --- Strategy 2/3: HTML selectors ---
  // TODO: inspect live page and implement selectors
  // $('selector-for-event').each((i, el) => {
  //   const title = $(el).find('.title').text().trim()
  //   const rawDate = $(el).find('.date').text().trim()
  //   const dateStr = parseDate(rawDate)
  //   if (!isUpcoming(dateStr)) return
  //   shows.push(normalizeShow({ ... }))
  // })

  return dedup(shows).sort((a, b) => (a.date || '').localeCompare(b.date || ''))
}
