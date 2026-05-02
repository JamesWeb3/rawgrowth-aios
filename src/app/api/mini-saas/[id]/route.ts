import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { generateMiniSaas } from "@/lib/mini-saas/generator";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const { data } = await supabaseAdmin()
    .from("rgaios_mini_saas")
    .select(
      "id, title, description, prompt, generated_html, status, generation_meta, created_at, updated_at",
    )
    .eq("organization_id", ctx.activeOrgId)
    .eq("id", id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ app: data });
}

/**
 * POST /api/mini-saas/[id] - regenerate. Body { prompt } overrides the
 * stored prompt; otherwise re-runs with the existing one.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { prompt?: string };
  const newPrompt = body.prompt?.trim();

  const { data: row } = await supabaseAdmin()
    .from("rgaios_mini_saas")
    .select("prompt")
    .eq("organization_id", ctx.activeOrgId)
    .eq("id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const prompt =
    newPrompt && newPrompt.length > 0
      ? newPrompt
      : ((row as { prompt: string }).prompt ?? "");
  if (!prompt) {
    return NextResponse.json({ error: "no prompt" }, { status: 400 });
  }

  await supabaseAdmin()
    .from("rgaios_mini_saas")
    .update({ status: "generating", prompt } as never)
    .eq("id", id);

  try {
    const { html } = await generateMiniSaas({
      organizationId: ctx.activeOrgId,
      organizationName: ctx.activeOrgName,
      prompt,
    });
    await supabaseAdmin()
      .from("rgaios_mini_saas")
      .update({
        generated_html: html,
        status: "ready",
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", id);
    return NextResponse.json({ id, status: "ready" });
  } catch (err) {
    const msg = (err as Error).message;
    await supabaseAdmin()
      .from("rgaios_mini_saas")
      .update({
        status: "failed",
        generation_meta: { error: msg } as never,
      } as never)
      .eq("id", id);
    return NextResponse.json({ id, status: "failed", error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const { error } = await supabaseAdmin()
    .from("rgaios_mini_saas")
    .delete()
    .eq("organization_id", ctx.activeOrgId)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
