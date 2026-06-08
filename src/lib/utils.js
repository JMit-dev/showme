import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, parseISO, isWithinInterval, addDays, startOfDay, endOfDay } from 'date-fns'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

// Decode HTML entities (e.g. &#038; → &, &amp; → &) for browser context
export function decodeHtml(str) {
  if (!str || typeof document === 'undefined') return str
  const el = document.createElement('textarea')
  el.innerHTML = str
  return el.value
}

export function formatShowDate(dateStr) {
  if (!dateStr) return 'TBA'
  try {
    return format(parseISO(dateStr), 'EEE, MMM d')
  } catch {
    return dateStr
  }
}

export function formatShowDateLong(dateStr) {
  if (!dateStr) return 'TBA'
  try {
    return format(parseISO(dateStr), 'EEEE, MMMM d, yyyy')
  } catch {
    return dateStr
  }
}

export function isThisWeek(dateStr) {
  if (!dateStr) return false
  try {
    const date = parseISO(dateStr)
    const today = startOfDay(new Date())
    const weekEnd = endOfDay(addDays(today, 7))
    return isWithinInterval(date, { start: today, end: weekEnd })
  } catch {
    return false
  }
}

export function isThisMonth(dateStr) {
  if (!dateStr) return false
  try {
    const date = parseISO(dateStr)
    const today = startOfDay(new Date())
    const monthEnd = endOfDay(addDays(today, 30))
    return isWithinInterval(date, { start: today, end: monthEnd })
  } catch {
    return false
  }
}

export function getAllShows(venuesData) {
  if (!venuesData) return []
  return Object.values(venuesData)
    .flatMap(venue => (venue.shows || []).map(show => ({ ...show, venueName: venue.name, venueId: venue.id })))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
}

export function isToday(dateStr) {
  if (!dateStr) return false
  try {
    return dateStr === format(new Date(), 'yyyy-MM-dd')
  } catch {
    return false
  }
}

export function filterShows(shows, { venueIds, dateRange, search }) {
  return shows.filter(show => {
    if (venueIds && venueIds.length > 0 && !venueIds.includes(show.venueId)) return false
    if (dateRange === 'today' && !isToday(show.date)) return false
    if (dateRange === 'week' && !isThisWeek(show.date)) return false
    if (dateRange === 'month' && !isThisMonth(show.date)) return false
    if (search) {
      const q = search.toLowerCase()
      const inTitle = show.title?.toLowerCase().includes(q)
      const inVenue = show.venueName?.toLowerCase().includes(q)
      if (!inTitle && !inVenue) return false
    }
    return true
  })
}
