// Custom 404 for the public booking surface. Inherits the dark brand
// theme since the AppShell isn't mounted on /book/*.
export default function BookNotFound() {
  return (
    <div className="mx-auto max-w-xl px-6 py-24">
      <div className="rounded-lg border border-dashed border-border bg-card/30 p-10 text-center">
        <p className="text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
          404
        </p>
        <h1 className="mt-3 font-serif text-3xl tracking-tight text-foreground">
          We couldn&apos;t find that booking page
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          Double-check the URL with the person who shared it - the org slug
          or the event-type slug may be wrong, or the event may have been
          taken offline.
        </p>
      </div>
    </div>
  );
}
