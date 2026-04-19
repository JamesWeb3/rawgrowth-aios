"use client";

import { useState } from "react";
import { Check, Copy, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

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

type CreatedClient = {
  org: { id: string; name: string; slug: string; mcp_token: string };
  owner: { id: string; email: string };
};

export function CreateClientSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedClient | null>(null);

  const reset = () => {
    setName("");
    setOwnerEmail("");
    setOwnerName("");
    setOwnerPassword("");
    setError(null);
    setCreated(null);
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, ownerEmail, ownerName, ownerPassword }),
      });
      if (!res.ok) {
        const { error: e } = (await res.json()) as { error?: string };
        throw new Error(e ?? "create failed");
      }
      const { client } = (await res.json()) as { client: CreatedClient };
      setCreated(client);
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          // reset on close so next open is fresh
          setTimeout(reset, 300);
        }
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col border-l border-border bg-background p-0 text-foreground sm:max-w-150"
      >
        <SheetHeader className="border-b border-border px-6 py-5">
          <SheetTitle className="font-serif text-2xl font-normal tracking-tight text-foreground">
            {created ? "Client provisioned" : "New client"}
          </SheetTitle>
          <SheetDescription className="text-[13px] text-muted-foreground">
            {created
              ? "Hand the owner these credentials. Sign in once and they're off."
              : "Creates a new org + owner user. The owner signs in with the credentials you set below."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {created ? (
            <ProvisionResult created={created} />
          ) : (
            <div className="flex flex-col gap-4">
              <Field label="Client / company name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Co."
                  className="bg-input/40"
                />
              </Field>
              <Field label="Owner email" hint="They'll sign in with this.">
                <Input
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="sarah@acme.com"
                  className="bg-input/40"
                />
              </Field>
              <Field label="Owner name" hint="Optional.">
                <Input
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="Sarah Smith"
                  className="bg-input/40"
                />
              </Field>
              <Field
                label="Temporary password"
                hint="Share securely. At least 8 characters — the owner can change it later."
              >
                <Input
                  type="text"
                  value={ownerPassword}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  placeholder="sunrise-mountain-42"
                  className="bg-input/40 font-mono text-[12.5px]"
                />
              </Field>

              {error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        <SheetFooter className="border-t border-border bg-background px-6 py-4">
          <div className="flex w-full items-center justify-end gap-2">
            <SheetClose
              render={
                <Button variant="ghost" size="sm">
                  {created ? "Done" : "Cancel"}
                </Button>
              }
            />
            {!created && (
              <Button
                onClick={submit}
                disabled={busy}
                size="sm"
                className="btn-shine bg-primary text-white hover:bg-primary/90"
              >
                <Plus className="size-4" />
                {busy ? "Provisioning…" : "Create client"}
              </Button>
            )}
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ProvisionResult({ created }: { created: CreatedClient }) {
  const mcpUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/mcp`
      : "https://…/api/mcp";
  const configJson = `{
  "mcpServers": {
    "rawgrowth-${created.org.slug}": {
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer ${created.org.mcp_token}"
      }
    }
  }
}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-primary/30 bg-primary/10 p-4 text-[12.5px] text-primary">
        <div className="mb-1 flex items-center gap-1.5 font-semibold">
          <Sparkles className="size-3.5" />
          {created.org.name} is live
        </div>
        <div className="text-[12px] text-primary/80">
          Sign-in URL: <code className="font-mono">/auth/signin</code> · Owner{" "}
          <code className="font-mono">{created.owner.email}</code>
        </div>
      </div>

      <Reveal label="Org id" value={created.org.id} />
      <Reveal label="Owner email" value={created.owner.email} />
      <Reveal
        label="MCP URL"
        value={mcpUrl}
      />
      <Reveal label="MCP bearer token" value={created.org.mcp_token} />

      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
          Claude Desktop config snippet
        </div>
        <CopyBlock value={configJson} />
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Paste this into{" "}
          <code className="font-mono">
            ~/Library/Application Support/Claude/claude_desktop_config.json
          </code>{" "}
          on the client&apos;s machine, then restart Claude Desktop.
        </p>
      </div>
    </div>
  );
}

function Reveal({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div>
      <Label className="text-[11px] font-medium text-muted-foreground">
        {label}
      </Label>
      <div className="mt-1 flex items-center gap-1.5 rounded-md border border-border bg-background/30 px-2.5 py-1.5 font-mono text-[11.5px] text-foreground/85">
        <code className="flex-1 truncate">{value}</code>
        <button
          type="button"
          onClick={copy}
          className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      </div>
    </div>
  );
}

function CopyBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Config copied");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-border bg-background/40 p-3 font-mono text-[11px] leading-relaxed text-foreground/85">
        {value}
      </pre>
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[12px] font-medium text-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
