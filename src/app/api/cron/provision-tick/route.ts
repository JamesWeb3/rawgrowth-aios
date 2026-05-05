import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase/server";
import {
  createDroplet,
  getDroplet,
  isDigitalOceanEnabled,
  buildCloudInit,
} from "@/lib/provision/digitalocean";
import {
  createHetznerServer,
  getHetznerServer,
  isHetznerEnabled,
} from "@/lib/provision/hetzner";
import { upsertA, isCloudflareEnabled } from "@/lib/provision/cloudflare";
import { sendWelcomeEmail } from "@/lib/auth/email";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/provision-tick
 *
 * Picks up pending rgaios_provisioning_queue rows (no SHARED_VPS_HOST
 * shortcut active) and drives them through the per-tenant lifecycle:
 *
 *   pending → provisioning (droplet just created) → ready (active+ipv4)
 *
 * State-machine per row, idempotent. Auth: same Bearer ${CRON_SECRET}
 * convention as the other /api/cron routes.
 *
 * Skipped silently if DO_API_TOKEN unset (operator hasn't enabled the
 * per-tenant path yet) or if SHARED_VPS_HOST is set (the trial
 * shortcut already moved everyone to ready inside the stripe webhook).
 */
const PROCESS_LIMIT = 5;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  // Provider preference: Hetzner if its token is set, else DigitalOcean.
  // Hetzner takes precedence so an operator flipping HETZNER_API_TOKEN on
  // an instance that still has DO_API_TOKEN configured cuts straight over
  // without needing to unset the old token.
  const useHetzner = isHetznerEnabled();
  if (!useHetzner && !isDigitalOceanEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: "no provider token (HETZNER_API_TOKEN or DO_API_TOKEN) set",
    });
  }
  if (process.env.SHARED_VPS_HOST?.trim()) {
    return NextResponse.json({ ok: true, skipped: "shared_vps mode" });
  }

  const db = supabaseAdmin();
  const { data: rows } = await db
    .from("rgaios_provisioning_queue")
    .select(
      "id, owner_email, owner_name, plan_name, organization_id, status, metadata",
    )
    .in("status", ["pending", "provisioning"])
    .order("created_at", { ascending: true })
    .limit(PROCESS_LIMIT);

  type Row = {
    id: string;
    owner_email: string | null;
    owner_name: string | null;
    plan_name: string | null;
    organization_id: string | null;
    status: string;
    metadata: Record<string, unknown> | null;
  };
  const queueRows = (rows ?? []) as Row[];

  const results: Array<{
    id: string;
    transitioned: string;
    detail?: string;
  }> = [];

  for (const row of queueRows) {
    try {
      const meta = (row.metadata ?? {}) as {
        droplet_id?: number;
        domain?: string;
        temp_password?: string;
        provider?: "hetzner" | "digitalocean";
      };

      // ── pending -> provisioning ──
      if (row.status === "pending" && !meta.droplet_id) {
        const subdomain = (row.owner_email ?? "client")
          .split("@")[0]
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-")
          .slice(0, 30);
        const baseDomain =
          process.env.PROVISION_BASE_DOMAIN ?? "rawgrowth.app";
        const fullDomain = `${subdomain}-${row.id.slice(0, 6)}.${baseDomain}`;
        const orgId = row.organization_id ?? "";

        // Pull supabase + ownership params we need to bake into the
        // droplet's cloud-init. Service-role key here is the same
        // one this control-plane uses; the per-tenant droplet
        // operates against the same shared Supabase per AGENTS.md.
        const supabaseUrl =
          process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
        const supabaseAnon =
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
        const supabaseService =
          process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
        if (!supabaseUrl || !supabaseAnon || !supabaseService) {
          throw new Error("Supabase env vars missing for cloud-init");
        }

        // Fetch the org's MCP token so the droplet can serve the
        // workspace's MCP endpoint correctly out of the box.
        let mcpToken = "";
        if (orgId) {
          const { data: org } = await db
            .from("rgaios_organizations")
            .select("mcp_token")
            .eq("id", orgId)
            .maybeSingle();
          mcpToken =
            (org as { mcp_token: string | null } | null)?.mcp_token ?? "";
        }

        const userData = buildCloudInit({
          domain: fullDomain,
          ownerEmail: row.owner_email ?? "unknown@example.com",
          organizationName:
            row.owner_name ?? row.plan_name ?? "Rawgrowth Workspace",
          supabaseUrl,
          supabaseServiceKey: supabaseService,
          supabaseAnonKey: supabaseAnon,
          mcpToken,
          cronSecret:
            process.env.PROVISIONED_TENANT_CRON_SECRET ??
            crypto.randomBytes(24).toString("base64url"),
          nextauthSecret: crypto.randomBytes(32).toString("base64url"),
          encryptionKey:
            process.env.RAWCLAW_ENCRYPTION_KEY ??
            crypto.randomBytes(32).toString("base64url"),
        });

        const serverName = `rawclaw-${subdomain}-${row.id.slice(0, 6)}`;

        // The provider abstraction stops at this branch. Both clients
        // return { id, name } and we stash the id under `droplet_id` for
        // historical reasons (queue rows in flight still use that key).
        // `provider` discriminates which client to call on the next tick.
        let serverId: number;
        let serverDisplay: string;
        let provider: "hetzner" | "digitalocean";
        if (useHetzner) {
          const sshKeysRaw = (process.env.HETZNER_SSH_KEY_IDS ?? "").split(",");
          const sshKeys: Array<number | string> = sshKeysRaw
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
            .map((s) => {
              const n = Number(s);
              return Number.isFinite(n) && n > 0 ? n : s;
            });

          const server = await createHetznerServer({
            name: serverName,
            location: process.env.HETZNER_LOCATION ?? "nbg1",
            server_type: process.env.HETZNER_SERVER_TYPE ?? "cx22",
            image: process.env.HETZNER_IMAGE ?? "ubuntu-22.04",
            ssh_keys: sshKeys,
            user_data: userData,
            labels: { rawclaw: "true", org: orgId.slice(0, 8) },
          });
          serverId = server.id;
          serverDisplay = server.name;
          provider = "hetzner";
        } else {
          const sshKeyIds = (process.env.DO_SSH_KEY_IDS ?? "")
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isFinite(n) && n > 0);

          const droplet = await createDroplet({
            name: serverName,
            region: process.env.DO_REGION ?? "nyc3",
            size: process.env.DO_SIZE ?? "s-2vcpu-4gb",
            sshKeys: sshKeyIds,
            userData,
            tags: ["rawclaw", `org:${orgId.slice(0, 8)}`],
          });
          serverId = droplet.id;
          serverDisplay = droplet.name;
          provider = "digitalocean";
        }

        const newMeta = {
          ...meta,
          droplet_id: serverId,
          droplet_name: serverDisplay,
          domain: fullDomain,
          provider,
        };
        await db
          .from("rgaios_provisioning_queue")
          .update({
            status: "provisioning",
            metadata: newMeta,
          } as never)
          .eq("id", row.id);
        results.push({
          id: row.id,
          transitioned: "pending->provisioning",
          detail: `${provider} ${serverId} ${fullDomain}`,
        });
        continue;
      }

      // ── provisioning -> ready ──
      if (
        row.status === "provisioning" &&
        typeof meta.droplet_id === "number" &&
        typeof meta.domain === "string"
      ) {
        // Rows queued before the Hetzner switch lack `provider` and were
        // always created on DO, so default to that.
        const rowProvider = meta.provider ?? "digitalocean";
        let ipv4: string | null;
        let liveStatus: string;
        if (rowProvider === "hetzner") {
          const info = await getHetznerServer(meta.droplet_id);
          ipv4 = info.ipv4;
          liveStatus = info.status;
          if (info.status !== "running" || !info.ipv4) {
            results.push({
              id: row.id,
              transitioned: "still_provisioning",
              detail: `${info.status} ip=${info.ipv4 ?? "none"}`,
            });
            continue;
          }
        } else {
          const info = await getDroplet(meta.droplet_id);
          ipv4 = info.ipv4;
          liveStatus = info.status;
          if (info.status !== "active" || !info.ipv4) {
            results.push({
              id: row.id,
              transitioned: "still_provisioning",
              detail: `${info.status} ip=${info.ipv4 ?? "none"}`,
            });
            continue;
          }
        }
        // After the early-continue above, both branches guarantee a
        // non-null ipv4 - re-narrow for the rest of the block.
        if (!ipv4) {
          results.push({
            id: row.id,
            transitioned: "still_provisioning",
            detail: `${liveStatus} ip=none`,
          });
          continue;
        }

        // DNS: point fullDomain at the droplet IP via Cloudflare so
        // Caddy on the droplet can issue ACME certs on first request.
        // Skip silently if CLOUDFLARE_API_TOKEN unset (operator manages
        // DNS by hand or via wildcard).
        if (isCloudflareEnabled()) {
          const baseDomain =
            process.env.PROVISION_BASE_DOMAIN ?? "rawgrowth.app";
          const dns = await upsertA({
            fullDomain: meta.domain,
            ipv4,
            zoneApex: baseDomain,
          });
          if (!dns.ok) {
            console.warn(
              `[provision-tick] DNS upsert failed for ${meta.domain}: ${dns.error}`,
            );
          }
        }

        const dashboardUrl = `https://${meta.domain}/auth/signin`;
        await db
          .from("rgaios_provisioning_queue")
          .update({
            status: "ready",
            vps_host: meta.domain,
            vps_url: `https://${meta.domain}`,
            dashboard_url: dashboardUrl,
          } as never)
          .eq("id", row.id);

        // Send welcome email now that the dashboard URL is live
        if (row.owner_email && meta.temp_password) {
          try {
            await sendWelcomeEmail({
              to: row.owner_email,
              dashboardUrl,
              tempPassword: meta.temp_password,
              organizationName:
                row.owner_name ?? row.plan_name ?? "your workspace",
            });
          } catch (err) {
            console.error(
              `[provision-tick] welcome email failed: ${(err as Error).message}`,
            );
          }
        }

        await db.from("rgaios_audit_log").insert({
          organization_id: row.organization_id,
          kind: "vps_provisioned",
          actor_type: "system",
          actor_id: "provision-tick",
          detail: { domain: meta.domain, droplet_id: meta.droplet_id },
        } as never);

        results.push({
          id: row.id,
          transitioned: "provisioning->ready",
          detail: `${meta.domain} ${ipv4}`,
        });
        continue;
      }
    } catch (err) {
      const msg = (err as Error).message;
      console.error(
        `[provision-tick] row ${row.id} failed: ${msg}`,
      );
      await db
        .from("rgaios_provisioning_queue")
        .update({ status: "error", error: msg } as never)
        .eq("id", row.id);
      results.push({
        id: row.id,
        transitioned: "->error",
        detail: msg.slice(0, 200),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: queueRows.length,
    results,
  });
}
