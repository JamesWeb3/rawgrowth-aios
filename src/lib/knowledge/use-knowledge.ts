"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/swr";

export type KnowledgeFileRow = {
  id: string;
  organization_id: string;
  title: string;
  tags: string[];
  storage_path: string;
  mime_type: string;
  size_bytes: number | null;
  uploaded_at: string;
  uploaded_by: string | null;
  // Optional; org-wide markdown knowledge has no agent binding. Per-agent
  // file rows (rgaios_agent_files) can populate this so the brief §7
  // filter dropdown groups them under their agent instead of "Unassigned".
  agent_id?: string | null;
};

const KNOWLEDGE_KEY = "/api/knowledge";

export function useKnowledge() {
  const { data, isLoading, mutate } = useSWR<{ files: KnowledgeFileRow[] }>(
    KNOWLEDGE_KEY,
    jsonFetcher,
    { revalidateOnFocus: false },
  );

  const files = data?.files ?? [];
  const loaded = !isLoading;
  const [uploading, setUploading] = useState(false);

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const upload = useCallback(
    async (file: File, tags: string[], title?: string) => {
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        if (title) fd.append("title", title);
        if (tags.length) fd.append("tags", tags.join(","));
        const res = await fetch(KNOWLEDGE_KEY, { method: "POST", body: fd });
        if (!res.ok) {
          const { error } = (await res.json()) as { error?: string };
          throw new Error(error ?? "upload failed");
        }
        await mutate();
      } finally {
        setUploading(false);
      }
    },
    [mutate],
  );

  const remove = useCallback(
    async (id: string) => {
      await fetch(`${KNOWLEDGE_KEY}/${id}`, { method: "DELETE" });
      await mutate(
        (prev) => ({ files: (prev?.files ?? []).filter((f) => f.id !== id) }),
        { revalidate: true },
      );
    },
    [mutate],
  );

  const updateTags = useCallback(
    async (id: string, tags: string[]) => {
      await fetch(`${KNOWLEDGE_KEY}/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tags }),
      });
      await mutate(
        (prev) => ({
          files: (prev?.files ?? []).map((f) =>
            f.id === id ? { ...f, tags } : f,
          ),
        }),
        { revalidate: true },
      );
    },
    [mutate],
  );

  const fetchContent = useCallback(async (id: string): Promise<string> => {
    const res = await fetch(`${KNOWLEDGE_KEY}/${id}`);
    if (!res.ok) throw new Error("fetch failed");
    const body = (await res.json()) as { content?: string };
    return body.content ?? "";
  }, []);

  return {
    files,
    loaded,
    uploading,
    refresh,
    upload,
    remove,
    updateTags,
    fetchContent,
  };
}
