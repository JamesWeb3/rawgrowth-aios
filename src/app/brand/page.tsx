import { redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";

import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";

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

  const subtitle = profile
    ? `Version ${profile.version} · ${profile.status}${
        profile.approved_at
          ? ` · approved ${new Date(Number(profile.approved_at)).toLocaleDateString()}`
          : ""
      }`
    : "Generated from onboarding. Edit by re-running the onboarding chat.";

  return (
    <PageShell
      title={ctx.activeOrgName ?? "Brand profile"}
      description={subtitle}
    >
      <div className="max-w-3xl">
        {profile?.content ? (
          <article className="prose prose-invert max-w-none">
            <ReactMarkdown>{profile.content}</ReactMarkdown>
          </article>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-card/30 p-6">
            <p className="text-sm text-muted-foreground">
              No brand profile yet. Run the onboarding chat to generate one.
            </p>
            <a
              href="/onboarding"
              className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
            >
              Start onboarding →
            </a>
          </div>
        )}
      </div>
    </PageShell>
  );
}
