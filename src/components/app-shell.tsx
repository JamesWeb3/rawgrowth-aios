"use client";

import { usePathname } from "next/navigation";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "@/components/app-sidebar";
import { AdminBanner } from "@/components/admin-banner";

type Org = { id: string; name: string };

export function AppShell({
  children,
  orgName,
  isAdmin,
  isImpersonating,
  homeOrgId,
  activeOrgId,
  orgs,
}: {
  children: React.ReactNode;
  orgName?: string | null;
  isAdmin?: boolean;
  isImpersonating?: boolean;
  homeOrgId?: string | null;
  activeOrgId?: string | null;
  orgs?: Org[];
}) {
  const pathname = usePathname();
  const isAuthRoute = pathname?.startsWith("/auth");

  if (isAuthRoute) {
    return <>{children}</>;
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          orgName={orgName ?? undefined}
          isAdmin={isAdmin ?? false}
          isImpersonating={isImpersonating ?? false}
          homeOrgId={homeOrgId ?? null}
          activeOrgId={activeOrgId ?? null}
          orgs={orgs ?? []}
        />
        <SidebarInset className="bg-background">
          {isImpersonating && <AdminBanner orgName={orgName ?? null} />}
          {children}
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
