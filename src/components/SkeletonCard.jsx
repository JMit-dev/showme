export default function SkeletonCard({ compact = false }) {
  return (
    <div className={`rounded-lg border border-[#2a2a2a] bg-[#111111] animate-pulse ${compact ? 'p-3' : 'p-4'}`}>
      <div className="space-y-2">
        <div className="flex justify-between gap-2">
          <div className={`rounded bg-[#2a2a2a] ${compact ? 'h-4 w-3/5' : 'h-6 w-4/5'}`} />
          <div className="h-6 w-16 rounded bg-[#2a2a2a]" />
        </div>
        <div className="h-3 w-1/3 rounded bg-[#1f1f1f]" />
        {!compact && (
          <>
            <div className="h-3 w-1/2 rounded bg-[#1f1f1f]" />
            <div className="flex gap-2">
              <div className="h-5 w-12 rounded bg-[#1f1f1f]" />
              <div className="h-5 w-10 rounded bg-[#1f1f1f]" />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function VenueCardSkeleton() {
  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#111111] animate-pulse">
      <div className="p-5">
        <div className="flex justify-between">
          <div className="space-y-2">
            <div className="h-7 w-40 rounded bg-[#2a2a2a]" />
            <div className="h-3 w-24 rounded bg-[#1f1f1f]" />
          </div>
        </div>
      </div>
      <div className="border-t border-[#2a2a2a] px-4 py-3 space-y-2">
        <SkeletonCard compact />
        <SkeletonCard compact />
      </div>
    </div>
  )
}
