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
  userEmail,
  userName,
  isAdmin,
  isImpersonating,
  homeOrgId,
  activeOrgId,
  orgs,
}: {
  children: React.ReactNode;
  orgName?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  isAdmin?: boolean;
  isImpersonating?: boolean;
  homeOrgId?: string | null;
  activeOrgId?: string | null;
  orgs?: Org[];
}) {
  const pathname = usePathname();
  // Routes that render outside the authed AppShell:
  // - /auth/* (signin / forgot password / etc)
  // - /book/* (public booking pages by org slug)
  // - /b/* (public booking manage links by token)
  // The shell mounts authed sidebar widgets (SidebarDepartments, badges)
  // that fetch /api/* on hydration; on a public page this triggers a
  // 307 -> /auth/signin client-side and the public page never renders.
  const isPublicRoute =
    pathname?.startsWith("/auth") ||
    pathname?.startsWith("/book") ||
    pathname?.startsWith("/b/");

  if (isPublicRoute) {
    return <>{children}</>;
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          orgName={orgName ?? undefined}
          userEmail={userEmail ?? null}
          userName={userName ?? null}
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
