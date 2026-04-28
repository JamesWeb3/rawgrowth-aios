"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import {
  SiTelegram,
  SiSlack,
  SiWhatsapp,
  SiShopify,
  SiStripe,
  SiGoogleanalytics,
  SiHubspot,
  SiMailchimp,
} from "react-icons/si";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClaudeConnectionCard } from "@/components/connections/claude-card";
import { SlackConnectionCard } from "@/components/connections/slack-card";
import { WorkspaceToolsSection } from "@/components/connections/workspace-tools-section";
import { CreateClientSheet } from "@/components/admin/create-client-sheet";
import { jsonFetcher } from "@/lib/swr";

/**
 * Connections — every external link this workspace owns:
 *
 *   1. Claude Max          (powers the VPS-side 24/7 agent runtime)
 *   2. Rawgrowth MCP       (URL + bearer for Claude Desktop / Cursor / Code)
 *   3. Messaging channels  (Telegram live, WhatsApp / Slack soon)
 *   4. Analytics sources   (Shopify / Stripe / GA4 etc — coming soon)
 */

type ChannelTone = "primary" | "coming-soon";

type MessagingChannel = {
  id: string;
  name: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  brand: string;
  blurb: string;
  tone: ChannelTone;
  integrationId?: string;
};

const COMING_SOON_MESSAGING: MessagingChannel[] = [
  {
    id: "whatsapp",
    name: "WhatsApp",
    Icon: SiWhatsapp,
    brand: "#25D366",
    blurb: "Same inbox pattern as Telegram — message in, routine fires, reply goes out.",
    tone: "coming-soon",
  },
];

type AnalyticsSource = {
  id: string;
  name: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  brand: string;
  metric: string;
};

const ANALYTICS: AnalyticsSource[] = [
  { id: "shopify", name: "Shopify", Icon: SiShopify, brand: "#95BF47", metric: "Revenue, orders, AOV" },
  { id: "stripe", name: "Stripe", Icon: SiStripe, brand: "#635BFF", metric: "MRR, churn, new customers" },
  { id: "ga4", name: "Google Analytics", Icon: SiGoogleanalytics, brand: "#E37400", metric: "Sessions, conversion, traffic sources" },
  { id: "mailchimp", name: "Mailchimp", Icon: SiMailchimp, brand: "#FFE01B", metric: "Email revenue, subscriber growth" },
  { id: "hubspot", name: "HubSpot", Icon: SiHubspot, brand: "#FF7A59", metric: "Pipeline, deal velocity, lead volume" },
];

type OrgMe = {
  org: {
    id: string;
    name: string;
    slug: string;
    mcp_token: string | null;
    created_at: string;
  };
  isAdmin: boolean;
  isImpersonating: boolean;
};

export function ConnectionsView() {
  // Telegram is no longer org-level — it's per-Department-Head, configured
  // inside each agent's edit sheet. The card on this page is a summary.
  return (
    <div className="space-y-10">
      {/* 1. Claude Max */}
      <section>
        <SectionHeading
          title="Claude Max"
          subtitle="Your subscription powering the VPS-side agents (24/7 Telegram + scheduled routines)."
        />
        <ClaudeConnectionCard />
      </section>

      {/* 2. Rawgrowth MCP */}
      <section>
        <SectionHeading
          title="Rawgrowth MCP"
          subtitle="Connect Claude Desktop, Cursor, or Claude Code to this workspace."
        />
        <McpCard />
      </section>

      {/* 3. Workspace tools (Nango-backed) */}
      <section>
        <SectionHeading
          title="Workspace tools"
          subtitle="OAuth into the SaaS your agents need to act on. Once connected, agents can call these tools from Telegram, Slack, or routines."
        />
        <WorkspaceToolsSection />
      </section>

      {/* 4. Messaging channels */}
      <section>
        <SectionHeading
          title="Messaging channels"
          subtitle="Where your agents listen for inbound messages from the outside world."
        />

        <DepartmentHeadTelegramCard />

        <div className="mb-3">
          <SlackConnectionCard />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {COMING_SOON_MESSAGING.map((m) => (
            <ComingSoonCard key={m.id} item={m} />
          ))}
        </div>
      </section>

      {/* 4. Analytics sources */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <SectionHeading
            title="Analytics sources"
            subtitle="Read-only feeds for the Dashboard. Separate from agent tools — these are for charts."
            inline
          />
          <Badge
            variant="secondary"
            className="bg-white/5 text-[10px] text-muted-foreground"
          >
            <Sparkles className="mr-1 size-3" />
            Coming soon
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ANALYTICS.map((a) => (
            <AnalyticsCard key={a.id} item={a} />
          ))}
        </div>
      </section>

    </div>
  );
}

// ─── Section heading ─────────────────────────────────────────────

function SectionHeading({
  title,
  subtitle,
  inline,
}: {
  title: string;
  subtitle?: string;
  inline?: boolean;
}) {
  return (
    <div className={inline ? undefined : "mb-3"}>
      <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
      {subtitle && (
        <p className="mt-1 text-[12px] text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}

// ─── MCP card (merged from /settings/mcp) ───────────────────────

function McpCard() {
  const { data, isLoading, mutate } = useSWR<OrgMe>(
    "/api/org/me",
    jsonFetcher,
  );
  const [rotating, setRotating] = useState(false);
  const [creating, setCreating] = useState(false);

  const org = data?.org;
  const isAdmin = data?.isAdmin ?? false;

  const rotate = async () => {
    if (!org) return;
    if (
      !confirm(
        `Rotate the MCP token for ${org.name}?\n\nThe old token stops working immediately — any Claude Desktop / Cursor config still using it will lose access until you paste in the new one.`,
      )
    )
      return;
    setRotating(true);
    try {
      const res = await fetch(`/api/admin/clients/${org.id}/rotate-token`, {
        method: "POST",
      });
      if (!res.ok) {
        const { error } = (await res.json()) as { error?: string };
        throw new Error(error ?? "rotate failed");
      }
      toast.success("Token rotated");
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRotating(false);
    }
  };

  if (isLoading || !org) {
    return <Card className="h-72 animate-pulse border-border bg-card/30" />;
  }

  const mcpUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/mcp`
      : "https://…/api/mcp";

  const configJson = `{
  "mcpServers": {
    "rawgrowth-${org.slug}": {
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer ${org.mcp_token ?? "<token>"}"
      }
    }
  }
}`;

  return (
    <>
      {isAdmin && (
        <div className="mb-3 flex items-center justify-end">
          <Button
            onClick={() => setCreating(true)}
            size="sm"
            className="btn-shine bg-primary text-white hover:bg-primary/90"
          >
            <Plus className="size-3.5" />
            New client
          </Button>
        </div>
      )}

      <Card className="border-border bg-card/50">
        <CardContent className="space-y-5 p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-serif text-lg leading-none text-foreground">
                  {org.name}
                </span>
                <Badge
                  variant="secondary"
                  className="bg-white/5 font-mono text-[10px] text-muted-foreground"
                >
                  /{org.slug}
                </Badge>
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Paste the config below into any MCP-compatible client to
                give it read/write access to this workspace.
              </p>
            </div>
            <button
              type="button"
              onClick={rotate}
              disabled={rotating}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw
                className={rotating ? "size-3 animate-spin" : "size-3"}
              />
              Rotate token
            </button>
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <KeyRound className="size-3" />
              Claude Desktop / Cursor config snippet
            </div>
            <CopyBlock value={configJson} />
            <p className="mt-2 text-[11px] text-muted-foreground">
              Paste into{" "}
              <code className="font-mono text-foreground/80">
                ~/Library/Application Support/Claude/claude_desktop_config.json
              </code>{" "}
              (Claude Desktop) or the equivalent MCP config file for your
              client, then fully restart the app.
            </p>
          </div>
        </CardContent>
      </Card>

      {isAdmin && (
        <CreateClientSheet
          open={creating}
          onOpenChange={setCreating}
          onCreated={() => mutate()}
        />
      )}
    </>
  );
}

// ─── Department-Head Telegram bots card ───────────────────────────

type AgentBotRow = {
  id: string;
  agent_id: string;
  bot_username: string | null;
  bot_first_name: string | null;
  rgaios_agents?: {
    id: string;
    name: string;
    title: string | null;
    department: string | null;
  } | null;
};

function DepartmentHeadTelegramCard() {
  const { data, isLoading } = useSWR<{ bots: AgentBotRow[] }>(
    "/api/connections/agent-telegram",
    jsonFetcher,
    { refreshInterval: 30_000 },
  );
  const bots = data?.bots ?? [];

  return (
    <Card className="mb-3 border-border bg-card/50">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border"
              style={{ backgroundColor: "rgba(38, 165, 228, 0.12)" }}
            >
              <SiTelegram className="size-5" style={{ color: "#26A5E4" }} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold text-foreground">
                  Telegram bots
                </h3>
                {bots.length > 0 ? (
                  <Badge
                    variant="secondary"
                    className="bg-primary/15 text-[10px] text-primary"
                  >
                    {bots.length} connected
                  </Badge>
                ) : (
                  <Badge
                    variant="secondary"
                    className="bg-amber-500/10 text-[10px] text-amber-400"
                  >
                    No bots yet
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                One Telegram bot per Department Head. DMs route to that head
                as the persona.
              </p>
            </div>
          </div>
          <a
            href="/agents"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-white/5"
          >
            Manage in agents
          </a>
        </div>

        {isLoading ? (
          <div className="text-[12px] text-muted-foreground">Loading…</div>
        ) : bots.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-background/30 px-3 py-3 text-[12px] text-muted-foreground">
            Mark an agent as a Department Head in the Agents page → open the
            agent → Telegram bot section. Each head can have one bot.
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border bg-background/30">
            {bots.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5 text-[12.5px]"
              >
                <div className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-primary shadow-[0_0_6px_rgba(12,191,106,.6)]" />
                  <span className="font-medium text-foreground">
                    {b.bot_username ? `@${b.bot_username}` : b.bot_first_name ?? "Bot"}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-foreground">
                    {b.rgaios_agents?.name ?? "(unknown agent)"}
                  </span>
                  {b.rgaios_agents?.department && (
                    <Badge
                      variant="secondary"
                      className="ml-1 bg-white/5 text-[10px] text-muted-foreground"
                    >
                      {b.rgaios_agents.department}
                    </Badge>
                  )}
                </div>
                {b.rgaios_agents?.id && (
                  <a
                    href={`/agents`}
                    className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Edit
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── (Legacy) org-level Telegram card — kept for reference, no longer rendered ─

type TelegramStats = {
  connected: boolean;
  bot_id?: number | null;
  bot_username?: string | null;
  last_inbound_at?: string | null;
  messages_today?: number;
};

function TelegramCard({
  connected,
  displayName,
  onOpen,
}: {
  connected: boolean;
  displayName: string | null;
  onOpen: () => void;
}) {
  const { data: stats } = useSWR<TelegramStats>(
    connected ? "/api/connections/telegram/stats" : null,
    jsonFetcher,
    { refreshInterval: 30_000 },
  );

  const botId = stats?.bot_id ?? null;
  const preview = botId ? `${botId}:${"•".repeat(20)}` : null;

  return (
    <Card className="mb-3 border-border bg-card/50">
      <CardContent className="flex items-center gap-4 p-4">
        <div
          className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border"
          style={{ backgroundColor: "#26A5E41a" }}
        >
          <SiTelegram className="size-6" style={{ color: "#26A5E4" }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-foreground">
              Telegram
            </span>
            {connected && (
              <Badge
                variant="secondary"
                className="bg-primary/15 text-[10px] text-primary"
              >
                Connected
              </Badge>
            )}
          </div>
          {connected ? (
            <div className="mt-1 space-y-1">
              <div className="text-[11.5px] text-muted-foreground">
                {displayName ?? "Active"}
                {typeof stats?.messages_today === "number" && (
                  <span className="ml-2 text-muted-foreground/70">
                    · {stats.messages_today} message
                    {stats.messages_today === 1 ? "" : "s"} today
                  </span>
                )}
              </div>
              {preview && (
                <code className="block truncate rounded border border-border bg-background/40 px-2 py-1 font-mono text-[11px] text-foreground/80">
                  {preview}
                </code>
              )}
            </div>
          ) : (
            <div className="mt-0.5 text-[11.5px] text-muted-foreground">
              Not connected — click to set up a bot token
            </div>
          )}
        </div>
        {connected ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={onOpen}
            className="bg-white/5 text-foreground hover:bg-white/10"
          >
            Manage
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onOpen}
            className="btn-shine bg-primary text-white hover:bg-primary/90"
          >
            Connect
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Coming-soon messaging card ────────────────────────────────

function ComingSoonCard({ item }: { item: MessagingChannel }) {
  return (
    <Card className="border-border bg-card/30">
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border"
          style={{ backgroundColor: `${item.brand}1a` }}
        >
          <item.Icon
            className="size-5"
            style={{ color: item.brand === "#000000" ? "#fff" : item.brand }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-foreground">
              {item.name}
            </span>
            <Badge
              variant="secondary"
              className="bg-white/5 text-[10px] text-muted-foreground"
            >
              Soon
            </Badge>
          </div>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
            {item.blurb}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Analytics card ────────────────────────────────────────────

function AnalyticsCard({ item }: { item: AnalyticsSource }) {
  return (
    <Card className="border-border bg-card/30">
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border"
          style={{ backgroundColor: `${item.brand}1a` }}
        >
          <item.Icon
            className="size-5"
            style={{ color: item.brand === "#000000" ? "#fff" : item.brand }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-foreground">
              {item.name}
            </span>
            <Badge
              variant="secondary"
              className="bg-white/5 text-[10px] text-muted-foreground"
            >
              Soon
            </Badge>
          </div>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {item.metric}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Copyable code block ───────────────────────────────────────

function CopyBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Config copied");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-border bg-background/40 p-3 font-mono text-[11.5px] leading-relaxed text-foreground/85">
        {value}
      </pre>
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </div>
  );
}
