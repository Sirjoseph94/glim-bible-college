/** Two hairlines with a few words between them, e.g. "or use your email" (§9.21). */
export function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-body-sm text-ink-muted">
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
      {label}
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
    </div>
  );
}
