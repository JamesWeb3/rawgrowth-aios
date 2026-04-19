"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  Building2,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  RefreshCw,
  Users as UsersIcon,
  Bot,
  Repeat,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { jsonFetcher } from "@/lib/swr";
import { EmptyState } from "@/components/empty-state";
import { CreateClientSheet } from "@/components/admin/create-client-sheet";

type Client = {
  id: string;
  name: string;
  slug: string;
  mcp_token: string | null;
  created_at: string;
  agent_count: number;
  routine_count: number;
  member_count: number;
};

export function ClientsView() {
  const { data, isLoading, mutate } = useSWR<{ clients: Client[] }>(
    "/api/admin/clients",
    jsonFetcher,
  );
  const [creating, setCreating] = useState(false);

  const clients = data?.clients ?? [];
  const loaded = !isLoading;

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-[12px] text-muted-foreground">
          <span className="font-semibold text-foreground">{clients.length}</span>{" "}
          client{clients.length === 1 ? "" : "s"} on the platform
        </div>
        <Button
          onClick={() => setCreating(true)}
          size="sm"
          className="btn-shine bg-primary text-white hover:bg-primary/90"
        >
          <Plus className="size-3.5" />
          New client
        </Button>
      </div>

      {!loaded ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-xl border border-border bg-card/30"
            />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No clients yet"
          description="Provision your first client. They'll get their own org, an owner login, and an MCP token they can paste into Claude Desktop."
          action={
            <Button
              onClick={() => setCreating(true)}
              size="sm"
              className="btn-shine bg-primary text-white hover:bg-primary/90"
            >
              <Plus className="size-3.5" />
              Create first client
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {clients.map((c) => (
            <ClientCard key={c.id} client={c} onChanged={() => mutate()} />
          ))}
        </div>
      )}

      <CreateClientSheet
        open={creating}
        onOpenChange={setCreating}
        onCreated={() => mutate()}
      />
    </>
  );
}

function ClientCard({
  client,
  onChanged,
}: {
  client: Client;
  onChanged: () => void;
}) {
  const [show, setShow] = useState(false);
  const [rotating, setRotating] = useState(false);

  const rotate = async () => {
    if (
      !confirm(
        `Rotate the MCP token for ${client.name}? The old token will stop working immediately — anyone with the old token in their Claude Desktop config will lose access until you give them the new one.`,
      )
    )
      return;
    setRotating(true);
    try {
      const res = await fetch(
        `/api/admin/clients/${client.id}/rotate-token`,
        { method: "POST" },
      );
      if (!res.ok) {
        const { error } = (await res.json()) as { error?: string };
        throw new Error(error ?? "rotate failed");
      }
      onChanged();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setRotating(false);
    }
  };

  const mcpUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/mcp`
      : "https://…/api/mcp";

  return (
    <Card className="border-border bg-card/50 backdrop-blur-sm">
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-primary/10 text-primary">
              <Building2 className="size-5" />
            </div>
            <div>
              <div className="text-[14px] font-semibold text-foreground">
                {client.name}
              </div>
              <div className="font-mono text-[11px] text-muted-foreground">
                /{client.slug}
              </div>
            </div>
          </div>
          <Badge variant="secondary" className="bg-white/5 text-muted-foreground">
            {new Date(client.created_at).toLocaleDateString()}
          </Badge>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <UsersIcon className="size-3" />
            {client.member_count} user{client.member_count === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Bot className="size-3" />
            {client.agent_count} agent{client.agent_count === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Repeat className="size-3" />
            {client.routine_count} routine
            {client.routine_count === 1 ? "" : "s"}
          </span>
        </div>

        <div className="rounded-lg border border-border bg-background/40 p-3">
          <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <KeyRound className="size-3" />
              MCP config
            </span>
            <button
              type="button"
              onClick={rotate}
              disabled={rotating}
              className="inline-flex items-center gap-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw
                className={rotating ? "size-3 animate-spin" : "size-3"}
              />
              Rotate
            </button>
          </div>

          <CopyableRow label="URL" value={mcpUrl} />
          <div className="mt-2">
            <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[1px] text-muted-foreground">
              <span>Bearer token</span>
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                {show ? (
                  <>
                    <EyeOff className="size-3" /> Hide
                  </>
                ) : (
                  <>
                    <Eye className="size-3" /> Show
                  </>
                )}
              </button>
            </div>
            <CopyableRow
              label=""
              value={
                client.mcp_token
                  ? show
                    ? client.mcp_token
                    : `${client.mcp_token.slice(0, 12)}${"•".repeat(24)}`
                  : "(no token — rotate to mint)"
              }
              copyValue={client.mcp_token ?? undefined}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CopyableRow({
  value,
  copyValue,
}: {
  label: string;
  value: string;
  copyValue?: string;
}) {
  const [copied, setCopied] = useState(false);
  const toCopy = copyValue ?? value;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-background/30 px-2 py-1.5 font-mono text-[11px] text-foreground/80">
      <code className="flex-1 truncate">{value}</code>
      {toCopy && (
        <button
          type="button"
          onClick={copy}
          className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      )}
    </div>
  );
}
