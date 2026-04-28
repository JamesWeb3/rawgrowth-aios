"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Bot,
  ShieldCheck,
  Repeat,
  Settings2,
  Plug,
  Building2,
  Activity,
  Sparkles,
  BookOpen,
  Palette,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { UserMenu } from "@/components/user-menu";
import { ChangeClientPopover } from "@/components/change-client-popover";
import { ActivityNavBadge } from "@/components/activity-nav-badge";
import { ApprovalsNavBadge } from "@/components/approvals-nav-badge";

type Org = { id: string; name: string };

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  comingSoon?: boolean;
};

type NavSection = { label: string; items: NavItem[]; adminOnly?: boolean };

const navSections: NavSection[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Brand", href: "/brand", icon: Palette },
      { label: "Departments", href: "/departments", icon: Building2 },
      { label: "Knowledge", href: "/knowledge", icon: BookOpen },
    ],
  },
  {
    label: "Agent Organization",
    items: [
      { label: "Agents", href: "/agents", icon: Bot },
      { label: "Routines", href: "/routines", icon: Repeat },
      { label: "Activity", href: "/activity", icon: Activity },
      { label: "Approvals", href: "/approvals", icon: ShieldCheck },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "Connections", href: "/connections", icon: Plug },
      { label: "Skills", href: "/skills", icon: Sparkles },
      { label: "Company", href: "/company", icon: Settings2 },
    ],
  },
];

export function AppSidebar({
  orgName,
  userEmail = null,
  userName = null,
  isAdmin = false,
  isImpersonating = false,
  homeOrgId = null,
  activeOrgId = null,
  orgs = [],
}: {
  orgName?: string;
  userEmail?: string | null;
  userName?: string | null;
  isAdmin?: boolean;
  isImpersonating?: boolean;
  homeOrgId?: string | null;
  activeOrgId?: string | null;
  orgs?: Org[];
}) {
  const pathname = usePathname();
  const displayName = orgName ?? "Rawgrowth";

  return (
    <Sidebar
      collapsible="none"
      className="sticky top-0 h-svh border-r border-sidebar-border"
    >
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
            <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_8px_rgba(12,191,106,.6)]" />
          </span>
          <span className="font-serif text-[1.25rem] leading-none tracking-tight text-foreground group-data-[collapsible=icon]:hidden">
            {displayName}<span className="text-primary">.</span>
          </span>
        </Link>
        {isAdmin && homeOrgId && (
          <div className="mt-3">
            <ChangeClientPopover
              orgs={orgs}
              homeOrgId={homeOrgId}
              activeOrgId={activeOrgId}
              isImpersonating={isImpersonating}
            />
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        {navSections
          .filter((s) => !s.adminOnly || isAdmin)
          .map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
              {section.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const active =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={item.label}
                        render={<Link href={item.href} />}
                        className={
                          item.comingSoon
                            ? "border border-dashed border-sidebar-border/70 bg-transparent text-[13px] text-muted-foreground/70 hover:text-foreground"
                            : "text-[13px]"
                        }
                      >
                        <item.icon className="size-4" strokeWidth={1.5} />
                        <span className={item.comingSoon ? "italic" : undefined}>
                          {item.label}
                        </span>
                        {item.href === "/activity" && <ActivityNavBadge />}
                        {item.href === "/approvals" && <ApprovalsNavBadge />}
                        {item.badge && (
                          <span className="ml-auto rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.5px] text-amber-400 group-data-[collapsible=icon]:hidden">
                            {item.badge}
                          </span>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <UserMenu
          name={userName ?? userEmail ?? "Signed in"}
          email={userEmail ?? ""}
        />
      </SidebarFooter>
    </Sidebar>
  );
}
