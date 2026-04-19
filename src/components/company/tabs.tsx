"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/company/general", label: "General" },
  { href: "/company/members", label: "Members" },
  { href: "/company/skills", label: "Skills" },
];

export function CompanyTabs() {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-1 border-b border-border">
      {TABS.map((t) => {
        const active =
          pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              active
                ? "border-b-2 border-primary px-3 py-2 text-[13px] font-medium text-foreground"
                : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground"
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
