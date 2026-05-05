"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import {
  Palette,
  FileText,
  Megaphone,
  Briefcase,
  Truck,
  Wallet,
  Users,
  FolderOpen,
  Image as ImageIcon,
  FileSpreadsheet,
  FileType2,
  UploadCloud,
  Trash2,
  Loader2,
  ExternalLink,
  Sparkles,
} from "lucide-react";

export type Bucket =
  | "brand"
  | "content"
  | "marketing"
  | "sales"
  | "fulfilment"
  | "finance"
  | "customer"
  | "other";

export type FileRow = {
  id: string;
  title: string;
  tags: string[];
  storage_path: string;
  mime_type: string;
  size_bytes: number | null;
  uploaded_at: string;
  bucket: Bucket;
};

export type BrandProfileRow = {
  id: string;
  version: number;
  status: string;
  generated_at: number;
  approved_at: number | null;
};

type BucketDef = {
  value: Bucket;
  label: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  blurb: string;
};

const BUCKETS: BucketDef[] = [
  {
    value: "brand",
    label: "Brand",
    Icon: Palette,
    blurb:
      "Logos, color palettes, typography, brand profile. The agents read this to keep voice + visuals consistent.",
  },
  {
    value: "content",
    label: "Content",
    Icon: FileText,
    blurb:
      "Drafts, blog posts, case studies, scripts. Drop in anything you want surfaced when agents write copy.",
  },
  {
    value: "marketing",
    label: "Marketing",
    Icon: Megaphone,
    blurb:
      "Campaign briefs, ad creative, landing copy. Department head can pull these into routines.",
  },
  {
    value: "sales",
    label: "Sales",
    Icon: Briefcase,
    blurb:
      "Pricing sheets, ICP docs, sales scripts, objection handlers. Sales agents quote from these.",
  },
  {
    value: "fulfilment",
    label: "Fulfilment",
    Icon: Truck,
    blurb:
      "SOPs, onboarding playbooks, delivery checklists. Fulfilment agents follow these step by step.",
  },
  {
    value: "finance",
    label: "Finance",
    Icon: Wallet,
    blurb:
      "Invoice templates, expense policies, runway projections. Read-only context for finance routines.",
  },
  {
    value: "customer",
    label: "Customer",
    Icon: Users,
    blurb:
      "Customer profiles, feedback summaries, support FAQs. CS agents pull from here at runtime.",
  },
  {
    value: "other",
    label: "Other",
    Icon: FolderOpen,
    blurb: "Anything that doesn't fit a department yet. Re-bucket later.",
  },
];

function iconForMime(mime: string, filename: string) {
  const m = (mime || "").toLowerCase();
  const n = (filename || "").toLowerCase();
  if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(n))
    return ImageIcon;
  if (
    m === "text/csv" ||
    /\.(csv|xlsx?|tsv)$/i.test(n) ||
    m.includes("spreadsheet")
  )
    return FileSpreadsheet;
  if (m === "application/pdf" || n.endsWith(".pdf")) return FileType2;
  return FileText;
}

function fmtSize(bytes: number | null) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilesClient({
  initialFiles,
  brandProfile,
}: {
  initialFiles: FileRow[];
  brandProfile: BrandProfileRow | null;
}) {
  const [files, setFiles] = useState<FileRow[]>(initialFiles);
  const [active, setActive] = useState<Bucket>("brand");
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const counts = useMemo(() => {
    const map = new Map<Bucket, number>();
    for (const f of files) map.set(f.bucket, (map.get(f.bucket) ?? 0) + 1);
    return map;
  }, [files]);

  const activeDef = BUCKETS.find((b) => b.value === active) ?? BUCKETS[0];
  const visible = useMemo(
    () => files.filter((f) => f.bucket === active),
    [files, active],
  );

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setUploading(true);
    try {
      for (const f of Array.from(list)) {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("bucket", active);
        fd.append("title", f.name);
        const res = await fetch("/api/files/upload", {
          method: "POST",
          body: fd,
        });
        const body = (await res.json().catch(() => ({}))) as {
          file?: FileRow;
          error?: string;
        };
        if (!res.ok || !body.file) {
          throw new Error(body.error ?? "upload failed");
        }
        setFiles((prev) => [body.file as FileRow, ...prev]);
      }
      toast.success(
        `Uploaded ${list.length} file${list.length === 1 ? "" : "s"} to ${activeDef.label}`,
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    const prev = files;
    setFiles((p) => p.filter((f) => f.id !== id));
    const res = await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Delete failed");
      setFiles(prev);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    void handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
      {/* Bucket picker rail */}
      <aside className="space-y-1.5 rounded-md border border-border bg-card/30 p-3">
        <p className="px-2 text-[10px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
          Buckets
        </p>
        {BUCKETS.map((b) => {
          const Icon = b.Icon;
          const isActive = active === b.value;
          const count = counts.get(b.value) ?? 0;
          return (
            <button
              key={b.value}
              type="button"
              onClick={() => setActive(b.value)}
              className={
                "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12px] transition-colors " +
                (isActive
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted/30 hover:text-foreground")
              }
            >
              <Icon className="size-3.5 shrink-0" strokeWidth={1.6} />
              <span className="flex-1">{b.label}</span>
              <span
                className={
                  "rounded-full px-1.5 text-[10px] " +
                  (isActive
                    ? "bg-primary/20 text-primary"
                    : "bg-muted/40 text-muted-foreground")
                }
              >
                {count}
              </span>
            </button>
          );
        })}
      </aside>

      {/* Right pane */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-serif text-xl tracking-tight text-foreground">
              {activeDef.label}
            </h3>
            <p className="mt-1 max-w-xl text-[12px] text-muted-foreground">
              {activeDef.blurb}
            </p>
          </div>
          {active === "brand" && (
            <Link
              href="/brand"
              className="inline-flex h-8 items-center gap-1.5 rounded-[min(var(--radius-md),12px)] border border-border px-3 text-[12px] hover:border-primary/40"
            >
              <ExternalLink className="size-3.5" />
              Edit brand profile markdown
            </Link>
          )}
        </div>

        {/* Drop zone */}
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
          className={
            "flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center transition-colors " +
            (dragActive
              ? "border-primary/50 bg-primary/5"
              : "border-border bg-card/30 hover:border-primary/30 hover:bg-card/50")
          }
        >
          <div className="mb-3 flex size-11 items-center justify-center rounded-xl border border-border bg-primary/10 text-primary">
            {uploading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <UploadCloud className="size-5" />
            )}
          </div>
          <div className="text-[13px] font-medium text-foreground">
            {uploading
              ? "Uploading..."
              : `Drop files into ${activeDef.label}, or click to browse`}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Up to 10 MB each. Text files get indexed for agent retrieval.
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {/* Recent uploads grid */}
        {active === "brand" && brandProfile && (
          <BrandProfileVirtualRow profile={brandProfile} />
        )}

        {visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card/20 px-4 py-8 text-center text-[12px] text-muted-foreground">
            No files in {activeDef.label} yet. Drop one in above.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {visible.map((f) => (
              <FileCard key={f.id} file={f} onDelete={() => remove(f.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FileCard({
  file,
  onDelete,
}: {
  file: FileRow;
  onDelete: () => void;
}) {
  const Icon = iconForMime(file.mime_type, file.title);
  return (
    <div className="group flex items-stretch rounded-xl border border-border bg-card/50 transition-colors hover:border-primary/30 hover:bg-card">
      <div className="flex flex-1 items-center gap-3 p-3 text-left">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-foreground">
            {file.title}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{new Date(file.uploaded_at).toLocaleDateString()}</span>
            {file.size_bytes != null && (
              <>
                <span>·</span>
                <span>{fmtSize(file.size_bytes)}</span>
              </>
            )}
            {file.mime_type && (
              <>
                <span>·</span>
                <span className="truncate">{file.mime_type}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center border-l border-border px-2">
        <button
          type="button"
          onClick={onDelete}
          title="Delete"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function BrandProfileVirtualRow({ profile }: { profile: BrandProfileRow }) {
  const approved = profile.approved_at
    ? new Date(Number(profile.approved_at)).toLocaleDateString()
    : null;
  return (
    <Link
      href="/brand"
      className="flex items-stretch rounded-xl border border-primary/30 bg-primary/5 transition-colors hover:border-primary/50 hover:bg-primary/10"
    >
      <div className="flex flex-1 items-center gap-3 p-3 text-left">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-primary/40 bg-primary/15 text-primary">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-foreground">
            Brand profile - v{profile.version}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>Generated</span>
            <span>·</span>
            <span>{profile.status}</span>
            {approved && (
              <>
                <span>·</span>
                <span>approved {approved}</span>
              </>
            )}
          </div>
        </div>
        <ExternalLink className="size-3.5 text-primary" />
      </div>
    </Link>
  );
}
