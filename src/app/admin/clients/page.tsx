import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/admin";
import { PageShell } from "@/components/page-shell";
import { ClientsView } from "@/components/admin/clients-view";

export const metadata = {
  title: "Clients — Rawgrowth",
};

export default async function AdminClientsPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/auth/signin");
  if (!ctx.isAdmin) redirect("/");

  return (
    <PageShell
      title="Clients"
      description="Every tenant on Rawgrowth AIOS. Create new clients, hand them their MCP config, jump into their workspace via the Change Client menu."
    >
      <ClientsView />
    </PageShell>
  );
}
