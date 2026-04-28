import { registerTool, text, textError } from "../registry";
import {
  applyMigration,
  createProject,
  getProject,
  listOrganizations,
  listProjects,
  loadSupabasePat,
  runSql,
  SupabaseMgmtError,
} from "@/lib/supabase-mgmt/client";

/**
 * Supabase Management API tools  -  full automation surface for agents:
 * provision projects, run migrations, query existing DBs.
 *
 * Auth: one PAT per org (rgaios_connections row, provider_config_key='supabase').
 * The PAT covers every Supabase project the connecting user can access, so
 * each tool that targets a specific DB takes `project_ref`.
 */

async function getPat(orgId: string): Promise<string | null> {
  return loadSupabasePat(orgId);
}

function renderError(err: unknown): ReturnType<typeof textError> {
  if (err instanceof SupabaseMgmtError) {
    return textError(`Supabase ${err.status}: ${err.body.slice(0, 400)}`);
  }
  return textError(`Supabase call failed: ${(err as Error).message}`);
}

// ─── Read ──────────────────────────────────────────────────────────

registerTool({
  name: "supabase_list_organizations",
  description:
    "List every Supabase organization the connected PAT can access. Use to find an organization_id before creating a new project.",
  requiresIntegration: "supabase",
  inputSchema: { type: "object", properties: {} },
  handler: async (_args, ctx) => {
    const pat = await getPat(ctx.organizationId);
    if (!pat) return textError("Supabase PAT not connected.");
    try {
      const orgs = await listOrganizations(pat);
      return text(JSON.stringify(orgs, null, 2));
    } catch (err) {
      return renderError(err);
    }
  },
});

registerTool({
  name: "supabase_list_projects",
  description:
    "List every Supabase project the PAT can see (across all organizations). Returns id (project_ref), name, region, status, organization_id.",
  requiresIntegration: "supabase",
  inputSchema: { type: "object", properties: {} },
  handler: async (_args, ctx) => {
    const pat = await getPat(ctx.organizationId);
    if (!pat) return textError("Supabase PAT not connected.");
    try {
      const projects = await listProjects(pat);
      return text(JSON.stringify(projects, null, 2));
    } catch (err) {
      return renderError(err);
    }
  },
});

// ─── Write ─────────────────────────────────────────────────────────

registerTool({
  name: "supabase_create_project",
  description:
    "Provision a brand-new Supabase project (= new Postgres DB). Required: organization_id (from supabase_list_organizations), name, region (e.g. 'us-east-1', 'eu-west-1'), db_pass (strong DB password the agent generates).",
  requiresIntegration: "supabase",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      organization_id: { type: "string" },
      name: { type: "string" },
      region: {
        type: "string",
        description: "AWS region slug, e.g. us-east-1, eu-west-1, ap-southeast-1.",
      },
      db_pass: {
        type: "string",
        description:
          "Strong random password for the postgres role. Generate at least 24 chars.",
      },
    },
    required: ["organization_id", "name", "region", "db_pass"],
  },
  handler: async (args, ctx) => {
    const pat = await getPat(ctx.organizationId);
    if (!pat) return textError("Supabase PAT not connected.");
    const organization_id = String(args.organization_id ?? "").trim();
    const name = String(args.name ?? "").trim();
    const region = String(args.region ?? "").trim();
    const db_pass = String(args.db_pass ?? "").trim();
    if (!organization_id || !name || !region || !db_pass) {
      return textError(
        "organization_id, name, region, and db_pass are all required.",
      );
    }
    try {
      const project = await createProject(pat, {
        organization_id,
        name,
        region,
        db_pass,
      });
      return text(
        `Created project ${project.name} (ref: ${project.id}, region: ${project.region}, status: ${project.status}). It can take 1-2 minutes before the DB accepts queries.`,
      );
    } catch (err) {
      return renderError(err);
    }
  },
});

registerTool({
  name: "supabase_wait_for_project",
  description:
    "Poll a Supabase project until its database is ready to accept queries (status ACTIVE_HEALTHY). Newly-created projects need 60-120s to come up. Call this immediately after supabase_create_project before issuing any SQL.",
  requiresIntegration: "supabase",
  inputSchema: {
    type: "object",
    properties: {
      project_ref: { type: "string" },
      timeout_seconds: {
        type: "number",
        description: "Max seconds to wait. Default 180, max 300.",
      },
    },
    required: ["project_ref"],
  },
  handler: async (args, ctx) => {
    const pat = await getPat(ctx.organizationId);
    if (!pat) return textError("Supabase PAT not connected.");
    const project_ref = String(args.project_ref ?? "").trim();
    if (!project_ref) return textError("project_ref is required.");
    const timeoutMs =
      Math.min(Math.max(Number(args.timeout_seconds ?? 180) || 180, 10), 300) *
      1000;

    const start = Date.now();
    let lastStatus = "";
    while (Date.now() - start < timeoutMs) {
      try {
        const proj = await getProject(pat, project_ref);
        lastStatus = proj.status;
        if (proj.status === "ACTIVE_HEALTHY") {
          const elapsed = Math.round((Date.now() - start) / 1000);
          return text(
            `Project ${proj.name} (${project_ref}) is ACTIVE_HEALTHY after ${elapsed}s. Safe to run SQL.`,
          );
        }
      } catch (err) {
        if (!(err instanceof SupabaseMgmtError) || err.status !== 404) {
          return renderError(err);
        }
        // 404 right after create can happen briefly  -  keep polling.
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }
    return textError(
      `Project ${project_ref} not ready within ${timeoutMs / 1000}s (last status: ${lastStatus || "unknown"}).`,
    );
  },
});

registerTool({
  name: "supabase_run_sql",
  description:
    "Run arbitrary SQL against a Supabase project's Postgres DB. Returns rows. Use for SELECT, ad-hoc DDL, or one-off updates. For tracked schema changes prefer supabase_apply_migration.",
  requiresIntegration: "supabase",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      project_ref: {
        type: "string",
        description:
          "The project's ref (e.g. 'abcdefghijklmno'). Get from supabase_list_projects.",
      },
      query: { type: "string", description: "Raw SQL to execute." },
    },
    required: ["project_ref", "query"],
  },
  handler: async (args, ctx) => {
    const pat = await getPat(ctx.organizationId);
    if (!pat) return textError("Supabase PAT not connected.");
    const project_ref = String(args.project_ref ?? "").trim();
    const query = String(args.query ?? "").trim();
    if (!project_ref || !query) {
      return textError("project_ref and query are required.");
    }
    try {
      const rows = await runSql(pat, project_ref, query);
      return text(
        rows.length === 0
          ? "Query OK (no rows returned)."
          : JSON.stringify(rows, null, 2),
      );
    } catch (err) {
      return renderError(err);
    }
  },
});

registerTool({
  name: "supabase_apply_migration",
  description:
    "Apply a NAMED, versioned migration to a Supabase project  -  appears in the migrations history alongside any made via the Supabase CLI. Use this for CREATE TABLE, ALTER TABLE, RLS policies, and other schema changes that should be tracked.",
  requiresIntegration: "supabase",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      project_ref: { type: "string" },
      name: {
        type: "string",
        description:
          "Snake-case migration name, e.g. 'create_users_table' or 'add_rls_to_orders'.",
      },
      query: { type: "string", description: "SQL body of the migration." },
    },
    required: ["project_ref", "name", "query"],
  },
  handler: async (args, ctx) => {
    const pat = await getPat(ctx.organizationId);
    if (!pat) return textError("Supabase PAT not connected.");
    const project_ref = String(args.project_ref ?? "").trim();
    const name = String(args.name ?? "").trim();
    const query = String(args.query ?? "").trim();
    if (!project_ref || !name || !query) {
      return textError("project_ref, name, and query are required.");
    }
    try {
      await applyMigration(pat, project_ref, { name, query });
      return text(`Applied migration '${name}' to project ${project_ref}.`);
    } catch (err) {
      return renderError(err);
    }
  },
});
