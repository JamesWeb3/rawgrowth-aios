import { NextResponse } from "next/server";
import { auth } from "@/auth";

const PUBLIC_PATHS = [
  "/auth/signin",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/invite",
];

// API routes that authenticate themselves (bearer tokens, webhooks, etc).
// NextAuth middleware should NOT intercept these  -  they'd return a 307
// redirect to /auth/signin for an HTML page, which breaks MCP clients.
const PUBLIC_API_PREFIXES = [
  "/api/auth",             // NextAuth itself
  "/api/mcp",              // per-tenant MCP bearer token
  "/api/health",           // health probe
  "/api/nango/webhook",    // Nango posts here, no session
  "/api/webhooks",         // Telegram etc
  "/api/invites/accept",   // GET preview + POST accept use invite token, not session
  "/api/cron",             // CRON_SECRET bearer, called by the self-hosted tick timer
  "/api/connections/slack/oauth/callback", // Slack OAuth redirect  -  state is self-verifying
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  const isPublic =
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    PUBLIC_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (isPublic) return NextResponse.next();

  if (!req.auth) {
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
