import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { hashToken } from "@/lib/auth/reset-token";
import { hashPassword } from "@/lib/auth/password";

export async function POST(req: Request) {
  const { token, password } = (await req.json().catch(() => ({}))) as {
    token?: string;
    password?: string;
  };

  if (!token || !password || password.length < 8) {
    return NextResponse.json(
      { ok: false, error: "Token and password (min 8 chars) required" },
      { status: 400 },
    );
  }

  const tokenHash = hashToken(token);
  const sb = supabaseAdmin();

  const { data: reset } = await sb
    .from("rgaios_password_resets")
    .select("token_hash, user_id, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!reset || reset.used_at || new Date(reset.expires_at) < new Date()) {
    return NextResponse.json({ ok: false, error: "Invalid or expired token" }, { status: 400 });
  }

  const password_hash = await hashPassword(password);

  const { error: updErr } = await sb
    .from("rgaios_users")
    .update({ password_hash })
    .eq("id", reset.user_id);
  if (updErr) {
    return NextResponse.json({ ok: false, error: "Failed to update password" }, { status: 500 });
  }

  await sb
    .from("rgaios_password_resets")
    .update({ used_at: new Date().toISOString() })
    .eq("token_hash", tokenHash);

  return NextResponse.json({ ok: true });
}
