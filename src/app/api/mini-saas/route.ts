import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { generateMiniSaas } from "@/lib/mini-saas/generator";

export const runtime = "nodejs";
export const maxDuration = 120;

type AppRow = {
  id: string;
  title: string;
  description: string | null;
  prompt: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data } = await supabaseAdmin()
    .from("rgaios_mini_saas")
    .select("id, title, description, prompt, status, created_at, updated_at")
    .eq("organization_id", ctx.activeOrgId)
    .order("created_at", { ascending: false })
    .limit(100);
  return NextResponse.json({ apps: (data ?? []) as AppRow[] });
}

export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    description?: string;
    prompt?: string;
  };
  const title = String(body.title ?? "").trim();
  const prompt = String(body.prompt ?? "").trim();
  if (!title || !prompt) {
    return NextResponse.json(
      { error: "title and prompt required" },
      { status: 400 },
    );
  }

  // Find the Engineering Manager agent for attribution if it exists.
  const { data: emAgent } = await supabaseAdmin()
    .from("rgaios_agents")
    .select("id")
    .eq("organization_id", ctx.activeOrgId)
    .eq("role", "cto")
    .maybeSingle();
  const engineeringAgentId = (emAgent as { id: string } | null)?.id ?? null;

  // Insert draft row first so the UI can navigate before generation
  // completes (10-30s for a code-y prompt).
  const { data: inserted, error: insertErr } = await supabaseAdmin()
    .from("rgaios_mini_saas")
    .insert({
      organization_id: ctx.activeOrgId,
      title,
      description: body.description ?? null,
      prompt,
      status: "generating",
      created_by_agent_id: engineeringAgentId,
    } as never)
    .select("id")
    .single();
  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? "insert failed" },
      { status: 500 },
    );
  }
  const id = (inserted as { id: string }).id;

  // Generate inline via chatReply (Claude Max OAuth). Caller awaits -
  // Engineering Manager generations are typically 10-30s with a code-y
  // prompt; well under maxDuration.
  try {
    const { html } = await generateMiniSaas({
      organizationId: ctx.activeOrgId,
      organizationName: ctx.activeOrgName,
      prompt,
      agentId: engineeringAgentId ?? undefined,
    });
    await supabaseAdmin()
      .from("rgaios_mini_saas")
      .update({
        generated_html: html,
        status: "ready",
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", id);
    await supabaseAdmin()
      .from("rgaios_audit_log")
      .insert({
        organization_id: ctx.activeOrgId,
        kind: "mini_saas_generated",
        actor_type: "agent",
        actor_id: engineeringAgentId ?? "system",
        detail: { mini_saas_id: id, title },
      } as never);
    return NextResponse.json({ id, status: "ready" }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    await supabaseAdmin()
      .from("rgaios_mini_saas")
      .update({
        status: "failed",
        generation_meta: { error: msg } as never,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", id);
    return NextResponse.json(
      { id, status: "failed", error: msg },
      { status: 500 },
    );
  }
}
