"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Mail, Plus, ShieldCheck, UserRound, Hourglass, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { jsonFetcher } from "@/lib/swr";

type Role = "owner" | "admin" | "member" | "developer";
type Member = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  created_at: string;
};
type PendingInvite = {
  email: string;
  name: string | null;
  role: Role;
  invited_by_name: string | null;
  created_at: string;
  expires_at: string;
  allowed_departments: string[];
};

// Mirrors KNOWN_DEPARTMENT_SLUGS from src/lib/auth/dept-acl.ts. Kept inline
// so this client component doesn't pull a server-only module. If you add
// a new dept slug, sync both lists.
const DEPT_OPTIONS: Array<{ slug: string; label: string }> = [
  { slug: "marketing", label: "Marketing" },
  { slug: "sales", label: "Sales" },
  { slug: "fulfilment", label: "Fulfilment" },
  { slug: "finance", label: "Finance" },
  { slug: "development", label: "Development" },
];
type Response = {
  members: Member[];
  invites: PendingInvite[];
  currentUserId: string | null;
  currentUserRole: Role | null;
};

function roleBadgeClass(role: Role) {
  if (role === "owner") {
    return "rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.5px] text-primary";
  }
  if (role === "admin") {
    return "rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.5px] text-amber-400";
  }
  if (role === "developer") {
    return "rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.5px] text-cyan-400";
  }
  return "rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.5px] text-muted-foreground";
}

export function MembersView() {
  const { data, error, mutate, isLoading } = useSWR<Response>(
    "/api/members",
    jsonFetcher,
    { refreshInterval: 15_000 },
  );
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const members = data?.members ?? [];
  const invites = data?.invites ?? [];
  const isOwner = data?.currentUserRole === "owner";
  const myId = data?.currentUserId ?? null;

  async function removeMember(m: Member) {
    if (m.id === myId) {
      toast.error("You can't remove yourself.");
      return;
    }
    if (!confirm(`Remove ${m.name ?? m.email} from the organization?`)) return;
    setRemovingId(m.id);
    try {
      const res = await fetch(`/api/members/${m.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to remove");
      }
      toast.success(`Removed ${m.name ?? m.email}`);
      mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="text-[12px] text-muted-foreground">
          {members.length} member{members.length === 1 ? "" : "s"}
          {invites.length > 0 && (
            <span className="ml-2 text-amber-400">
              · {invites.length} pending invite{invites.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <Button
          size="sm"
          className="bg-primary text-white hover:bg-primary/90"
          onClick={() => setInviteOpen(true)}
        >
          <Plus className="size-4" />
          Invite members
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-card/40 text-[11px] uppercase tracking-[1px] text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Email</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Joined</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {error && !data ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-destructive">
                  Couldn&apos;t load members: {(error as Error).message}
                </td>
              </tr>
            ) : isLoading && !data ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : members.length === 0 && invites.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  No members yet. Invite your first teammate to get started.
                </td>
              </tr>
            ) : (
              <>
                {members.map((m) => {
                  const isMe = m.id === myId;
                  const canRemove = isOwner && !isMe;
                  return (
                    <tr key={m.id} className="bg-background/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex size-7 items-center justify-center rounded-full border border-border bg-primary/10 text-primary">
                            <UserRound className="size-3.5" />
                          </div>
                          <span className="font-medium text-foreground">
                            {m.name ?? " - "}
                          </span>
                          {isMe && (
                            <span className="text-[10px] text-muted-foreground">
                              (you)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-muted-foreground">
                        {m.email}
                      </td>
                      <td className="px-4 py-3">
                        <span className={roleBadgeClass(m.role)}>{m.role}</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(m.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-[11px] text-primary">
                          <ShieldCheck className="size-3" />
                          Active
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canRemove && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={removingId === m.id}
                            onClick={() => removeMember(m)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <X className="size-3.5" />
                            {removingId === m.id ? "Removing…" : "Remove"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {invites.map((inv) => (
                  <tr key={inv.email + inv.created_at} className="bg-background/10">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex size-7 items-center justify-center rounded-full border border-dashed border-border bg-muted/20 text-muted-foreground">
                          <Mail className="size-3.5" />
                        </div>
                        <span className="text-muted-foreground italic">
                          {inv.name ?? " - "}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-muted-foreground">
                      {inv.email}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-0.5">
                        <span className={roleBadgeClass(inv.role)}>{inv.role}</span>
                        {inv.allowed_departments.length > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            {inv.allowed_departments.join(", ")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(inv.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-400">
                        <Hourglass className="size-3" />
                        Pending
                      </span>
                    </td>
                    <td className="px-4 py-3" />
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>

      <InviteSheet
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={() => mutate()}
      />
    </div>
  );
}

function InviteSheet({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onInvited: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [allowedDepartments, setAllowedDepartments] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setName("");
    setEmail("");
    setRole("member");
    setAllowedDepartments([]);
    setError(null);
  }

  function toggleDept(slug: string) {
    setAllowedDepartments((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );
  }

  async function submit() {
    setError(null);
    if (!email.includes("@")) {
      setError("Enter a valid email");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || null,
          email: email.trim(),
          role,
          allowed_departments: allowedDepartments,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to send invite");
      }
      onInvited();
      reset();
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col border-l border-border bg-background p-0 text-foreground sm:max-w-120"
      >
        <SheetHeader className="border-b border-border px-6 py-5">
          <SheetTitle className="font-serif text-2xl font-normal tracking-tight text-foreground">
            Invite member
          </SheetTitle>
          <SheetDescription className="text-[13px] text-muted-foreground">
            They&apos;ll get an email with a link to set up their account.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sarah Lee"
              className="bg-input/40"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sarah@acme.com"
              className="bg-input/40"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole((v ?? "member") as Role)}>
              <SelectTrigger className="w-full bg-input/40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">Owner</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="developer">Developer (Rawgrowth support)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Department access</Label>
            <p className="text-[11px] text-muted-foreground">
              Leave empty for full access. Pick one or more to scope this
              member to only those departments in the sidebar and /agents.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {DEPT_OPTIONS.map((d) => {
                const on = allowedDepartments.includes(d.slug);
                return (
                  <button
                    key={d.slug}
                    type="button"
                    onClick={() => toggleDept(d.slug)}
                    aria-pressed={on}
                    className={
                      on
                        ? "rounded-full border border-primary/40 bg-primary/15 px-2.5 py-1 text-[11px] font-medium text-primary"
                        : "rounded-full border border-border bg-input/30 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                    }
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {error}
            </div>
          )}
        </div>
        <SheetFooter className="border-t border-border bg-background px-6 py-4">
          <div className="flex w-full items-center justify-end gap-2">
            <SheetClose
              render={
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
              }
            />
            <Button
              onClick={submit}
              disabled={submitting}
              size="sm"
              className="bg-primary text-white hover:bg-primary/90"
            >
              <Mail className="size-4" />
              {submitting ? "Sending…" : "Send invitation"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
