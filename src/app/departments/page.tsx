import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { DepartmentsView } from "@/components/departments/departments-view";
import { buttonVariants } from "@/components/ui/button";

export const metadata = {
  title: "Departments - Rawgrowth",
};

export default function DepartmentsPage() {
  return (
    <PageShell
      title="Departments"
      description="Group agents by business pillar. Use the seeded departments or add your own. Agents can also stay unassigned."
      actions={
        // Base UI's Button doesn't support asChild like Radix - passing it
        // leaks to the DOM. Style the Link directly with buttonVariants.
        <Link
          href="/departments/new"
          className={buttonVariants({ variant: "default", size: "sm" })}
        >
          + Add department
        </Link>
      }
    >
      <DepartmentsView />
    </PageShell>
  );
}
