"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

type InvitePreview = {
  email: string;
  name: string | null;
  role: "owner" | "admin" | "member";
  organizationName: string;
};

export default function AcceptInvitePage() {
  const router = useRouter();
  const search = useSearchParams();
  const token = search.get("token") ?? "";

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [invalidMsg, setInvalidMsg] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setInvalidMsg("Missing invitation token.");
      setLoading(false);
      return;
    }
    (async () => {
      const res = await fetch(
        `/api/invites/accept?token=${encodeURIComponent(token)}`,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setInvalidMsg(body.error ?? "Invitation is no longer valid.");
      } else {
        const { invite } = (await res.json()) as { invite: InvitePreview };
        setInvite(invite);
      }
      setLoading(false);
    })();
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/invites/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Failed to accept invitation.");
      return;
    }
    router.push("/auth/signin?invited=1");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm border-border bg-card/70 backdrop-blur-sm">
        <CardContent className="p-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading invitation…</p>
          ) : invalidMsg ? (
            <div>
              <h1 className="font-serif text-2xl text-foreground">
                Invitation unavailable
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">{invalidMsg}</p>
              <Link
                href="/auth/signin"
                className="mt-4 inline-block text-sm text-primary hover:underline"
              >
                Back to sign in
              </Link>
            </div>
          ) : invite ? (
            <>
              <div className="mb-6">
                <p className="text-[10px] font-medium uppercase tracking-[2px] text-primary">
                  You&apos;ve been invited
                </p>
                <h1 className="mt-1.5 font-serif text-2xl text-foreground">
                  Join {invite.organizationName}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  You&apos;ve been invited by{" "}
                  <span className="text-foreground">
                    {invite.organizationName}
                  </span>{" "}
                  to join as a{" "}
                  <span className="text-foreground">{invite.role}</span>. Please
                  set a password to continue.
                </p>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Signing up as{" "}
                  <span className="font-mono text-foreground">
                    {invite.email}
                  </span>
                </p>
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
                {error && (
                  <p className="text-sm text-red-400" role="alert">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={submitting} className="w-full">
                  {submitting ? "Creating account…" : "Accept invitation"}
                </Button>
              </form>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
