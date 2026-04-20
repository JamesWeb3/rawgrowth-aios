"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ArrowUpRight } from "lucide-react";
import {
  SiGmail,
  SiSlack,
  SiNotion,
  SiGooglecalendar,
  SiGoogledrive,
  SiLinear,
  SiGithub,
  SiAsana,
  SiCanva,
  SiTelegram,
} from "react-icons/si";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IntegrationConnectionSheet } from "@/components/integration-connection-sheet";
import { useConnections } from "@/lib/connections/use-connections";

/**
 * Self-hosted integrations view.
 *
 * In self-hosted mode the client's Claude Code drives everything — and
 * Claude Desktop / Claude Code already ship **native connectors** for the
 * most common SaaS tools. We don't duplicate those. This page explains
 * how to connect them in Claude itself, plus pointers for niche tools
 * via community MCP servers.
 */

type NativeConnector = {
  name: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  brand: string;
};

const NATIVE: NativeConnector[] = [
  { name: "Gmail", Icon: SiGmail, brand: "#EA4335" },
  { name: "Google Calendar", Icon: SiGooglecalendar, brand: "#4285F4" },
  { name: "Google Drive", Icon: SiGoogledrive, brand: "#4285F4" },
  { name: "Slack", Icon: SiSlack, brand: "#4A154B" },
  { name: "Notion", Icon: SiNotion, brand: "#FFFFFF" },
  { name: "Linear", Icon: SiLinear, brand: "#5E6AD2" },
  { name: "GitHub", Icon: SiGithub, brand: "#FFFFFF" },
  { name: "Asana", Icon: SiAsana, brand: "#F06A6A" },
  { name: "Canva", Icon: SiCanva, brand: "#00C4CC" },
];

const COMMUNITY = [
  { name: "Shopify", url: "https://github.com/modelcontextprotocol/servers" },
  { name: "Stripe", url: "https://github.com/stripe/agent-toolkit" },
  { name: "Postgres", url: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres" },
  { name: "Filesystem", url: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem" },
  { name: "Brave Search", url: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search" },
  { name: "Fetch (any URL)", url: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch" },
];

export function SelfHostedIntegrationsGuide() {
  const { byIntegrationId } = useConnections();
  const [telegramOpen, setTelegramOpen] = useState(false);
  const telegramConn = byIntegrationId("telegram");
  const telegramDisplay =
    (telegramConn as { display_name?: string | null } | undefined)
      ?.display_name ?? null;

  return (
    <div className="space-y-8">
      {/* Explainer */}
      <Card className="border-border bg-card/40">
        <CardContent className="p-6">
          <h3 className="text-[14px] font-semibold text-foreground">
            How integrations work in Rawclaw
          </h3>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Your Claude Code (or Claude Desktop) on your laptop is what
            actually drives routines here — so the integrations live in
            Claude, not Rawclaw. Connect each tool once in Claude, and
            your agents pick them up automatically whenever they run.
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Rawclaw provides the workspace (routines, runs, approvals, the
            org) — Claude provides the tools (Gmail, Slack, Drive, and
            anything else you wire in).
          </p>
          <div className="mt-4 flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-[12px] text-primary">
            <Check className="size-3.5" />
            Nothing to configure here — it all happens in Claude.
          </div>
        </CardContent>
      </Card>

      {/* Native connectors */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold text-foreground">
            Anthropic native connectors
          </h3>
          <a
            href="https://claude.ai/settings/connectors"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            Open Claude connector settings <ArrowUpRight className="size-3" />
          </a>
        </div>
        <p className="mb-3 text-[12px] text-muted-foreground">
          Authorize these once inside Claude Desktop/Code. No OAuth in Rawclaw.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {NATIVE.map((n) => (
            <div
              key={n.name}
              className="flex items-center gap-2.5 rounded-lg border border-border bg-card/40 px-3 py-2.5"
            >
              <div
                className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border"
                style={{ backgroundColor: `${n.brand}1a` }}
              >
                <n.Icon
                  className="size-4"
                  style={{ color: n.brand === "#FFFFFF" ? "#fff" : n.brand }}
                />
              </div>
              <span className="text-[12.5px] font-medium text-foreground">
                {n.name}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Community MCP servers */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold text-foreground">
            Need something else? Install an MCP server
          </h3>
          <a
            href="https://modelcontextprotocol.io/examples"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            Browse all MCP servers <ArrowUpRight className="size-3" />
          </a>
        </div>
        <p className="mb-3 text-[12px] text-muted-foreground">
          For anything Anthropic doesn&apos;t ship natively — Shopify,
          Stripe, your own database, internal APIs — install a community
          MCP server in your Claude Code config. A few popular ones:
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {COMMUNITY.map((c) => (
            <Link
              key={c.name}
              href={c.url}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center justify-between rounded-md border border-border bg-card/30 px-3 py-2 text-[12.5px] transition-colors hover:border-primary/40"
            >
              <span className="font-medium text-foreground">{c.name}</span>
              <ArrowUpRight className="size-3.5 text-muted-foreground group-hover:text-primary" />
            </Link>
          ))}
        </div>
      </section>

      {/* Telegram — special-cased because it's the only integration with server-side bot auth */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold text-foreground">
            Talk to your agents via Telegram
          </h3>
        </div>
        <p className="mb-3 text-[12px] text-muted-foreground">
          Connect a Telegram bot and you can text your agents from your
          phone. Messages are stored in Rawclaw; your Claude Code reads
          them with the <code>telegram_inbox_read</code> tool and replies
          with <code>telegram_reply</code>. Run the{" "}
          <code>/rawgrowth-chat</code> slash command in Claude Code to
          drain the inbox.
        </p>
        <Card className="border-border bg-card/50">
          <CardContent className="flex items-center gap-4 p-4">
            <div
              className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border"
              style={{ backgroundColor: "#26A5E41a" }}
            >
              <SiTelegram className="size-6" style={{ color: "#26A5E4" }} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-foreground">
                Telegram
              </div>
              <div className="text-[11.5px] text-muted-foreground">
                {telegramConn
                  ? `Connected${telegramDisplay ? ` · ${telegramDisplay}` : ""}`
                  : "Not connected — click to set up a bot token"}
              </div>
            </div>
            <Button
              size="sm"
              variant={telegramConn ? "secondary" : "default"}
              className={
                telegramConn
                  ? "bg-white/5 text-foreground hover:bg-white/10"
                  : "btn-shine bg-primary text-white hover:bg-primary/90"
              }
              onClick={() => setTelegramOpen(true)}
            >
              {telegramConn ? "Manage" : "Connect"}
            </Button>
          </CardContent>
        </Card>
      </section>

      <IntegrationConnectionSheet
        integrationId={telegramOpen ? "telegram" : null}
        open={telegramOpen}
        onOpenChange={setTelegramOpen}
      />

      {/* Writing routines */}
      <Card className="border-border bg-card/30">
        <CardContent className="p-6">
          <h3 className="text-[13px] font-semibold text-foreground">
            Writing routines that use your connectors
          </h3>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
            In a routine&apos;s instructions, just tell Claude what to use
            in plain language:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-background/40 p-3 text-[11.5px] leading-relaxed text-foreground">
{`Every morning, use Gmail to find unread messages from today. For anything
urgent, draft a reply in Gmail. Then post a one-line summary to the
#daily-standup channel in Slack. When done, call runs_complete with a
short summary of what you did.`}
          </pre>
          <p className="mt-3 text-[12px] text-muted-foreground">
            Claude will use its Gmail and Slack connectors automatically.
            No integration setup on this page is required.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
