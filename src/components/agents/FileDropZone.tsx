"use client";

import { useState, useRef } from "react";
import { Upload, FileText, Check, AlertCircle } from "lucide-react";

/**
 * Drag-drop zone for the per-agent Files tab. Uploads via POST
 * /api/agent-files/upload (multipart). Shows progress bar while the
 * server extracts + chunks + embeds. Failures surface inline with the
 * warnings the route returns so the user sees WHY a chunk_count is 0.
 */
export function FileDropZone({
  agentId,
  onUploaded,
}: {
  agentId: string;
  onUploaded: (file: { id: string; filename: string; chunkCount: number }) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<{
    kind: "idle" | "success" | "error";
    message: string;
    warnings?: string[];
  }>({ kind: "idle", message: "" });

  async function upload(file: File) {
    setUploading(true);
    setStatus({ kind: "idle", message: `Uploading ${file.name}…` });
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("agent_id", agentId);
      const res = await fetch("/api/agent-files/upload", {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setStatus({
        kind: "success",
        message: `Indexed ${file.name} → ${json.chunk_count} chunks`,
        warnings: json.warnings,
      });
      onUploaded({
        id: json.file_id,
        filename: file.name,
        chunkCount: json.chunk_count,
      });
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void upload(f);
      }}
      className={
        "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-8 text-center " +
        (dragging
          ? "border-primary bg-[var(--brand-primary-soft)]"
          : "border-[var(--line-strong)] bg-[var(--brand-surface-2)]")
      }
    >
      <Upload className="h-6 w-6 text-[var(--text-muted)]" />
      <p className="text-sm text-[var(--text-strong)]">
        Drop a file here, or{" "}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-primary underline"
        >
          browse
        </button>
      </p>
      <p className="text-xs text-[var(--text-muted)]">
        PDF, DOCX, MD, TXT, CSV, or image. Up to 100MB.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.md,.txt,.csv,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />

      {uploading && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">Indexing…</p>
      )}

      {status.kind === "success" && (
        <div className="mt-3 w-full rounded-md border border-[#5a7340] bg-[#0f1a0d] p-3 text-left text-sm text-[#aad08f]">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4" />
            <span>{status.message}</span>
          </div>
          {status.warnings?.length ? (
            <ul className="mt-1 list-disc pl-5 text-xs text-[var(--text-muted)]">
              {status.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {status.kind === "error" && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-[#8b2e14] bg-[#1a0b08] p-3 text-sm text-[#f4b27a]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{status.message}</span>
        </div>
      )}
    </div>
  );
}
