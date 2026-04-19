"use client";

import { ChevronsUpDown, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { useSidebar } from "@/components/ui/sidebar";

type UserMenuProps = {
  name: string;
  email: string;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function UserMenu({ name, email }: UserMenuProps) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <Popover>
      <PopoverTrigger
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <Avatar className="size-8 rounded-md border border-sidebar-border">
          <AvatarFallback className="rounded-md bg-primary/15 text-[11px] font-semibold text-primary">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        {!collapsed && (
          <>
            <div className="flex min-w-0 flex-1 flex-col text-left leading-tight">
              <span className="truncate text-[13px] font-medium text-foreground">
                {name}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {email}
              </span>
            </div>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        className="w-60 border-border bg-popover p-0 text-foreground"
      >
        <div className="flex items-center gap-2.5 px-3 py-3">
          <Avatar className="size-9 rounded-md border border-sidebar-border">
            <AvatarFallback className="rounded-md bg-primary/15 text-xs font-semibold text-primary">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[13px] font-medium">{name}</span>
            <span className="truncate text-[11px] text-muted-foreground">
              {email}
            </span>
          </div>
        </div>
        <Separator />
        <div className="flex flex-col py-1">
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/auth/signin" })}
            className="flex items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="size-4" />
            Log out
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
