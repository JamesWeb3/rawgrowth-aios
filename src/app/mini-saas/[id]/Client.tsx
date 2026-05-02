"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RefreshCw, Code2, Eye, Trash2, ExternalLink } from "lucide-react";

type App = {
  id: string;
  title: string;
  description: string | null;
  prompt: string;
  generated_html: string | null;
  status: string;
  generation_meta: Record<string, unknown> | null;
};

export function MiniSaasDetailClient({ app }: { app: App }) {
  const router = useRouter();
  const [tab, setTab] = useState<"preview" | "prompt" | "code">("preview");
  const [prompt, setPrompt] = useState(app.prompt);
  const [regenerating, setRegenerating] = useState(false);

  // Render via srcDoc - simplest + most reliable. Blob-URL approach
  // raced against React 19 strict-mode dev double-mount + Turbopack
  // cleanup; not worth the storage gain. localStorage falls back to
  // an in-memory shim added below.
  const dataUrl =
    app.generated_html
      ? `data:text/html;charset=utf-8,${encodeURIComponent(app.generated_html)}`
      : null;

  async function regenerate() {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/mini-saas/${app.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const body = (await res.json()) as { status?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast.success("Regenerated");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRegenerating(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${app.title}"? This is permanent.`)) return;
    try {
      const res = await fetch(`/api/mini-saas/${app.id}`, { method: "DELETE" });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "delete failed");
      toast.success("Deleted");
      // refresh the list page's server data BEFORE we navigate, so the
      // user lands on /mini-saas already showing the row gone instead
      // of a stale cached copy.
      router.refresh();
      router.push("/mini-saas");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-md border border-border bg-card/30 p-1">
          {(
            [
              { id: "preview" as const, label: "Preview", Icon: Eye },
              { id: "prompt" as const, label: "Prompt", Icon: RefreshCw },
              { id: "code" as const, label: "Code", Icon: Code2 },
            ]
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                "inline-flex items-center gap-1.5 rounded-[min(var(--radius-md),12px)] px-3 py-1.5 text-[12px] font-medium transition-colors " +
                (tab === t.id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              <t.Icon className="size-3.5" />
              {t.label}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={remove}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {tab === "preview" && (
        <div className="overflow-hidden rounded-md border border-border bg-card/30">
          {app.status === "generating" ? (
            <div className="flex h-[600px] items-center justify-center text-muted-foreground">
              Generating... (~10-30s)
            </div>
          ) : app.status === "failed" ? (
            <div className="p-6 text-sm text-destructive">
              <p className="font-medium">Generation failed</p>
              <p className="mt-2 font-mono text-[12px]">
                {String(
                  (app.generation_meta as { error?: string } | null)?.error ??
                    "unknown",
                )}
              </p>
            </div>
          ) : app.generated_html ? (
            <div>
              <iframe
                title={app.title}
                srcDoc={app.generated_html}
                sandbox="allow-scripts allow-forms"
                className="h-[640px] w-full bg-[#0A1210]"
              />
              <div className="flex items-center justify-between border-t border-border bg-card/30 px-3 py-2 text-[11px] text-muted-foreground">
                <span>
                  Sandboxed iframe. Buttons + state work; localStorage is
                  isolated.
                </span>
                {dataUrl && (
                  <a
                    href={dataUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:text-primary/80"
                  >
                    Open full screen
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-[600px] items-center justify-center text-muted-foreground">
              Nothing yet.
            </div>
          )}
        </div>
      )}

      {tab === "prompt" && (
        <div className="space-y-3">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={14}
            className="w-full rounded-md border border-border bg-card/30 px-3 py-2 font-mono text-[12px] leading-relaxed"
          />
          <Button
            size="sm"
            onClick={regenerate}
            disabled={regenerating || prompt.trim().length === 0}
          >
            <RefreshCw
              className={"mr-1.5 size-3.5 " + (regenerating ? "animate-spin" : "")}
            />
            {regenerating ? "Regenerating..." : "Regenerate"}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Tweak the prompt + hit Regenerate to iterate. Old version is
            replaced; preview tab refreshes on next load.
          </p>
        </div>
      )}

      {tab === "code" && (
        <div className="overflow-hidden rounded-md border border-border bg-card/30">
          <pre className="max-h-[640px] overflow-auto p-4 font-mono text-[11px] leading-relaxed text-foreground">
            {app.generated_html ?? "(nothing generated yet)"}
          </pre>
        </div>
      )}
    </div>
  );
}
