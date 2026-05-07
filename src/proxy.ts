import { NextResponse } from "next/server";
import { auth } from "@/auth";

const PUBLIC_PATHS = [
  "/auth/signin",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/invite",
  "/book",  // public booking pages: /book/[orgSlug]/[eventSlug]
  "/b",     // booking manage links: /b/[token]
];

// API routes that authenticate themselves (bearer tokens, webhooks, etc).
// NextAuth middleware should NOT intercept these  -  they'd return a 307
// redirect to /auth/signin for an HTML page, which breaks MCP clients.
const PUBLIC_API_PREFIXES = [
  "/api/auth",             // NextAuth itself
  "/api/mcp",              // per-tenant MCP bearer token
  "/api/health",           // health probe
  "/api/webhooks",         // Telegram, Stripe, Composio - all signed
  "/api/invites/accept",   // GET preview + POST accept use invite token, not session
  "/api/cron",             // CRON_SECRET bearer, called by the self-hosted tick timer
  "/api/connections/slack/oauth/callback", // Slack OAuth redirect  -  state is self-verifying
  "/api/book",             // public booking endpoints (slot fetch + create + manage)
  "/api/portal",           // buyer status page polls before any session exists
];

// CSRF defense-in-depth (on top of SameSite=Lax session cookies):
// every state-changing request to /api/* must have an Origin or Referer
// header that matches the request host. Browsers always set Origin on
// cross-origin POST so an attacker page can't silently issue a
// session-authenticated POST. Same-origin XHR works as before.
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_EXEMPT_PREFIXES = [
  "/api/auth", // NextAuth has its own csrfToken
  "/api/mcp", // bearer auth, no cookie session
  "/api/health",
  "/api/webhooks",
  "/api/cron",
  "/api/connections/slack/oauth/callback",
  "/api/book", // public booking
  "/api/invites/accept",
];

function originLooksSafe(req: Request, host: string): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  if (!origin && !referer) {
    // Same-origin XHR from old browsers / curl tests may omit both;
    // be permissive only when neither is set (no cross-site signal).
    return true;
  }
  const candidates = [origin, referer].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  for (const c of candidates) {
    try {
      const u = new URL(c);
      if (u.host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  const isPublic =
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    PUBLIC_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // CSRF: enforce origin match on cookie-authed state-changing /api/*.
  if (
    pathname.startsWith("/api/") &&
    STATE_CHANGING.has(req.method) &&
    !CSRF_EXEMPT_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    )
  ) {
    const host = req.headers.get("host") ?? req.nextUrl.host;
    if (!originLooksSafe(req, host)) {
      return NextResponse.json(
        { error: "csrf: origin mismatch" },
        { status: 403 },
      );
    }
  }

  if (isPublic) return NextResponse.next();

  if (!req.auth) {
    // For /api/* return JSON 401 so XHR / fetch clients don't get an
    // opaque 307 -> HTML signin page they can't consume.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = "/auth/signin";
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)"],
};
