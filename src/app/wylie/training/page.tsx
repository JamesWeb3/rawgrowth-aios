import { GraduationCap } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { assertClientAccess } from "@/clients/guard";

export const metadata = { title: "Training Hub — Wylie Hawkins X-Ray" };

export default async function WylieTrainingPage() {
  await assertClientAccess("/wylie/training");
  return (
    <PageShell
      title="Training Hub"
      description="Central library of training content, tagged by the Mon/Tue/Wed/Thu/Fri theme rotation."
    >
      <EmptyState
        icon={GraduationCap}
        title="Training Hub coming soon"
        description="Video + doc uploads, per-rep watch tracking, top-performer call library. Next V1 milestone."
      />
    </PageShell>
  );
}
