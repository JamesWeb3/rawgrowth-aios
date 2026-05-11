"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  ArrowUpRight,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  Key,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { jsonFetcher } from "@/lib/swr";

/**
 * Hero-card surface for the per-org Composio API key.
 *
 * Pre-2026-05-10 the only place to set this lived as the last row of
 * `<ApiKeysCard />` at the bottom of /connections, after a 59-card Apps
 * grid. Pedro flagged that as invisible: Composio is the proxy that
 * powers ~80% of the same Apps grid, so users hit "Request" / "Connect"
 * on Composio-backed apps without ever realising they need to set a
 * tenant key first.
 *
 * This component mirrors `<ClaudeConnectionCard />` so it sits at the
 * top of the page with the same shape + affordances. The provider list
 * inside `<ApiKeysCard />` drops the duplicate Composio row to keep one
 * source of truth.
 *
 * Backed by the same /api/connections/api-keys route + provider key
 * "composio" - no DB or storage changes.
 */

type KeyRow = {
  provider: string;
  label: string;
  description: string;
  docsUrl: string;
  placeholder: string;
  hasKey: boolean;
  preview: string | null;
  updatedAt: string | null;
};

type KeysResponse = { keys: KeyRow[] };

export function ComposioKeyCard() {
  // include=composio because the default GET hides Composio from the
  // generic list (it lives in this dedicated card, not the bottom
  // <ApiKeysCard /> grid). See HIDDEN_FROM_LIST in the API route.
  const { data, mutate, isLoading } = useSWR<KeysResponse>(
    "/api/connections/api-keys?include=composio",
    jsonFetcher,
    { revalidateOnFocus: false },
  );

  const row = data?.keys.find((k) => k.provider === "composio") ?? null;

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [revealed, setRevealed] = useState(false);

  async function save() {
    const trimmed = value.trim();
    if (trimmed.length < 8) {
      toast.error("Key looks too short");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/connections/api-keys", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "composio", api_key: trimmed }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "save failed");
      toast.success("Composio key saved");
      setEditing(false);
      setValue("");
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Remove the Composio key for this workspace?")) return;
    setRemoving(true);
    try {
      const res = await fetch(
        "/api/connections/api-keys?provider=composio",
        { method: "DELETE" },
      );
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "delete failed");
      toast.success("Composio key removed");
      setRevealed(false);
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRemoving(false);
    }
  }

  if (isLoading) {
    return (
      <Card className="border-border bg-card/50">
        <CardContent className="h-48 animate-pulse p-6" />
      </Card>
    );
  }

  const connected = row?.hasKey ?? false;

  return (
    <Card className="border-border bg-card/50">
      <CardContent className="space-y-5 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border"
              style={{ backgroundColor: "rgba(120, 113, 255, 0.12)" }}
            >
              <Key
                className="size-5"
                strokeWidth={1.5}
                style={{ color: "rgb(170, 162, 255)" }}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold text-foreground">
                  Composio API key
                </h3>
                {connected ? (
                  <Badge
                    variant="secondary"
                    className="bg-primary/15 text-[10px] text-primary"
                  >
                    Connected
                  </Badge>
                ) : (
                  <Badge
                    variant="secondary"
                    className="bg-amber-500/10 text-[10px] text-amber-400"
                  >
                    Not set
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Powers every Composio-backed app below. Set yours so the
                workspace isn&apos;t throttled by the shared default.
              </p>
            </div>
          </div>
          {connected && !editing && (
            <Button
              size="sm"
              variant="secondary"
              onClick={remove}
              disabled={removing}
              className="bg-white/5 text-foreground hover:bg-white/10"
            >
              <Trash2 className="size-3.5" />
              {removing ? "Removing…" : "Remove"}
            </Button>
          )}
        </div>

        {connected && !editing ? (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label className="text-[11px] font-medium text-muted-foreground">
                Stored key
              </Label>
              <button
                type="button"
                onClick={() => setRevealed((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {revealed ? (
                  <>
                    <EyeOff className="size-3" /> Hide
                  </>
                ) : (
                  <>
                    <Eye className="size-3" /> Show preview
                  </>
                )}
              </button>
            </div>
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-3 py-2 font-mono text-[12px] text-foreground/85">
              <code className="flex-1 truncate">
                {revealed ? row?.preview ?? "—" : "ak_•••••••••••••••"}
              </code>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setEditing(true);
                  setValue("");
                }}
                className="h-8 text-[11px]"
              >
                Update key
              </Button>
              <a
                href={row?.docsUrl ?? "https://app.composio.dev/settings"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Composio settings
                <ExternalLink className="size-3" />
              </a>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Stored encrypted (AES-256-GCM). Overrides the VPS-wide
              <code className="mx-1 rounded bg-muted/40 px-1 font-mono text-[10.5px]">
                COMPOSIO_API_KEY
              </code>
              env so each tenant pays its own action quota.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {!connected && (
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                Grab the key from your Composio dashboard, paste it
                below, and the entire Apps grid below picks it up. No
                deploy, no restart.
              </p>
            )}
            <div>
              <Label
                htmlFor="composio-key-input"
                className="text-[11px] font-medium text-muted-foreground"
              >
                {connected ? "New Composio key" : "Composio key"}
              </Label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  id="composio-key-input"
                  type="password"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={row?.placeholder ?? "ak_live_..."}
                  className="font-mono text-[12px]"
                  autoComplete="off"
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !saving) save();
                  }}
                />
                <Button
                  onClick={save}
                  disabled={saving || value.trim().length < 8}
                  className="bg-primary text-white hover:bg-primary/90"
                >
                  {saving ? "Saving…" : (
                    <>
                      <Check className="size-3.5" />
                      Save
                    </>
                  )}
                </Button>
                {editing && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditing(false);
                      setValue("");
                    }}
                    disabled={saving}
                    className="bg-white/5 text-foreground hover:bg-white/10"
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
            <a
              href={row?.docsUrl ?? "https://app.composio.dev/settings"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline"
            >
              Open Composio settings
              <ArrowUpRight className="size-3" />
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
