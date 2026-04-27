"use client";

import { useState } from "react";
import { X, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

type CreatedAgent = {
  id: string;
  name: string;
  title: string;
  role?: string | null;
  department?: string | null;
};

export function AddSubAgentModal({
  parentId,
  parentName,
  parentDepartment,
  onClose,
  onCreated,
}: {
  parentId: string;
  parentName: string;
  parentDepartment: string | null;
  onClose: () => void;
  onCreated: (agent: CreatedAgent) => void;
}) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          title: title.trim(),
          description: description.trim(),
          role: "sub_agent",
          department: parentDepartment,
          reportsTo: parentId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Create failed");
      onCreated(json.agent as CreatedAgent);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="relative w-full max-w-md rounded-lg border border-[var(--line)] bg-[var(--brand-surface)] p-6">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-[var(--text-muted)] hover:text-[var(--text-strong)]"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="text-lg font-medium text-[var(--text-strong)]">
          Add sub-agent under {parentName}
        </h2>

        <label className="mt-5 block text-xs uppercase tracking-widest text-[var(--text-muted)]">
          Name
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Copywriter"
          className="mt-1 w-full rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface-2)] px-3 py-2 text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:border-primary focus:outline-none"
        />

        <label className="mt-4 block text-xs uppercase tracking-widest text-[var(--text-muted)]">
          Title
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Sr. Copywriter"
          className="mt-1 w-full rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface-2)] px-3 py-2 text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:border-primary focus:outline-none"
        />

        <label className="mt-4 block text-xs uppercase tracking-widest text-[var(--text-muted)]">
          What should they do?
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Writes sales emails matching our brand voice. Uses the sales-funnels and brand-voice skill packs."
          className="mt-1 w-full rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface-2)] px-3 py-2 text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:border-primary focus:outline-none"
        />

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-[#8b2e14] bg-[#1a0b08] p-3 text-sm text-[#f4b27a]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost" disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!name.trim() || !title.trim() || submitting}
            variant="default"
          >
            {submitting ? "Creating…" : "Add sub-agent"}
          </Button>
        </div>
      </div>
    </div>
  );
}
