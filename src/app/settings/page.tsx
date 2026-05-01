import { redirect } from "next/navigation";
import Link from "next/link";
import { Mail, Building2, Plug, ShieldAlert } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/auth/signin");

  return (
    <PageShell
      title="Settings"
      description="Your account, your workspace, and where to manage them."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SettingTile
          icon={Mail}
          title="Account"
          description="Signed in as"
          value={ctx.userEmail ?? "-"}
        />
        <SettingTile
          icon={Building2}
          title="Workspace"
          description="Active organisation"
          value={ctx.activeOrgName ?? "-"}
          link={{ href: "/company", label: "Manage" }}
        />
        <SettingTile
          icon={Plug}
          title="Integrations"
          description="External services this workspace uses"
          value="Slack, Gmail, Calendar, Telegram, ..."
          link={{ href: "/connections", label: "Open Connections" }}
        />
        <SettingTile
          icon={ShieldAlert}
          title="Security"
          description="Password, sessions, 2FA"
          value="Coming soon"
          muted
        />
      </div>
    </PageShell>
  );
}

function SettingTile({
  icon: Icon,
  title,
  description,
  value,
  link,
  muted,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  value: string;
  link?: { href: string; label: string };
  muted?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/30 p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground">
          <Icon className="size-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>
          <p
            className={
              "mt-2 text-sm " + (muted ? "italic text-muted-foreground" : "text-foreground")
            }
          >
            {value}
          </p>
          {link && (
            <Link
              href={link.href}
              className="mt-3 inline-flex h-7 items-center rounded-[min(var(--radius-md),12px)] border border-border px-2.5 text-[0.8rem] hover:border-primary/40"
            >
              {link.label}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
