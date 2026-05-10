"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

// Routes that should NEVER be the post-signin landing. /agents/<id>
// drops the user straight into a chat surface when they probably
// just wanted the dashboard. /auth/* is a redirect loop. Anything
// off-domain is XSS-bait. Everything else is fine.
const CALLBACK_BLOCKLIST = [/^\/agents\//, /^\/auth\//];

function isSafeCallback(url: string | null): boolean {
  if (!url) return false;
  // Reject absolute URLs; only same-origin paths.
  if (!url.startsWith("/")) return false;
  if (url.startsWith("//")) return false;
  for (const re of CALLBACK_BLOCKLIST) {
    if (re.test(url)) return false;
  }
  return true;
}

export default function SignInPage() {
  const search = useSearchParams();
  // Default post-signin landing is the dashboard. NextAuth's automatic
  // callbackUrl propagation can park the user on whatever route forced
  // the redirect (e.g. /agents/<atlas-id> from a stale session-expired
  // tab), which lands them on Atlas chat instead of the dashboard
  // overview. Whitelist only "safe" callback paths; anything else
  // collapses to "/" so first-after-login is always the Dashboard
  // (bug W8 #10).
  const rawCallback = search.get("callbackUrl");
  const callbackUrl = isSafeCallback(rawCallback) ? rawCallback! : "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    // Validate creds first (no redirect) so we can show a friendly error.
    // If valid, kick a redirect-mode signIn so the Set-Cookie header and
    // the 302 leave the server in a single response  -  avoids a race where
    // middleware on the destination route runs before the session cookie
    // has propagated to the client.
    const probe = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    if (!probe || probe.error) {
      setLoading(false);
      setError("Invalid email or password.");
      return;
    }
    await signIn("credentials", {
      email,
      password,
      redirect: true,
      callbackUrl,
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm border-border bg-card/70 backdrop-blur-sm">
        <CardContent className="p-6">
          <div className="mb-6">
            <h1 className="font-serif text-2xl text-foreground">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Welcome back to Rawgrowth.
            </p>
          </div>
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
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p className="text-sm text-red-400" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm">
            <Link
              href="/auth/forgot-password"
              className="text-muted-foreground hover:text-foreground"
            >
              Forgot password?
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
