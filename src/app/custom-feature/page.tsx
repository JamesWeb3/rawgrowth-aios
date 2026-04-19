import { Sparkles } from "lucide-react";

export const metadata = {
  title: "Custom Feature — Rawgrowth",
};

export default function CustomFeaturePage() {
  return (
    <div className="flex min-h-svh flex-col">
      <main className="relative flex flex-1 items-center justify-center p-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(12,191,106,.05),transparent_60%)]" />
        <div className="relative flex max-w-md flex-col items-center text-center">
          <div className="mb-5 flex size-12 items-center justify-center rounded-xl border border-border bg-primary/10 text-primary">
            <Sparkles className="size-5" />
          </div>
          <h2 className="font-serif text-2xl font-normal tracking-tight text-foreground">
            Request a feature for Rawgrowth team to build out
          </h2>
        </div>
      </main>
    </div>
  );
}
