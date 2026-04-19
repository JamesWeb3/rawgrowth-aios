"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setLoading(false);

    if (res.ok) {
      setSubmitted(true);
      return;
    }

    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 404) {
      toast.error(data.error ?? "This email can't be found in our system.");
    } else {
      toast.error(data.error ?? "Something went wrong. Please try again.");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm border-border bg-card/70 backdrop-blur-sm">
        <CardContent className="p-6">
          <div className="mb-6">
            <h1 className="font-serif text-2xl text-foreground">Forgot password</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your email and we&apos;ll send you a link to set a new password.
            </p>
          </div>

          {submitted ? (
            <p className="text-sm text-muted-foreground">
              If an account exists for <span className="text-foreground">{email}</span>,
              a reset link is on its way. Check your inbox.
            </p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Sending…" : "Send reset link"}
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
