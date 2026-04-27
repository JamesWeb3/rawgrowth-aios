import type { ComponentType, CSSProperties } from "react";
import {
  SiGmail,
  SiGooglecalendar,
  SiGoogledrive,
  SiSlack,
  SiNotion,
  SiLinear,
  SiGithub,
  SiAsana,
  SiCanva,
  SiShopify,
  SiStripe,
  SiHubspot,
  SiTelegram,
} from "react-icons/si";

/**
 * Known connectors the client's Claude Code can reach. In self-hosted
 * mode we don't OAuth into these  -  the client authorizes them once inside
 * Claude Desktop / Claude Code native connector settings or installs a
 * community MCP server. Rawclaw just tracks which connectors each agent
 * is *expected* to use so the UI can render logos and routines can
 * reference them.
 */

export type ConnectorDef = {
  id: string;
  label: string;
  native: boolean; // Anthropic native connector in Claude Desktop/Code
  Icon: ComponentType<{ className?: string; style?: CSSProperties }>;
  brand: string;
};

export const CONNECTORS: ConnectorDef[] = [
  // Anthropic native connectors (auth in Claude settings)
  { id: "gmail", label: "Gmail", native: true, Icon: SiGmail, brand: "#EA4335" },
  {
    id: "google-calendar",
    label: "Google Calendar",
    native: true,
    Icon: SiGooglecalendar,
    brand: "#4285F4",
  },
  {
    id: "google-drive",
    label: "Google Drive",
    native: true,
    Icon: SiGoogledrive,
    brand: "#4285F4",
  },
  { id: "slack", label: "Slack", native: true, Icon: SiSlack, brand: "#4A154B" },
  { id: "notion", label: "Notion", native: true, Icon: SiNotion, brand: "#FFFFFF" },
  { id: "linear", label: "Linear", native: true, Icon: SiLinear, brand: "#5E6AD2" },
  { id: "github", label: "GitHub", native: true, Icon: SiGithub, brand: "#FFFFFF" },
  { id: "asana", label: "Asana", native: true, Icon: SiAsana, brand: "#F06A6A" },
  { id: "canva", label: "Canva", native: true, Icon: SiCanva, brand: "#00C4CC" },

  // Community MCP servers (the client installs these themselves)
  { id: "shopify", label: "Shopify", native: false, Icon: SiShopify, brand: "#96BF48" },
  { id: "stripe", label: "Stripe", native: false, Icon: SiStripe, brand: "#635BFF" },
  { id: "hubspot", label: "HubSpot", native: false, Icon: SiHubspot, brand: "#FF7A59" },
  {
    id: "telegram",
    label: "Telegram",
    native: false,
    Icon: SiTelegram,
    brand: "#26A5E4",
  },
];

export function getConnector(id: string): ConnectorDef | undefined {
  return CONNECTORS.find((c) => c.id === id);
}
