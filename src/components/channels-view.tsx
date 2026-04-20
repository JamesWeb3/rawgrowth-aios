"use client";

import { useState } from "react";
import { ArrowUpRight, Info, Sparkles } from "lucide-react";
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
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IntegrationConnectionSheet } from "@/components/integration-connection-sheet";
import { useConnections } from "@/lib/connections/use-connections";

/**
 * Channels — things Rawclaw actually owns on the server:
 *   1. Inbound messaging surfaces (Telegram, WhatsApp, Slack bot)
 *   2. Read-only analytics sources that feed the Dashboard
 *
 * Everything else (Gmail, Drive, Notion, Linear, GitHub, etc.) runs
 * inside the client's Claude subscription via native connectors — not
 * here. The explainer up top reinforces that split so operators don't
 * go looking for an OAuth flow that doesn't exist.
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

const MESSAGING: MessagingChannel[] = [
  {
    id: "telegram",
    name: "Telegram",
    Icon: SiTelegram,
    brand: "#26A5E4",
    blurb: "Text your agents from your phone. Messages land in Rawclaw; Claude Code reads and replies.",
    tone: "primary",
    integrationId: "telegram",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    Icon: SiWhatsapp,
    brand: "#25D366",
    blurb: "Same inbox pattern as Telegram — message in, routine fires, reply goes out.",
    tone: "coming-soon",
  },
  {
    id: "slack-bot",
    name: "Slack (as a bot)",
    Icon: SiSlack,
    brand: "#4A154B",
    blurb: "A dedicated bot that lives in your workspace and hands messages to your agents.",
    tone: "coming-soon",
  },
];

type AnalyticsSource = {
  id: string;
  name: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  brand: string;
  metric: string;
  tone: ChannelTone;
};

const ANALYTICS: AnalyticsSource[] = [
  {
    id: "shopify",
    name: "Shopify",
    Icon: SiShopify,
    brand: "#95BF47",
    metric: "Revenue, orders, AOV",
    tone: "coming-soon",
  },
  {
    id: "stripe",
    name: "Stripe",
    Icon: SiStripe,
    brand: "#635BFF",
    metric: "MRR, churn, new customers",
    tone: "coming-soon",
  },
  {
    id: "ga4",
    name: "Google Analytics",
    Icon: SiGoogleanalytics,
    brand: "#E37400",
    metric: "Sessions, conversion, traffic sources",
    tone: "coming-soon",
  },
  {
    id: "mailchimp",
    name: "Mailchimp",
    Icon: SiMailchimp,
    brand: "#FFE01B",
    metric: "Email revenue, subscriber growth",
    tone: "coming-soon",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    Icon: SiHubspot,
    brand: "#FF7A59",
    metric: "Pipeline, deal velocity, lead volume",
    tone: "coming-soon",
  },
];

export function ChannelsView() {
  const { byIntegrationId } = useConnections();
  const [telegramOpen, setTelegramOpen] = useState(false);
  const telegramConn = byIntegrationId("telegram");
  const telegramDisplay =
    (telegramConn as { display_name?: string | null } | undefined)
      ?.display_name ?? null;

  return (
    <div className="space-y-10">
      {/* Explainer */}
      <Card className="border-border bg-card/40">
        <CardContent className="p-6">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-primary/10 text-primary">
              <Info className="size-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[14px] font-semibold text-foreground">
                Integrations live in your Claude subscription — not here
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                Your agents run inside Claude Code on your laptop, which
                already ships native connectors for the common tools —
                Gmail, Drive, Calendar, Slack, Notion, Linear, GitHub,
                Asana, Canva. Connect them once in Claude and every agent
                picks them up automatically.
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                Rawclaw owns the workspace — routines, runs, approvals, the
                org chart. This page is only for things Rawclaw itself
                needs to wire up: inbound messaging channels, and read-only
                data sources that feed your Dashboard.
              </p>
              <a
                href="https://claude.ai/settings/connectors"
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
              >
                Open Claude connector settings
                <ArrowUpRight className="size-3" />
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Messaging channels */}
      <section>
        <div className="mb-3">
          <h3 className="text-[13px] font-semibold text-foreground">
            Messaging channels
          </h3>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Let your agents receive messages from the outside world. Run{" "}
            <code>/rawgrowth-chat</code> in Claude Code to drain the inbox.
          </p>
        </div>

        {/* Telegram — live connection */}
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
                {telegramConn && (
                  <Badge
                    variant="secondary"
                    className="bg-primary/15 text-[10px] text-primary"
                  >
                    Connected
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                {telegramConn
                  ? `Active${telegramDisplay ? ` · ${telegramDisplay}` : ""}`
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

        {/* Coming-soon messaging channels */}
        <div className="grid gap-3 sm:grid-cols-2">
          {MESSAGING.filter((m) => m.tone === "coming-soon").map((m) => (
            <ComingSoonCard key={m.id} item={m} />
          ))}
        </div>
      </section>

      {/* Analytics sources */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h3 className="text-[13px] font-semibold text-foreground">
              Analytics sources for the Dashboard
            </h3>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Read-only connections that feed live business metrics into
              your Dashboard. Separate from Claude tools — these are for
              charts, not agent actions.
            </p>
          </div>
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

      <IntegrationConnectionSheet
        integrationId={telegramOpen ? "telegram" : null}
        open={telegramOpen}
        onOpenChange={setTelegramOpen}
      />
    </div>
  );
}

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
