import { NextResponse } from "next/server";
import { DEPLOY_MODE } from "@/lib/deploy-mode";

export const runtime = "nodejs";

/**
 * Minimal config the browser needs to branch behaviour between the hosted
 * SaaS and self-hosted VPS SKUs. Intentionally tiny  -  add here only what
 * the client genuinely needs at runtime.
 */
export async function GET() {
  return NextResponse.json({ deployMode: DEPLOY_MODE });
}
