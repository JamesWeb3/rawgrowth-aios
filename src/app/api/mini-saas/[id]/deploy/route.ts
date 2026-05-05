import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * POST /api/mini-saas/[id]/deploy
 *
 * Chris's ask (May 4): mini-saas should auto-deploy to Vercel for the
 * client so they can share a real URL.
 *
 * Flow:
 *   1. Fetch the mini-saas row, scoped by org. Reject if no
 *      generated_html or status != 'ready'.
 *   2. POST https://api.vercel.com/v13/deployments with the HTML
 *      packed as a single index.html file (base64-encoded). Auth via
 *      `VERCEL_TOKEN` env - per-fleet for now, no per-org config yet.
 *   3. Persist deployed_url + deployed_at on the row + audit log entry.
 *
 * The Vercel API returns a `url` like `mini-saas-abc123.vercel.app`.
 * We prepend https:// so the UI can render an <a href> directly.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const VERCEL_API = "https://api.vercel.com/v13/deployments";

type DeployBody = {
  name?: string;
  files: Array<{ file: string; data: string; encoding?: "base64" | "utf-8" }>;
  target?: "production" | "preview";
  projectSettings?: {
    framework?: string | null;
  };
};

type VercelDeployResponse = {
  url?: string;
  id?: string;
  error?: { code?: string; message?: string };
};

function slugifyName(input: string): string {
  // Vercel project names: lowercase, alphanumerics + dashes, max 100 chars.
  // Strip everything else; collapse repeats; trim leading/trailing dashes.
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 52);
  return cleaned || "mini-saas";
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "VERCEL_TOKEN not configured" },
      { status: 500 },
    );
  }

  const db = supabaseAdmin();
  const { data: row, error: fetchErr } = await db
    .from("rgaios_mini_saas")
    .select("id, title, generated_html, status")
    .eq("organization_id", ctx.activeOrgId)
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const app = row as {
    id: string;
    title: string;
    generated_html: string | null;
    status: string;
  };
  if (!app.generated_html || app.status !== "ready") {
    return NextResponse.json(
      { error: "app is not ready to deploy" },
      { status: 400 },
    );
  }

  const projectName = `${slugifyName(app.title)}-${app.id.slice(0, 8)}`;
  const body: DeployBody = {
    name: projectName,
    files: [
      {
        file: "index.html",
        data: Buffer.from(app.generated_html, "utf-8").toString("base64"),
        encoding: "base64",
      },
    ],
    target: "production",
    projectSettings: { framework: null },
  };

  let payload: VercelDeployResponse;
  try {
    const res = await fetch(VERCEL_API, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    payload = (await res.json()) as VercelDeployResponse;
    if (!res.ok || !payload.url) {
      const msg =
        payload.error?.message ?? `vercel HTTP ${res.status}`;
      return NextResponse.json(
        { error: msg, vercel: payload },
        { status: 502 },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "vercel call failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const deployedUrl = payload.url.startsWith("http")
    ? payload.url
    : `https://${payload.url}`;
  const deployedAt = new Date().toISOString();

  const { error: updateErr } = await db
    .from("rgaios_mini_saas")
    .update({
      deployed_url: deployedUrl,
      deployed_at: deployedAt,
      updated_at: deployedAt,
    } as never)
    .eq("id", app.id);
  if (updateErr) {
    return NextResponse.json(
      { error: `deploy succeeded but persist failed: ${updateErr.message}`,
        deployed_url: deployedUrl },
      { status: 500 },
    );
  }

  await db.from("rgaios_audit_log").insert({
    organization_id: ctx.activeOrgId,
    kind: "mini_saas_deployed",
    actor_type: "user",
    actor_id: "dashboard",
    detail: {
      mini_saas_id: app.id,
      title: app.title,
      deployed_url: deployedUrl,
      vercel_deployment_id: payload.id ?? null,
    },
  } as never);

  return NextResponse.json({
    ok: true,
    deployed_url: deployedUrl,
    deployed_at: deployedAt,
  });
}
