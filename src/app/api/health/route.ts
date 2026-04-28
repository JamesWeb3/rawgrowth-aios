import { NextResponse } from "next/server";
import { DEPLOY_MODE } from "@/lib/deploy-mode";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Cheap liveness + DB-reachability probe used by docker-compose healthchecks
 * and the update pipeline. Never returns 5xx for app-logic errors  -  only
 * for hard infrastructure failure (DB unreachable).
 */
export async function GET() {
  const startedAt = Date.now();
  let db: "ok" | "fail" = "ok";
  try {
    await supabaseAdmin()
      .from("rgaios_organizations")
      .select("id", { head: true, count: "exact" })
      .limit(1);
  } catch {
    db = "fail";
  }

  const body = {
    ok: db === "ok",
    deployMode: DEPLOY_MODE,
    db,
    uptimeSec: Math.floor(process.uptime()),
    took: Date.now() - startedAt,
  };

  return NextResponse.json(body, { status: db === "ok" ? 200 : 503 });
}
