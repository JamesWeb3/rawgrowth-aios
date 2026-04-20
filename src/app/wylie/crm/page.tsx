import { Phone } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { assertClientAccess } from "@/clients/guard";

export const metadata = { title: "CRM & Dialer — Wylie Hawkins X-Ray" };

export default async function WylieCrmPage() {
  await assertClientAccess("/wylie/crm");
  return (
    <PageShell
      title="CRM & Dialer"
      description="Lead pipeline, browser-based dialer, call recording + transcript."
    >
      <EmptyState
        icon={Phone}
        title="CRM + Dialer arrives in weeks 3-6"
        description="Close.com integration, Deepgram transcription, dispositions enforced. This is the constraint-fix build."
      />
    </PageShell>
  );
}
