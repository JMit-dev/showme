import { parse, parseISO, isValid, isFuture, isToday, format } from 'date-fns'

const DATE_FORMATS = [
  'yyyy-MM-dd',
  'MM/dd/yyyy',
  'M/d/yyyy',
  'MMMM d, yyyy',
  'MMM d, yyyy',
  'EEEE, MMMM d, yyyy',
  'EEEE, MMM d, yyyy',
  'MMM d',
  'MMMM d',
]

export function parseDate(raw) {
  if (!raw) return null
  const cleaned = raw.trim().replace(/\s+/g, ' ')

  // Try ISO first
  try {
    const d = parseISO(cleaned)
    if (isValid(d)) return format(d, 'yyyy-MM-dd')
  } catch {}

  // Try common formats
  for (const fmt of DATE_FORMATS) {
    try {
      const d = parse(cleaned, fmt, new Date())
      if (isValid(d)) return format(d, 'yyyy-MM-dd')
    } catch {}
  }

  return null
}

export function isUpcoming(dateStr) {
  if (!dateStr) return false
  try {
    const d = parseISO(dateStr)
    return isFuture(d) || isToday(d)
  } catch {
    return false
  }
}

export function slugify(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

export function makeShowId(venueId, dateStr, title) {
  return `${venueId}-${dateStr || 'nodate'}-${slugify(title)}`
}

export function dedup(shows) {
  const seen = new Set()
  return shows.filter(show => {
    const key = `${show.date}-${slugify(show.title)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function resolveUrl(url, base) {
  if (!url) return null
  try {
    return new URL(url, base).href
  } catch {
    return url
  }
}

export function normalizeShow(show) {
  return {
    id: show.id || null,
    title: show.title || null,
    date: show.date || null,
    time: show.time || null,
    doors: show.doors || null,
    ticketUrl: show.ticketUrl || null,
    imageUrl: show.imageUrl || null,
    price: show.price || null,
    ages: show.ages || null,
    description: show.description || null,
    sourceUrl: show.sourceUrl || null,
  }
}

// Extract JSON-LD event data from HTML
export function extractJsonLd(html, $) {
  const shows = []
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html())
      const items = Array.isArray(json) ? json : [json]
      for (const item of items) {
        if (item['@type'] === 'Event' || item['@type'] === 'MusicEvent') {
          shows.push(item)
        }
      }
    } catch {}
  })
  return shows
}

export const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; showme-bot/1.0; +https://github.com/showme)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
