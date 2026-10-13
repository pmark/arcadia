export function PullRequestInventorySkeleton() {
  return (
    <section className="grid min-w-0 gap-3" aria-busy="true" aria-label="Loading pull-request inventory">
      <p className="text-sm text-muted" role="status">Scanning configured repositories for pull requests…</p>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="min-h-48 animate-pulse rounded-md border border-line bg-panel p-4 shadow-soft" aria-hidden="true">
          <div className="h-3 w-1/3 rounded bg-line/70" />
          <div className="mt-3 h-5 w-4/5 rounded bg-line/70" />
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="h-10 rounded bg-line/50" />
            <div className="h-10 rounded bg-line/50" />
          </div>
          <div className="mt-4 h-12 rounded bg-line/50" />
        </div>
      ))}
    </section>
  );
}
