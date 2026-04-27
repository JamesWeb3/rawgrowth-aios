"use client";

import { useMemo, useRef, useState, type DragEvent } from "react";
import {
  FileText,
  UploadCloud,
  Trash2,
  Tag,
  X,
  Eye,
  MoreHorizontal,
  BookOpen,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/empty-state";
import {
  useKnowledge,
  type KnowledgeFileRow,
} from "@/lib/knowledge/use-knowledge";
import { KnowledgeFileSheet } from "@/components/knowledge-file-sheet";

const ALL_AGENTS = "__all__";
const UNASSIGNED = "__unassigned__";

export type KnowledgeAgentOption = { id: string; name: string };

export function KnowledgeView({
  agents = [],
}: {
  agents?: KnowledgeAgentOption[];
}) {
  const { files, loaded, uploading, upload, remove } = useKnowledge();
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<string>(ALL_AGENTS);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Per-brief §7: file library is global, with filter by agent. Org-wide
  // markdown knowledge (no agent_id) falls under "Unassigned".
  const filteredFiles = useMemo(() => {
    if (agentFilter === ALL_AGENTS) return files;
    if (agentFilter === UNASSIGNED) {
      return files.filter((f) => !f.agent_id);
    }
    return files.filter((f) => f.agent_id === agentFilter);
  }, [files, agentFilter]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    let unassigned = 0;
    for (const f of files) {
      if (f.agent_id) {
        map.set(f.agent_id, (map.get(f.agent_id) ?? 0) + 1);
      } else {
        unassigned += 1;
      }
    }
    return { byAgent: map, unassigned, total: files.length };
  }, [files]);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    try {
      // Upload sequentially so errors surface clearly and the UI settles cleanly.
      for (const f of Array.from(fileList)) {
        const isMarkdown = /\.(md|markdown|txt)$/i.test(f.name);
        if (!isMarkdown) {
          throw new Error(`"${f.name}" isn't a markdown file`);
        }
        await upload(f, [], f.name.replace(/\.(md|markdown|txt)$/i, ""));
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    void handleFiles(e.dataTransfer.files);
  };

  if (!loaded) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl border border-border bg-card/30"
          />
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Drop zone  -  always visible so users can append more at any time */}
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "mb-6 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center transition-colors",
          dragActive
            ? "border-primary/50 bg-primary/5"
            : "border-border bg-card/30 hover:border-primary/30 hover:bg-card/50",
        )}
      >
        <div className="mb-3 flex size-11 items-center justify-center rounded-xl border border-border bg-primary/10 text-primary">
          <UploadCloud className="size-5" />
        </div>
        <div className="text-[13px] font-medium text-foreground">
          {uploading
            ? "Uploading…"
            : "Drag markdown files here, or click to browse"}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          .md / .markdown / .txt · up to 2 MB · add tags after upload
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          multiple
          hidden
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          {error}
        </div>
      )}

      {files.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No knowledge files yet"
          description="Upload markdown playbooks, SOPs, brand voice docs  -  anything your agents should reference. Tag them so they're easy to surface."
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">
                {filteredFiles.length}
              </span>{" "}
              of {files.length} file{files.length === 1 ? "" : "s"}
            </span>
            <label className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wide">
                Agent
              </span>
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="rounded-md border border-border bg-card/50 px-2 py-1 text-[12px] text-foreground transition-colors hover:border-primary/30 focus:border-primary/50 focus:outline-none"
              >
                <option value={ALL_AGENTS}>
                  All agents ({counts.total} file
                  {counts.total === 1 ? "" : "s"})
                </option>
                {agents.map((a) => {
                  const c = counts.byAgent.get(a.id) ?? 0;
                  return (
                    <option key={a.id} value={a.id}>
                      {a.name} ({c} file{c === 1 ? "" : "s"})
                    </option>
                  );
                })}
                {counts.unassigned > 0 && (
                  <option value={UNASSIGNED}>
                    Unassigned ({counts.unassigned} file
                    {counts.unassigned === 1 ? "" : "s"})
                  </option>
                )}
              </select>
            </label>
          </div>
          {filteredFiles.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/30 px-4 py-8 text-center text-[12px] text-muted-foreground">
              No files match this filter.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredFiles.map((f) => (
                <FileRow
                  key={f.id}
                  file={f}
                  onView={() => setViewingId(f.id)}
                  onDelete={() => remove(f.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {viewingId && (
        <KnowledgeFileSheet
          fileId={viewingId}
          open={!!viewingId}
          onOpenChange={(o) => {
            if (!o) setViewingId(null);
          }}
        />
      )}
    </>
  );
}

function FileRow({
  file,
  onView,
  onDelete,
}: {
  file: KnowledgeFileRow;
  onView: () => void;
  onDelete: () => void;
}) {
  const sizeKb = file.size_bytes
    ? (file.size_bytes / 1024).toFixed(1)
    : null;

  return (
    <div className="group flex items-stretch rounded-xl border border-border bg-card/50 transition-colors hover:border-primary/30 hover:bg-card">
      <button
        type="button"
        onClick={onView}
        className="flex flex-1 items-center gap-3 p-3 text-left"
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-primary/10 text-primary">
          <FileText className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-foreground">
            {file.title}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{new Date(file.uploaded_at).toLocaleDateString()}</span>
            {sizeKb && (
              <>
                <span>·</span>
                <span>{sizeKb} KB</span>
              </>
            )}
          </div>
        </div>
        <div className="hidden items-center gap-1 sm:flex">
          {file.tags.slice(0, 3).map((t) => (
            <Badge
              key={t}
              variant="secondary"
              className="gap-1 bg-white/5 text-[10px] text-muted-foreground"
            >
              <Tag className="size-2.5" />
              {t}
            </Badge>
          ))}
          {file.tags.length > 3 && (
            <Badge
              variant="secondary"
              className="bg-white/5 text-[10px] text-muted-foreground"
            >
              +{file.tags.length - 3}
            </Badge>
          )}
        </div>
      </button>
      <div className="flex items-center gap-1 border-l border-border px-2">
        <button
          type="button"
          onClick={onView}
          title="View"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Eye className="size-3.5" />
        </button>
        <Popover>
          <PopoverTrigger className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
            <MoreHorizontal className="size-3.5" />
          </PopoverTrigger>
          <PopoverContent
            side="bottom"
            align="end"
            sideOffset={6}
            className="w-40 border-border bg-popover p-1 text-foreground"
          >
            <button
              type="button"
              onClick={onView}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Eye className="size-3.5" /> View / edit tags
            </button>
            <Separator className="my-1" />
            <button
              type="button"
              onClick={onDelete}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-destructive transition-colors hover:bg-destructive/10"
            >
              <Trash2 className="size-3.5" /> Delete
            </button>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

// Tag pill with remove button  -  used inside the file sheet
export function TagPill({
  tag,
  onRemove,
}: {
  tag: string;
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background/40 px-2 py-0.5 text-[11px] text-foreground/80">
      <Tag className="size-2.5 text-muted-foreground" />
      {tag}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-1 rounded hover:bg-destructive/20 hover:text-destructive"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}
