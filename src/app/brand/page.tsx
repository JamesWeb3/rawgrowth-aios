import { redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";

import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Read-only brand profile view. The authoritative copy lives in
 * rgaios_brand_profiles (status='approved', highest version). Operators
 * edit through the onboarding chat's approve_brand_profile flow; this
 * page just renders whatever landed.
 */
export default async function BrandProfilePage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

  const { data: profile } = await supabaseAdmin()
    .from("rgaios_brand_profiles")
    .select("id, version, content, status, generated_at, approved_at")
    .eq("organization_id", ctx.activeOrgId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 text-[var(--text-strong)]">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-widest text-primary">
          Brand profile
        </p>
        <h1 className="mt-1 text-3xl">
          {ctx.activeOrgName ?? "Your brand"}
        </h1>
        {profile && (
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            version {profile.version} · status {profile.status}
            {profile.approved_at
              ? ` · approved ${new Date(
                  Number(profile.approved_at),
                ).toLocaleDateString()}`
              : ""}
          </p>
        )}
      </header>

      {profile?.content ? (
        <article className="prose prose-invert max-w-none">
          <ReactMarkdown>{profile.content}</ReactMarkdown>
        </article>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          No brand profile yet. Complete onboarding to generate one.
        </p>
      )}
    </div>
  );
}
