import { supabaseAdmin } from "@/lib/supabase/server";
import { DEFAULT_AGENT_RUNTIME } from "./constants";
import type { AgentRole } from "./constants";
import type { Database } from "@/lib/supabase/types";
import { autoTrainAgent } from "@/lib/agents/auto-train";

/**
 * Default agent seed for a fresh organization.
 *
 * Each pillar (department) ships with one Manager (is_department_head=true)
 * plus one or more Sub-agents (is_department_head=false) that report to
 * the Manager. Department slug is set on both manager and sub-agents -
 * the previous bug had every default agent landing as UNASSIGNED on
 * /agents/tree and "13 agents waiting to be placed in a department" on
 * /departments because no department was being written and the head flag
 * was left default-false.
 *
 * Idempotent. Safe to call multiple times per org. Skips a manager when
 * `(organization_id, department) where is_department_head=true` already
 * has a row (the partial unique index from migration 0033). Skips a
 * sub-agent when an agent with the same (organization_id, name) exists.
 *
 * Wired from createClient() in @/lib/clients/queries so every org
 * provisioned through the admin panel lands with a fully-populated org
 * chart instead of a 13-agent dump in Unassigned.
 */

type AgentInsert = Database["public"]["Tables"]["rgaios_agents"]["Insert"];

type SubAgentSpec = {
  name: string;
  title: string;
  role: AgentRole;
  description: string;
};

type DepartmentSeed = {
  department: "marketing" | "sales" | "fulfilment" | "finance" | "development";
  manager: {
    name: string;
    title: string;
    role: AgentRole;
    description: string;
  };
  subAgents: SubAgentSpec[];
};

export const DEFAULT_AGENT_SEED: DepartmentSeed[] = [
  {
    department: "marketing",
    manager: {
      name: "Marketing Manager",
      title: "Head of Marketing",
      role: "marketer",
      description:
        "Owns the marketing pillar. Coordinates content, social, and campaign output across the team.",
    },
    subAgents: [
      {
        name: "Content Strategist",
        title: "Content Strategist",
        role: "marketer",
        description: "Plans editorial calendar and long-form content pieces.",
      },
      {
        name: "Social Media Manager",
        title: "Social Media Manager",
        role: "marketer",
        description: "Drafts and schedules short-form social posts across platforms.",
      },
    ],
  },
  {
    department: "sales",
    manager: {
      name: "Sales Manager",
      title: "Head of Sales",
      role: "sdr",
      description:
        "Owns the sales pillar. Runs pipeline, forecasts, and outbound coordination.",
    },
    subAgents: [
      {
        name: "SDR",
        title: "Sales Development Rep",
        role: "sdr",
        description: "Outbound prospecting, qualification, and meeting booking.",
      },
    ],
  },
  {
    department: "fulfilment",
    manager: {
      name: "Operations Manager",
      title: "Head of Operations",
      role: "ops",
      description:
        "Owns fulfilment and delivery operations. Tracks SLAs and handoffs.",
    },
    subAgents: [
      {
        name: "Project Coordinator",
        title: "Project Coordinator",
        role: "ops",
        description: "Coordinates client deliverables, deadlines, and status updates.",
      },
    ],
  },
  {
    department: "finance",
    manager: {
      name: "Finance Manager",
      title: "Head of Finance",
      role: "general",
      description:
        "Owns the finance pillar. Tracks budgets, invoicing, and spend reporting.",
    },
    subAgents: [
      {
        name: "Bookkeeper",
        title: "Bookkeeper",
        role: "general",
        description: "Reconciles transactions and prepares monthly reports.",
      },
    ],
  },
  {
    department: "development",
    manager: {
      name: "Engineering Manager",
      title: "Head of Engineering",
      role: "cto",
      description:
        "Owns the engineering pillar. Coordinates backend, frontend, and QA work.",
    },
    subAgents: [
      {
        name: "Backend Engineer",
        title: "Backend Engineer",
        role: "engineer",
        description: "Server-side features, APIs, and data plumbing.",
      },
      {
        name: "Frontend Engineer",
        title: "Frontend Engineer",
        role: "engineer",
        description: "UI components, page composition, and client-side state.",
      },
      {
        name: "QA Engineer",
        title: "QA Engineer",
        role: "engineer",
        description: "Test plans, regression coverage, and release verification.",
      },
    ],
  },
];

export type SeedDefaultAgentsResult = {
  managersInserted: number;
  managersSkipped: number;
  subAgentsInserted: number;
  subAgentsSkipped: number;
};

/**
 * Idempotently seed the default agent roster for one organization.
 *
 * Manager skip rule: a row with the same (organization_id, department)
 * AND is_department_head=true is taken as proof the manager exists, per
 * the partial unique index `rgaios_agents_one_head_per_dept` (migration
 * 0033). If found, the manager is reused as the reports_to target for
 * its sub-agents.
 *
 * Sub-agent skip rule: an existing row with the same (organization_id,
 * name) is treated as a duplicate. We don't have a uniqueness constraint
 * on name, so this is best-effort - re-running the seed after a manual
 * rename will still re-insert the original. That's acceptable for the
 * current MVP; a future migration can add a (org, name) unique on
 * default_seed_token if it becomes a real problem.
 */
export async function seedDefaultAgentsForOrg(
  organizationId: string,
): Promise<SeedDefaultAgentsResult> {
  const db = supabaseAdmin();
  const result: SeedDefaultAgentsResult = {
    managersInserted: 0,
    managersSkipped: 0,
    subAgentsInserted: 0,
    subAgentsSkipped: 0,
  };

  // CEO agent at the root of the org chart (Chris brief P1 #10). One per
  // org, sits above every department head, brokered via agent_invoke.
  // Idempotency: by-role lookup so renames don't dup.
  const { data: existingCeo } = await db
    .from("rgaios_agents")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("role", "ceo")
    .is("department", null)
    .is("reports_to", null)
    .maybeSingle();

  if (!existingCeo?.id) {
    const ceoPayload: AgentInsert = {
      organization_id: organizationId,
      name: "Atlas",
      title: "Chief AI Coordinator",
      role: "ceo",
      description:
        "Routes work between department heads, synthesizes cross-department briefs, escalates to the human owner only when policy demands it.",
      runtime: DEFAULT_AGENT_RUNTIME,
      department: null,
      is_department_head: false,
      reports_to: null,
    };
    const { data: ceoInserted, error: ceoErr } = await db
      .from("rgaios_agents")
      .insert(ceoPayload)
      .select("id")
      .single();
    if (ceoErr || !ceoInserted) {
      console.error(
        "[seedDefaultAgents] CEO insert failed:",
        ceoErr?.message,
      );
    } else {
      await autoTrainAgent({
        orgId: organizationId,
        agentId: ceoInserted.id,
        roleLabel: "CEO",
      });
    }
  }

  for (const dept of DEFAULT_AGENT_SEED) {
    // Manager idempotency check.
    const { data: existingHead } = await db
      .from("rgaios_agents")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("department", dept.department)
      .eq("is_department_head", true)
      .maybeSingle();

    let managerId: string;

    if (existingHead?.id) {
      managerId = existingHead.id;
      result.managersSkipped += 1;
    } else {
      const insertPayload: AgentInsert = {
        organization_id: organizationId,
        name: dept.manager.name,
        title: dept.manager.title,
        role: dept.manager.role,
        description: dept.manager.description,
        runtime: DEFAULT_AGENT_RUNTIME,
        department: dept.department,
        is_department_head: true,
      };
      const { data: inserted, error: insertErr } = await db
        .from("rgaios_agents")
        .insert(insertPayload)
        .select("id")
        .single();
      if (insertErr || !inserted) {
        console.error(
          `[seedDefaultAgents] manager insert failed for ${dept.department}:`,
          insertErr?.message,
        );
        continue;
      }
      managerId = inserted.id;
      result.managersInserted += 1;
      await autoTrainAgent({
        orgId: organizationId,
        agentId: managerId,
        roleLabel: dept.manager.name,
      });
    }

    for (const sub of dept.subAgents) {
      const { data: existingSub } = await db
        .from("rgaios_agents")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("name", sub.name)
        .maybeSingle();
      if (existingSub?.id) {
        result.subAgentsSkipped += 1;
        continue;
      }
      const subPayload: AgentInsert = {
        organization_id: organizationId,
        name: sub.name,
        title: sub.title,
        role: sub.role,
        description: sub.description,
        runtime: DEFAULT_AGENT_RUNTIME,
        department: dept.department,
        is_department_head: false,
        reports_to: managerId,
      };
      const { data: subInserted, error: subErr } = await db
        .from("rgaios_agents")
        .insert(subPayload)
        .select("id")
        .single();
      if (subErr || !subInserted) {
        console.error(
          `[seedDefaultAgents] sub-agent insert failed for ${sub.name}:`,
          subErr?.message,
        );
        continue;
      }
      result.subAgentsInserted += 1;
      await autoTrainAgent({
        orgId: organizationId,
        agentId: subInserted.id,
        roleLabel: sub.name,
      });
    }
  }

  return result;
}
