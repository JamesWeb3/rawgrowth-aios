import type { Database } from "@/lib/supabase/types";
import type { AgentRole, AgentRuntime, AgentStatus } from "./constants";

export type Department = "marketing" | "sales" | "fulfilment" | "finance" | "development";
export const DEPARTMENTS: Department[] = ["marketing", "sales", "fulfilment", "finance", "development"];

type AgentRow = Database["public"]["Tables"]["rgaios_agents"]["Row"];

/**
 * Client-facing agent shape. snake_case Postgres columns mapped to
 * camelCase so the UI keeps its existing vocabulary.
 */
export type Agent = {
  id: string;
  name: string;
  title: string;
  role: AgentRole;
  reportsTo: string | null;
  description: string;
  runtime: AgentRuntime;
  budgetMonthlyUsd: number;
  spentMonthlyUsd: number;
  status: AgentStatus;
  writePolicy: Record<string, "direct" | "requires_approval" | "draft_only">;
  department: Department | null;
  isDepartmentHead: boolean;
  createdAt: string;
};

export function agentFromRow(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    title: row.title ?? "",
    role: row.role as AgentRole,
    reportsTo: row.reports_to,
    description: row.description ?? "",
    runtime: row.runtime as AgentRuntime,
    budgetMonthlyUsd: row.budget_monthly_usd,
    spentMonthlyUsd: row.spent_monthly_usd,
    status: row.status,
    writePolicy: row.write_policy,
    department: (row.department ?? null) as Department | null,
    isDepartmentHead: row.is_department_head ?? false,
    createdAt: row.created_at,
  };
}

/** Input to hireAgent() — everything except server-controlled fields. */
export type AgentCreateInput = {
  name: string;
  title: string;
  role: AgentRole;
  reportsTo: string | null;
  description: string;
  runtime: AgentRuntime;
  budgetMonthlyUsd: number;
  department?: Department | null;
  isDepartmentHead?: boolean;
  writePolicy?: Record<string, "direct" | "requires_approval" | "draft_only">;
};

export type AgentUpdateInput = Partial<AgentCreateInput> & {
  status?: AgentStatus;
  spentMonthlyUsd?: number;
  writePolicy?: Record<
    string,
    "direct" | "requires_approval" | "draft_only"
  >;
};
