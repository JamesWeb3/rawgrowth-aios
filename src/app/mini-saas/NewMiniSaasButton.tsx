"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function NewMiniSaasButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Esc closes the modal. Without this, the dialog had no keyboard
  // dismiss (only the X button), which broke a11y expectations and
  // tripped Playwright role=dialog probes.
  useEffect(() => {
    if (!open) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape" && !submitting) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting]);

  async function submit() {
    if (!title.trim() || !prompt.trim()) {
      toast.error("title and prompt required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/mini-saas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim(), prompt: prompt.trim() }),
      });
      const body = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !body.id) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success("mini SaaS generated");
      setOpen(false);
      setTitle("");
      setPrompt("");
      router.push(`/mini-saas/${body.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        className="h-7 text-[0.8rem] font-medium"
      >
        <Plus className="mr-1 size-3.5" />
        New mini SaaS
      </Button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        // Backdrop click closes; clicks inside the panel are stopped below.
        if (e.target === e.currentTarget && !submitting) setOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-mini-saas-title"
        className="w-[560px] max-w-[90vw] rounded-lg border border-border bg-card p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2
            id="new-mini-saas-title"
            className="font-serif text-xl tracking-tight"
          >
            New mini SaaS
          </h2>
          <button
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-[1.5px] text-muted-foreground">
              Title
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="CAC payback calculator"
              className="h-9 w-full rounded-md border border-border bg-card/30 px-3 text-sm"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-[1.5px] text-muted-foreground">
              Describe what it should do
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              placeholder="A calculator that takes blended CAC, customer LTV, gross margin, and monthly customers acquired. Computes payback period in months and shows a 12-month cohort revenue projection. Save inputs to localStorage so the operator doesn't lose them on refresh."
              className="w-full rounded-md border border-border bg-card/30 px-3 py-2 font-mono text-[12px] leading-relaxed"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Be specific about behavior (what computes, what persists, what
              the user clicks). Engineering Manager generates one self-contained
              HTML page in ~10-30s.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submit}
              disabled={submitting}
            >
              {submitting ? "Generating..." : "Generate"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
