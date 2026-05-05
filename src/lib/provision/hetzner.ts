/**
 * Tiny Hetzner Cloud API client - mirrors the digitalocean.ts shape so
 * provision-tick can swap providers via a single env-var check. No SDK
 * to keep the bundle small.
 *
 * Auth: HETZNER_API_TOKEN env var, sent as `Authorization: Bearer ...`
 * (https://docs.hetzner.cloud/#authentication).
 *
 * Flow:
 *   createHetznerServer({ name, sshKeys, userData })
 *      -> { id, name }
 *   pollUntilActive(id)
 *      -> { id, ipv4, status }       // polls every 10s for up to 5min
 *
 * cloud-init user_data lets the server self-install Docker + clone
 * rawclaw + boot, so no SSH from us is needed (same flow as DO).
 */

const HETZNER_API_BASE = "https://api.hetzner.cloud/v1";

type Headers = { Authorization: string; "Content-Type": string };

function authHeaders(): Headers | null {
  const token = process.env.HETZNER_API_TOKEN;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export function isHetznerEnabled(): boolean {
  return Boolean(process.env.HETZNER_API_TOKEN);
}

type HetznerServerInput = {
  name: string;
  image?: string;
  server_type?: string;
  location?: string;
  ssh_keys?: Array<number | string>;
  user_data?: string;
  labels?: Record<string, string>;
};

// Hetzner exposes a richer status set than DO; we keep it as the literal
// union the API returns so the consumer can switch on "running" the same
// way the DO path switches on "active".
export type HetznerServerStatus =
  | "initializing"
  | "starting"
  | "running"
  | "stopping"
  | "off"
  | "deleting"
  | "migrating"
  | "rebuilding"
  | "unknown";

export type HetznerServerInfo = {
  id: number;
  name: string;
  status: HetznerServerStatus;
  ipv4: string | null;
};

type HetznerServerPayload = {
  id: number;
  name: string;
  status: HetznerServerStatus;
  public_net?: {
    ipv4?: { ip?: string | null } | null;
  } | null;
};

function extractIp(server: HetznerServerPayload): string | null {
  return server.public_net?.ipv4?.ip ?? null;
}

export async function createHetznerServer(input: HetznerServerInput): Promise<{
  id: number;
  name: string;
}> {
  const headers = authHeaders();
  if (!headers) throw new Error("HETZNER_API_TOKEN not set");

  const body = {
    name: input.name,
    image: input.image ?? "ubuntu-22.04",
    server_type: input.server_type ?? "cx22",
    location: input.location ?? "nbg1",
    ssh_keys: input.ssh_keys ?? [],
    user_data: input.user_data,
    labels: input.labels ?? { rawclaw: "true" },
    start_after_create: true,
  };

  const res = await fetch(`${HETZNER_API_BASE}/servers`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Hetzner createServer ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { server?: HetznerServerPayload };
  if (!data.server) throw new Error("Hetzner createServer returned no server");
  return { id: data.server.id, name: data.server.name };
}

export async function getHetznerServer(id: number): Promise<HetznerServerInfo> {
  const headers = authHeaders();
  if (!headers) throw new Error("HETZNER_API_TOKEN not set");
  const res = await fetch(`${HETZNER_API_BASE}/servers/${id}`, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Hetzner getServer ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { server?: HetznerServerPayload };
  if (!data.server) throw new Error("Hetzner getServer returned no server");
  return {
    id: data.server.id,
    name: data.server.name,
    status: data.server.status,
    ipv4: extractIp(data.server),
  };
}

/**
 * Poll until server is `running` AND has a public IPv4. Default 5min
 * cap; Hetzner usually flips running in 30-60s. Returns HetznerServerInfo
 * on success, throws on timeout. Mirrors digitalocean.pollUntilActive.
 */
export async function pollUntilActive(
  id: number,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<HetznerServerInfo> {
  const timeout = opts.timeoutMs ?? 5 * 60 * 1000;
  const interval = opts.intervalMs ?? 10_000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const info = await getHetznerServer(id);
    if (info.status === "running" && info.ipv4) return info;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Hetzner pollUntilActive timeout after ${timeout}ms`);
}
