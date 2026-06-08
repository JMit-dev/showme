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
