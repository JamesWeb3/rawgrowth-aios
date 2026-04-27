/**
 * Static agent metadata. Not persisted — these are product-level choices
 * surfaced in the UI (role picker, runtime picker). Evolving these values
 * is a frontend change only; the `rgaios_agents.role` and `.runtime`
 * columns are just `text` in Postgres.
 */

export const AGENT_ROLES = [
  { value: "ceo", label: "CEO", icon: "Crown" },
  { value: "cto", label: "CTO", icon: "Cpu" },
  { value: "engineer", label: "Engineer", icon: "Code" },
  { value: "marketer", label: "Marketer", icon: "Megaphone" },
  { value: "sdr", label: "SDR", icon: "PhoneCall" },
  { value: "ops", label: "Ops Manager", icon: "ClipboardList" },
  { value: "designer", label: "Designer", icon: "Palette" },
  { value: "general", label: "General", icon: "Bot" },
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number]["value"];

export const AGENT_RUNTIMES = [
  {
    value: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "Anthropic",
  },
  { value: "claude-opus-4-7", label: "Claude Opus 4.7", provider: "Anthropic" },
  {
    value: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "Anthropic",
  },
  // Legacy: existing agents already on 4.5 keep working; not picked by default
  // for new hires anymore.
  {
    value: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5 (legacy)",
    provider: "Anthropic",
  },
  { value: "gpt-4.1", label: "GPT-4.1", provider: "OpenAI" },
  { value: "gpt-4o-mini", label: "GPT-4o mini", provider: "OpenAI" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "Google" },
] as const;

export const DEFAULT_AGENT_RUNTIME = "claude-sonnet-4-6";

export type AgentRuntime = (typeof AGENT_RUNTIMES)[number]["value"];

export const AGENT_STATUSES = ["idle", "running", "paused", "error"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];
