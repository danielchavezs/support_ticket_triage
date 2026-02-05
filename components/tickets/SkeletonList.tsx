export default function SkeletonList(props: { rows?: number }) {
  const rows = props.rows ?? 4;
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3">
          <div className="flex items-center gap-2">
            <div className="h-4 w-16 animate-pulse rounded-full bg-zinc-100" />
            <div className="h-4 w-20 animate-pulse rounded-full bg-zinc-100" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-100" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-zinc-50" />
          </div>
        </div>
      ))}
    </div>
  );
}

