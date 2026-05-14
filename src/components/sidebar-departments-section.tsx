"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import {
  Building2,
  ChevronDown,
  Megaphone,
  BadgeDollarSign,
  PackageCheck,
  Wallet,
  Code2,
} from "lucide-react";

import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { jsonFetcher } from "@/lib/swr";
import { DEFAULT_DEPARTMENTS } from "@/lib/agents/dto";
import type { Agent } from "@/lib/agents/dto";

// Icon + label per seeded department slug. Mirrors the SEEDED_META
// table in src/components/departments/departments-view.tsx so the
// sidebar entries visually match the dept cards on /departments.
const DEPT_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }
> = {
  marketing: { label: "Marketing", icon: Megaphone },
  sales: { label: "Sales", icon: BadgeDollarSign },
  fulfilment: { label: "Fulfilment", icon: PackageCheck },
  finance: { label: "Finance", icon: Wallet },
  development: { label: "Development", icon: Code2 },
};

/**
 * Collapsible "Departments" group in the left rail.
 *
 * The top button is a real link to /departments (overview) so a click
 * still navigates - but it also toggles the submenu open/closed via
 * the chevron affordance on the right. Submenu lists the five seeded
 * departments with optional agent-count badges fetched via the same
 * /api/agents endpoint the rest of the app uses (single SWR cache key,
 * so the count stays in sync as the user hires).
 */
export function SidebarDepartmentsSection() {
  const pathname = usePathname();
  const onDepartments = pathname === "/departments" || pathname.startsWith("/departments/");
  const [expanded, setExpanded] = useState<boolean>(onDepartments);

  const { data } = useSWR<{ agents: Agent[] }>("/api/agents", jsonFetcher, {
    revalidateOnFocus: false,
  });
  const { data: me } = useSWR<{
    allowedDepartments: string[] | null;
  }>("/api/me", jsonFetcher, { revalidateOnFocus: false });

  const counts: Record<string, number> = {};
  for (const slug of DEFAULT_DEPARTMENTS) counts[slug] = 0;
  for (const a of data?.agents ?? []) {
    if (a.department && counts[a.department] !== undefined) {
      counts[a.department] += 1;
    }
  }

  // null = no restriction. Restricted invitees only see their slugs.
  const visibleSlugs =
    me?.allowedDepartments === null || me?.allowedDepartments === undefined
      ? DEFAULT_DEPARTMENTS
      : DEFAULT_DEPARTMENTS.filter((s) =>
          (me.allowedDepartments as string[]).includes(s),
        );

  return (
    <>
      <SidebarMenuItem>
        <div className="flex w-full items-center">
          <SidebarMenuButton
            isActive={onDepartments}
            tooltip="Departments"
            render={<Link href="/departments" />}
            className="text-[13px]"
          >
            <Building2 className="size-4" strokeWidth={1.5} />
            <span>Departments</span>
          </SidebarMenuButton>
          <button
            type="button"
            aria-label={expanded ? "Collapse departments" : "Expand departments"}
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="ml-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground group-data-[collapsible=icon]:hidden"
          >
            <ChevronDown
              className={
                expanded
                  ? "size-3.5 transition-transform"
                  : "size-3.5 -rotate-90 transition-transform"
              }
              strokeWidth={1.75}
            />
          </button>
        </div>
      </SidebarMenuItem>

      {expanded && (
        <SidebarMenuSub>
          {visibleSlugs.map((slug) => {
            const meta = DEPT_META[slug];
            const Icon = meta.icon;
            const href = `/departments/${slug}`;
            const active = pathname === href;
            const count = counts[slug] ?? 0;
            return (
              <SidebarMenuSubItem key={slug}>
                <SidebarMenuSubButton
                  isActive={active}
                  render={<Link href={href} />}
                >
                  <Icon className="size-3.5" strokeWidth={1.5} />
                  <span>{meta.label}</span>
                  {count > 0 && (
                    <span className="ml-auto rounded-full border border-border bg-card/60 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-muted-foreground">
                      {count}
                    </span>
                  )}
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            );
          })}
        </SidebarMenuSub>
      )}
    </>
  );
}
