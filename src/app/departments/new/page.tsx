import { redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { NewDepartmentForm } from "./NewDepartmentForm";

export const metadata = {
  title: "New department  -  Rawgrowth",
};

export default async function NewDepartmentPage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

  return (
    <PageShell
      title="New department"
      description="Creates a manager and two sub-agents with sensible defaults. You can rename and re-skill them right after."
    >
      <div className="max-w-xl">
        <NewDepartmentForm />
      </div>
    </PageShell>
  );
}
