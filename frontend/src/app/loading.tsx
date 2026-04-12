export default function GlobalLoading() {
  return (
    <div className="p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="h-8 w-56 animate-pulse rounded bg-card-border" />
        <div className="h-32 animate-pulse rounded-xl bg-card-border" />
        <div className="h-32 animate-pulse rounded-xl bg-card-border" />
      </div>
    </div>
  );
}
