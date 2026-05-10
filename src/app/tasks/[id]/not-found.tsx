import Link from "next/link";

import { PageShell } from "@/components/page-shell";

// Custom 404 for /tasks/[id]. Mirrors the friendly tone of the public
// booking 404 so a stale demo link reads as "this is gone" instead of
// rendering the empty "Task" shell that confused Chris in tab sweep.
export default function TaskNotFound() {
  return (
    <PageShell title="Task" description="Routine + every run + agent output">
      <div className="mx-auto max-w-xl">
        <div className="rounded-lg border border-dashed border-border bg-card/30 p-10 text-center">
          <p className="text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
            404
          </p>
          <h1 className="mt-3 font-serif text-3xl tracking-tight text-foreground">
            Task not found
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            This routine may have been deleted, or the link points at an
            org you no longer belong to. Head back to the routines list
            to find what you were after.
          </p>
          <Link
            href="/tasks"
            className="mt-6 inline-block rounded-md border border-border px-4 py-2 text-sm text-foreground transition-colors hover:border-primary/40 hover:text-primary"
          >
            Back to routines
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
