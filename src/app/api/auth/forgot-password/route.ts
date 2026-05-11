import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { createResetToken } from "@/lib/auth/reset-token";
import { sendPasswordResetEmail } from "@/lib/auth/email";

export async function POST(req: Request) {
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  const normalized = String(email ?? "").trim().toLowerCase();

  if (!normalized) {
    return NextResponse.json({ ok: false, error: "Email required" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: user } = await sb
    .from("rgaios_users")
    .select("id, email")
    .eq("email", normalized)
    .maybeSingle();

  if (!user) {
    // Always 200 to prevent email enumeration.
    return NextResponse.json({ ok: true });
  }

  const { token, tokenHash, expiresAt } = createResetToken();

  const { error } = await sb.from("rgaios_password_resets").insert({
    token_hash: tokenHash,
    user_id: user.id,
    expires_at: expiresAt.toISOString(),
  });
  if (error) {
    return NextResponse.json({ ok: false, error: "Failed to create reset" }, { status: 500 });
  }

  const base = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
  const resetUrl = `${base}/auth/reset-password?token=${encodeURIComponent(token)}`;

  try {
    await sendPasswordResetEmail(user.email, resetUrl);
  } catch (err) {
    console.error("[forgot-password] Resend send failed:", err);
    return NextResponse.json(
      { ok: false, error: `Failed to send email: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
