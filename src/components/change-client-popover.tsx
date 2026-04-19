"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Check, LogOut } from "lucide-react";
import { toast } from "sonner";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Org = { id: string; name: string };

export function ChangeClientPopover({
  orgs,
  homeOrgId,
  activeOrgId,
  isImpersonating,
}: {
  orgs: Org[];
  homeOrgId: string;
  activeOrgId: string | null;
  isImpersonating: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function switchTo(orgId: string | null) {
    setOpen(false);
    startTransition(async () => {
      const res = await fetch("/api/admin/switch-org", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      if (!res.ok) {
        toast.error("Failed to switch client.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={pending}
        className="group-data-[collapsible=icon]:hidden flex w-full items-center justify-between gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2 text-xs font-medium text-sidebar-foreground/90 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-60"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_6px_rgba(12,191,106,.7)]" />
          <span className="truncate">Change Client</span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-64 p-1.5">
        <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
          Switch Client
        </div>
        <div className="max-h-72 overflow-y-auto">
          {orgs.map((org) => {
            const isActive = org.id === activeOrgId;
            const isHome = org.id === homeOrgId;
            return (
              <button
                key={org.id}
                onClick={() => switchTo(org.id)}
                disabled={pending || isActive}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors",
                  isActive
                    ? "bg-primary/10 text-foreground"
                    : "text-foreground/85 hover:bg-accent hover:text-foreground",
                  "disabled:cursor-default",
                )}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{org.name}</span>
                  {isHome && (
                    <span className="text-[10px] uppercase tracking-[1.5px] text-primary/80">
                      Your team
                    </span>
                  )}
                </span>
                {isActive && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            );
          })}
        </div>
        {isImpersonating && (
          <>
            <div className="my-1 h-px bg-border" />
            <button
              onClick={() => switchTo(null)}
              disabled={pending}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/85 hover:bg-accent hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              Exit admin view
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
