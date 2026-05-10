import Link from "next/link";

/**
 * Friendly 404 for /departments/<unknown-slug>. The page calls
 * `notFound()` for any slug not in DEFAULT_DEPARTMENTS so URL-typing
 * "/departments/customer" or "/departments/customer-success" lands
 * here instead of the generic site 404. Keeps the user inside the
 * departments scope with a quick path back.
 */
export default function DepartmentNotFound() {
  return (
    <div className="mx-auto max-w-xl px-6 py-24">
      <div className="rounded-lg border border-dashed border-border bg-card/30 p-10 text-center">
        <p className="text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
          Department not found
        </p>
        <h1 className="mt-3 font-serif text-3xl tracking-tight text-foreground">
          That department doesn&apos;t exist
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          The five seeded departments are Marketing, Sales, Fulfilment,
          Finance, and Development. Custom departments live on the index.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Link
            href="/departments"
            className="inline-flex h-8 items-center rounded-[min(var(--radius-md),12px)] border border-border px-3 text-sm hover:border-primary/40"
          >
            All departments
          </Link>
          <Link
            href="/"
            className="inline-flex h-8 items-center rounded-[min(var(--radius-md),12px)] border border-border px-3 text-sm hover:border-primary/40"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
