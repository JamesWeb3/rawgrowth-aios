import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/admin";
import { PageShell } from "@/components/page-shell";
import { CompanyTabs } from "@/components/company/tabs";

export default async function CompanyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/auth/signin");

  return (
    <PageShell
      title="Company"
      description="Configure the company — settings, people, and the capabilities your agents draw on."
    >
      <CompanyTabs />
      <div className="mt-6">{children}</div>
    </PageShell>
  );
}
