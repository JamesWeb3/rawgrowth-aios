"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CircleDot,
  Bot,
  Target,
  Repeat,
  DollarSign,
  Settings2,
  Plug,
  Plus,
  BookOpen,
  Activity,
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

type Org = { id: string; name: string };

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
};

const navSections: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Custom Feature", href: "/custom-feature", icon: Plus },
    ],
  },
  {
    label: "Agent Organization",
    items: [
      { label: "Agents", href: "/agents", icon: Bot },
      { label: "Routines", href: "/routines", icon: Repeat },
      { label: "Activity", href: "/activity", icon: Activity },
      { label: "Knowledge", href: "/knowledge", icon: BookOpen },
      { label: "Issues", href: "/issues", icon: CircleDot },
      { label: "Goals", href: "/goals", icon: Target },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "Costs", href: "/costs", icon: DollarSign },
      { label: "Integrations", href: "/integrations", icon: Plug },
      { label: "Company", href: "/company", icon: Settings2 },
    ],
  },
];

export function AppSidebar({
  orgName,
  isAdmin = false,
  isImpersonating = false,
  homeOrgId = null,
  activeOrgId = null,
  orgs = [],
}: {
  orgName?: string;
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
        {navSections.map((section) => (
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
                      >
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                        {item.href === "/activity" && <ActivityNavBadge />}
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
        <UserMenu name="James Oldham" email="james.oldham0604@gmail.com" />
      </SidebarFooter>
    </Sidebar>
  );
}
