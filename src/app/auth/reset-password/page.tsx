"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export default function ResetPasswordPage() {
  const router = useRouter();
  const search = useSearchParams();
  const token = search.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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
    setLoading(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Failed to reset password.");
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/auth/signin"), 1500);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm border-border bg-card/70 backdrop-blur-sm">
        <CardContent className="p-6">
          <div className="mb-6">
            <h1 className="font-serif text-2xl text-foreground">Set new password</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose a password with at least 8 characters.
            </p>
          </div>

          {!token ? (
            <p className="text-sm text-red-400">Missing reset token.</p>
          ) : done ? (
            <p className="text-sm text-muted-foreground">
              Password updated. Redirecting to sign in…
            </p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
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
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Saving…" : "Update password"}
              </Button>
            </form>
          )}

          <div className="mt-4 text-center text-sm">
            <Link
              href="/auth/signin"
              className="text-muted-foreground hover:text-foreground"
            >
              Back to sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
