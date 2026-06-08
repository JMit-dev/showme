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
 *   6. Puppeteer  (JS-rendered pages — last resort)
 */

import * as cheerio from 'cheerio'
import axios from 'axios'
import axiosRetry from 'axios-retry'
import {
  parseDate, isUpcoming, makeShowId, dedup, resolveUrl,
  normalizeShow, extractJsonLd, DEFAULT_HEADERS, sleep,
} from './utils.js'

axiosRetry(axios, { retries: 2, retryDelay: axiosRetry.exponentialDelay })

// Nav link text that signals an events/calendar page
const EVENTS_NAV_PATTERNS = /^(events?|shows?|calendar|concerts?|tickets?|schedule|gigs?|performances?)$/i
// Common path segments for events pages
const EVENTS_PATHS = ['/events', '/shows', '/calendar', '/concerts', '/tickets', '/schedule', '/live']

async function fetchHtml(url, timeout = 12000) {
  const { data } = await axios.get(url, { timeout, headers: DEFAULT_HEADERS })
  return data
}

/**
 * Crawl the venue homepage to find the real events URL.
 * Returns the URL that contains event data, or null.
 */
async function findEventsUrl(venueConfig) {
  const base = venueConfig.url
  if (!base) return null

  let homepageHtml
  try {
    homepageHtml = await fetchHtml(base)
  } catch {
    return null
  }

  const $ = cheerio.load(homepageHtml)

  // 1. Look for nav/menu links whose visible text matches events keywords
  const candidates = new Set()
  $('a[href]').each((_, el) => {
    const text = $(el).text().trim()
    const href = $(el).attr('href')
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return
    if (EVENTS_NAV_PATTERNS.test(text)) {
      candidates.add(resolveUrl(href, base))
    }
  })

  // 2. Try known common paths
  for (const p of EVENTS_PATHS) {
    try {
      const u = new URL(p, base).href
      candidates.add(u)
    } catch {}
  }

  // Try each candidate — return first one that actually loads and has content
  for (const url of candidates) {
    if (url === base) continue
    try {
      const html = await fetchHtml(url, 8000)
      if (html && html.length > 500) return { url, html }
    } catch {}
    await sleep(300)
  }

  // Fall back: homepage itself might have event data
  return { url: base, html: homepageHtml }
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

// ─── Strategy 1b: Next.js __NEXT_DATA__ ────────────────────────────────────
// Handles venues using Next.js SSG where event data is embedded as JSON.
// Currently covers Stephen Talkhouse (allEventsV2 / Tixr integration).

function scrapeNextData(html, venueConfig) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/)
  if (!match) return null

  let json
  try { json = JSON.parse(match[1]) } catch { return null }

  const pageProps = json.props?.pageProps || {}

  // Pattern: allEventsV2 (Stephen Talkhouse / Tixr)
  const events = pageProps.allEventsV2 || pageProps.events || pageProps.upcomingEvents || []
  if (!Array.isArray(events) || !events.length) return null

  const shows = []
  for (const ev of events) {
    // fullDate is "M/D/YYYY" or startDate ISO
    const rawDate = ev.fullDate || ev.startDate || ev.date || ''
    const dateStr = parseDate(rawDate)
    if (!isUpcoming(dateStr)) continue

    const price = ev.prices?.minPrice != null
      ? `$${Number(ev.prices.minPrice).toFixed(0)}`
      : null

    shows.push(normalizeShow({
      id: makeShowId(venueConfig.id, dateStr, ev.name || ev.title),
      title: ev.name || ev.title || 'TBA',
      date: dateStr,
      time: ev.hour || ev.startTime || null,
      ticketUrl: ev.url || null,
      imageUrl: ev.image || null,
      price,
      sourceUrl: ev.url || venueConfig.eventsUrl,
    }))
  }

  return shows.length ? shows : null
}

// ─── Strategy 1c: Booketing.com (UrVenue) ──────────────────────────────────
// 89 North and other venues on booketing.com embed events in a static
// calendar table: td[class*="uvtddate-YYYY-MM-DD"] > a.flyer > .name

function scrapeBooketing(html, $, venueConfig) {
  if (!venueConfig.eventsUrl?.includes('booketing.com')) return null

  const shows = []
  $('td[class*="uvtddate-"]').each((_, td) => {
    const cls = $(td).attr('class') || ''
    const dateMatch = cls.match(/uvtddate-(\d{4}-\d{2}-\d{2})/)
    if (!dateMatch) return
    const dateStr = dateMatch[1]
    if (!isUpcoming(dateStr)) return
    $(td).find('a.flyer').each((_, a) => {
      const name = $(a).find('.name').text().trim()
      const href = $(a).attr('href')
      if (!name) return
      const ticketUrl = href ? `https://booketing.com${href}` : null
      shows.push(normalizeShow({
        id: makeShowId(venueConfig.id, dateStr, name),
        title: name,
        date: dateStr,
        time: null,
        ticketUrl,
        imageUrl: null,
        sourceUrl: ticketUrl || venueConfig.eventsUrl,
      }))
    })
  })

  return shows.length ? shows : null
}

// ─── Strategy 2: Bandsintown widget ─────────────────────────────────────────

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

  try {
    const { data } = await axios.get(
      `https://www.songkick.com/venues/${skId}/calendar.json`,
      { timeout: 8000, headers: DEFAULT_HEADERS }
    )
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

async function scrapeEventbrite(html, $, venueConfig) {
  // Match "organization":"265799640839", "organizer_id":123, organizerId=123, etc.
  const orgMatch = html.match(/(?:organizer[_-]?id|organization)["'\s:=]+(\d{8,})/i)
  const orgId = orgMatch?.[1]
  if (!orgId) return null

  try {
    const ebHtml = await fetchHtml(`https://www.eventbrite.com/o/${orgId}/`)
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

const GENERIC_PATTERNS = [
  // Squarespace event list (Lily's Babylon, etc.)
  {
    wrap: 'article[class*="eventlist-event"]',
    title: '[class*="eventlist-title"]',
    date: 'time.event-date[datetime]',
    link: 'a[class*="eventlist-title"]',
    img: 'img',
  },
  {
    wrap: '.event-item, .event-listing, .show-item, .show-listing, .concert-item',
    title: 'h1, h2, h3, h4, .event-title, .show-title, .title, .name',
    date: 'time[datetime], .event-date, .show-date, .date, [class*="date"]',
    link: 'a[href]',
    img: 'img',
  },
  {
    wrap: 'article, .card, [class*="event-card"], [class*="show-card"]',
    title: 'h1, h2, h3, h4',
    date: 'time[datetime], [class*="date"], [class*="when"]',
    link: 'a[href]',
    img: 'img',
  },
  {
    wrap: 'li[class*="event"], li[class*="show"], li[class*="concert"]',
    title: 'h2, h3, h4, strong, b, .title',
    date: 'time, [class*="date"]',
    link: 'a[href]',
    img: 'img',
  },
  {
    wrap: 'tr[class*="event"], tr[class*="show"], tbody > tr',
    title: 'td:first-child, .artist, .show-name',
    date: 'td[class*="date"], time',
    link: 'a[href]',
    img: null,
  },
]

function scrapeGenericHtml($, venueConfig, pageUrl) {
  let best = []

  for (const pattern of GENERIC_PATTERNS) {
    const items = $(pattern.wrap)
    if (items.length < 2) continue

    const shows = []
    items.each((_, el) => {
      const title = $(el).find(pattern.title).first().text().trim()
      // Try datetime attribute first (avoids picking up container elements)
      const timeEl = $(el).find('time[datetime]').first()
      const dateEl = timeEl.length ? timeEl : $(el).find(pattern.date).first()
      const rawDate = dateEl.attr('datetime') || dateEl.text().trim()
      const dateStr = parseDate(rawDate)
      if (!title || title.length < 3 || !isUpcoming(dateStr)) return

      const href = $(el).find(pattern.link).first().attr('href')
      const src = pattern.img ? $(el).find(pattern.img).first().attr('src') : null

      shows.push(normalizeShow({
        id: makeShowId(venueConfig.id, dateStr, title),
        title,
        date: dateStr,
        time: null,
        ticketUrl: resolveUrl(href, pageUrl),
        imageUrl: resolveUrl(src, pageUrl),
        sourceUrl: resolveUrl(href, pageUrl) || pageUrl,
      }))
    })

    if (shows.length > best.length) best = shows
  }

  return best.length ? best : null
}

// ─── Strategy 6: Puppeteer ──────────────────────────────────────────────────
// Only used when static strategies all fail. Dynamically imported to keep
// startup fast for venues that don't need it.

const MONTH_MAP = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' }

// Parse Wix Events date string: "Jun 11, 2026, 8:00 PM – 10:00 PM"
// Parses date parts directly to avoid UTC offset issues.
function parseWixDate(str) {
  const m = str.match(/^(\w{3})\s+(\d{1,2}),\s+(\d{4}),\s+(\d{1,2}:\d{2}\s+[AP]M)/)
  if (!m) return { date: null, time: null }
  const [, mon, day, year, time] = m
  const mm = MONTH_MAP[mon]
  if (!mm) return { date: null, time: null }
  return { date: `${year}-${mm}-${day.padStart(2,'0')}`, time }
}

async function scrapeWithPuppeteer(url, venueConfig) {
  let puppeteer, chromium
  try {
    const [pCore, chrom] = await Promise.all([
      import('puppeteer-core'),
      import('@sparticuz/chromium'),
    ])
    puppeteer = pCore.default
    chromium = chrom.default
  } catch {
    return null
  }

  let browser
  try {
    const executablePath = process.env.CHROMIUM_PATH || await chromium.executablePath()

    browser = await puppeteer.launch({
      args: [...chromium.args, '--window-size=1920,1080'],
      defaultViewport: { width: 1920, height: 1080 },
      executablePath,
      headless: chromium.headless,
    })

    const page = await browser.newPage()
    await page.setExtraHTTPHeaders(DEFAULT_HEADERS)
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 35000 })
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await new Promise(r => setTimeout(r, 3000))

    // Wix Events: stable data-hook attributes survive obfuscated class names
    const wixEvents = await page.evaluate(() => {
      const items = [...document.querySelectorAll('[data-hook="event-list-item"]')]
      return items.map(item => ({
        title: item.querySelector('[data-hook="ev-list-item-title"]')?.textContent?.trim(),
        date: item.querySelector('[data-hook="date"]')?.textContent?.trim(),
        ticketUrl: item.querySelector('[data-hook="ev-rsvp-button"]')?.href || null,
      })).filter(e => e.title && e.date)
    })

    if (wixEvents.length) {
      const shows = []
      for (const ev of wixEvents) {
        const { date: dateStr, time } = parseWixDate(ev.date)
        if (!isUpcoming(dateStr)) continue
        shows.push(normalizeShow({
          id: makeShowId(venueConfig.id, dateStr, ev.title),
          title: ev.title,
          date: dateStr,
          time,
          ticketUrl: ev.ticketUrl || null,
          imageUrl: null,
          sourceUrl: ev.ticketUrl || venueConfig.eventsUrl,
        }))
      }
      if (shows.length) {
        console.log(`    ✓ Wix Events: ${shows.length} shows`)
        return shows
      }
    }

    const html = await page.content()
    const $ = cheerio.load(html)

    // Run static strategies on the rendered HTML
    const jsonLd = scrapeJsonLd(html, $, venueConfig)
    if (jsonLd) return jsonLd

    const bt = await scrapeBandsintown(html, $, venueConfig)
    if (bt) return bt

    const nextData = scrapeNextData(html, venueConfig)
    if (nextData) return nextData

    const generic = scrapeGenericHtml($, venueConfig, url)
    if (generic) return generic

    return null
  } catch (err) {
    console.log(`    Puppeteer error: ${err.message}`)
    return null
  } finally {
    if (browser) await browser.close()
  }
}

// ─── Main engine entry point ─────────────────────────────────────────────────

export async function scrapeVenue(venueConfig) {
  if (!venueConfig.eventsUrl && !venueConfig.url) return []

  // Step 1: get HTML. Try eventsUrl first, then crawl homepage to find real events URL.
  let html = null
  let pageUrl = venueConfig.eventsUrl

  if (venueConfig.eventsUrl) {
    try {
      html = await fetchHtml(venueConfig.eventsUrl)
    } catch {
      // eventsUrl failed — fall through to homepage crawl
    }
  }

  // If direct fetch failed or eventsUrl was just a guess, crawl homepage for real link
  if (!html || html.length < 500) {
    const found = await findEventsUrl(venueConfig)
    if (found) {
      html = found.html
      pageUrl = found.url
      if (pageUrl !== venueConfig.eventsUrl) {
        console.log(`    → found events at ${pageUrl}`)
      }
    }
  }

  if (!html) {
    throw new Error(`Could not load any page for ${venueConfig.name}`)
  }

  const $ = cheerio.load(html)

  // Strategy 1: JSON-LD
  const jsonLdShows = scrapeJsonLd(html, $, venueConfig)
  if (jsonLdShows) {
    console.log(`    ✓ JSON-LD: ${jsonLdShows.length} shows`)
    return sortAndDedup(jsonLdShows)
  }

  // Strategy 1b: Booketing.com calendar table
  const booketingShows = scrapeBooketing(html, $, venueConfig)
  if (booketingShows) {
    console.log(`    ✓ Booketing.com: ${booketingShows.length} shows`)
    return sortAndDedup(booketingShows)
  }

  // Strategy 1c: Next.js __NEXT_DATA__ embedded JSON
  const nextShows = scrapeNextData(html, venueConfig)
  if (nextShows) {
    console.log(`    ✓ Next.js data: ${nextShows.length} shows`)
    return sortAndDedup(nextShows)
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
  const genericShows = scrapeGenericHtml($, venueConfig, pageUrl)
  if (genericShows) {
    console.log(`    ✓ Generic HTML: ${genericShows.length} shows`)
    return sortAndDedup(genericShows)
  }

  // Strategy 6: Puppeteer — JS-rendered page
  console.log('    → static scraping failed, trying Puppeteer...')
  const puppeteerShows = await scrapeWithPuppeteer(pageUrl, venueConfig)
  if (puppeteerShows) {
    console.log(`    ✓ Puppeteer: ${puppeteerShows.length} shows`)
    return sortAndDedup(puppeteerShows)
  }

  console.log('    ✗ No shows found')
  return []
}

function sortAndDedup(shows) {
  return dedup(shows).sort((a, b) => (a.date || '').localeCompare(b.date || ''))
}
