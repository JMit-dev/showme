import { useQuery } from '@tanstack/react-query'

export function useShows() {
  return useQuery({
    queryKey: ['shows'],
    queryFn: async () => {
      const res = await fetch('/showme/data/shows.json')
      if (!res.ok) throw new Error('Failed to fetch shows')
      return res.json()
    },
    staleTime: 1000 * 60 * 60,
    retry: 2,
  })
}

export function useVenues() {
  return useQuery({
    queryKey: ['venues'],
    queryFn: async () => {
      const res = await fetch('/showme/data/venues.json')
      // venues.json may not exist yet (before first discovery run) — return empty gracefully
      if (!res.ok) return { venues: [] }
      return res.json()
    },
    staleTime: 1000 * 60 * 60 * 6,  // 6 hours — venue list changes slowly
    retry: 1,
  })
}
