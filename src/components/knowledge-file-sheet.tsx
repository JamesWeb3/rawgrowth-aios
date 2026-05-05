"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { Plus, Save, Tag, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TagPill } from "@/components/knowledge-view";
import { useKnowledge } from "@/lib/knowledge/use-knowledge";

type Props = {
  fileId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function KnowledgeFileSheet({ fileId, open, onOpenChange }: Props) {
  const { files, updateTags, remove, fetchContent } = useKnowledge();
  const file = files.find((f) => f.id === fileId);

  const [content, setContent] = useState<string>("");
  const [loadingContent, setLoadingContent] = useState(false);
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset draftTags + loading state when the sheet opens for a new file.
  // React 19 pattern: track the trigger key in state and reset during render
  // so we avoid a set-state-in-effect cascade.
  const triggerKey = open && file ? file.id : null;
  const [prevTriggerKey, setPrevTriggerKey] = useState<string | null>(triggerKey);
  if (prevTriggerKey !== triggerKey) {
    setPrevTriggerKey(triggerKey);
    if (triggerKey && file) {
      setDraftTags(file.tags);
      setLoadingContent(true);
    }
  }

  useEffect(() => {
    if (!open || !file) return;
    void fetchContent(file.id)
      .then(setContent)
      .catch(() => setContent("_(couldn't load content)_"))
      .finally(() => setLoadingContent(false));
  }, [open, file, fetchContent]);

  if (!file) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full flex-col border-l border-border bg-background p-0 text-foreground sm:max-w-160"
        />
      </Sheet>
    );
  }

  const tagsChanged =
    draftTags.length !== file.tags.length ||
    draftTags.some((t, i) => t !== file.tags[i]);

  const addTag = () => {
    const v = newTagInput.trim();
    if (!v || draftTags.includes(v)) return;
    setDraftTags([...draftTags, v]);
    setNewTagInput("");
  };

  const handleTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateTags(file.id, draftTags);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col border-l border-border bg-background p-0 text-foreground sm:max-w-160"
      >
        <SheetHeader className="border-b border-border px-6 py-5">
          <SheetTitle className="font-serif text-2xl font-normal tracking-tight text-foreground">
            {file.title}
          </SheetTitle>
          <SheetDescription className="text-[13px] text-muted-foreground">
            Uploaded {new Date(file.uploaded_at).toLocaleString()}
            {file.size_bytes
              ? ` · ${(file.size_bytes / 1024).toFixed(1)} KB`
              : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-5">
            <Label className="mb-2 text-[12px] font-medium text-foreground">
              Tags
            </Label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {draftTags.length === 0 && (
                <span className="text-[11px] text-muted-foreground">
                  No tags. Agents use these to find relevant files at runtime.
                </span>
              )}
              {draftTags.map((t) => (
                <TagPill
                  key={t}
                  tag={t}
                  onRemove={() =>
                    setDraftTags(draftTags.filter((x) => x !== t))
                  }
                />
              ))}
            </div>
            <div className="flex items-stretch gap-2">
              <div className="relative flex-1">
                <Tag className="absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={handleTagKey}
                  placeholder="brand-voice, pricing-sheet, proposal-template…"
                  className="bg-input/40 pl-7 text-[12px]"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={addTag}
                className="shrink-0 gap-1"
              >
                <Plus className="size-3.5" /> Add
              </Button>
            </div>
          </div>

          <div>
            <Label className="mb-2 text-[12px] font-medium text-foreground">
              Content
            </Label>
            <div className="max-h-120 overflow-auto rounded-lg border border-border bg-card/30 p-4 font-mono text-[11.5px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
              {loadingContent ? "Loading…" : content || "_(empty)_"}
            </div>
          </div>
        </div>

        <SheetFooter className="border-t border-border bg-background px-6 py-4">
          <div className="flex w-full items-center justify-between gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await remove(file.id);
                onOpenChange(false);
              }}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" /> Delete
            </Button>
            <div className="flex items-center gap-2">
              <SheetClose
                render={
                  <Button variant="ghost" size="sm">
                    Close
                  </Button>
                }
              />
              <Button
                onClick={save}
                size="sm"
                disabled={!tagsChanged || saving}
                className="bg-primary text-white hover:bg-primary/90"
              >
                <Save className="size-4" />
                {saving ? "Saving…" : "Save tags"}
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
