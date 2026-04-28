import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getOrgContext } from "@/lib/auth/admin";

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

  // Admins hitting the onboarding path directly get bounced to the home
  // dashboard; onboarding is an owner-only flow for their own org.
  if (ctx.isAdmin && !ctx.isImpersonating) redirect("/");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#060B08]">
      {children}
    </div>
  );
}
