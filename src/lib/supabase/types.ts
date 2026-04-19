/**
 * Supabase type definitions.
 *
 * For MVP this is hand-rolled to match supabase/migrations/0001_init.sql.
 * All tables use the rgaios_ prefix to avoid collisions if the Supabase
 * project is shared with other apps.
 *
 * Once the app stabilises, replace this file with generated types via:
 *
 *   npx supabase gen types typescript --project-id <ref> --schema public
 *
 * Any column change MUST be reflected here until generated types are wired up.
 */

export type Database = {
  public: {
    Tables: {
      rgaios_organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_organizations"]["Row"]>;
        Relationships: [];
      };
      rgaios_users: {
        Row: {
          id: string;
          email: string;
          name: string | null;
          image: string | null;
          password_hash: string | null;
          email_verified: string | null;
          organization_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          name?: string | null;
          image?: string | null;
          password_hash?: string | null;
          email_verified?: string | null;
          organization_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_users"]["Row"]>;
        Relationships: [];
      };
      rgaios_password_resets: {
        Row: {
          token_hash: string;
          user_id: string;
          expires_at: string;
          used_at: string | null;
          created_at: string;
        };
        Insert: {
          token_hash: string;
          user_id: string;
          expires_at: string;
          used_at?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["rgaios_password_resets"]["Row"]
        >;
        Relationships: [];
      };
      rgaios_connections: {
        Row: {
          id: string;
          organization_id: string;
          provider_config_key: string;
          nango_connection_id: string;
          display_name: string | null;
          status: "connected" | "error" | "disconnected";
          metadata: Record<string, unknown>;
          connected_at: string;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          provider_config_key: string;
          nango_connection_id: string;
          display_name?: string | null;
          status?: "connected" | "error" | "disconnected";
          metadata?: Record<string, unknown>;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_connections"]["Row"]>;
        Relationships: [];
      };
      rgaios_knowledge_files: {
        Row: {
          id: string;
          organization_id: string;
          title: string;
          tags: string[];
          storage_path: string;
          mime_type: string;
          size_bytes: number | null;
          uploaded_at: string;
          uploaded_by: string | null;
        };
        Insert: {
          organization_id: string;
          title: string;
          tags?: string[];
          storage_path: string;
          mime_type?: string;
          size_bytes?: number | null;
          uploaded_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_knowledge_files"]["Row"]>;
        Relationships: [];
      };
      rgaios_agents: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          title: string | null;
          role: string;
          reports_to: string | null;
          description: string | null;
          runtime: string;
          budget_monthly_usd: number;
          spent_monthly_usd: number;
          status: "idle" | "running" | "paused" | "error";
          write_policy: Record<
            string,
            "direct" | "requires_approval" | "draft_only"
          >;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          name: string;
          title?: string | null;
          role?: string;
          reports_to?: string | null;
          description?: string | null;
          runtime?: string;
          budget_monthly_usd?: number;
          write_policy?: Record<
            string,
            "direct" | "requires_approval" | "draft_only"
          >;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_agents"]["Row"]>;
        Relationships: [];
      };
      rgaios_routines: {
        Row: {
          id: string;
          organization_id: string;
          title: string;
          description: string | null;
          assignee_agent_id: string | null;
          status: "active" | "paused" | "archived";
          last_run_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          title: string;
          description?: string | null;
          assignee_agent_id?: string | null;
          status?: "active" | "paused" | "archived";
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_routines"]["Row"]>;
        Relationships: [];
      };
      rgaios_routine_triggers: {
        Row: {
          id: string;
          organization_id: string;
          routine_id: string;
          kind: "manual" | "schedule" | "webhook" | "integration" | "telegram";
          enabled: boolean;
          config: Record<string, unknown>;
          public_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          routine_id: string;
          kind: "manual" | "schedule" | "webhook" | "integration" | "telegram";
          enabled?: boolean;
          config?: Record<string, unknown>;
          public_id?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["rgaios_routine_triggers"]["Row"]
        >;
        Relationships: [];
      };
      rgaios_routine_runs: {
        Row: {
          id: string;
          organization_id: string;
          routine_id: string;
          trigger_id: string | null;
          source: string;
          status:
            | "pending"
            | "running"
            | "awaiting_approval"
            | "succeeded"
            | "failed";
          input_payload: Record<string, unknown> | null;
          output: Record<string, unknown> | null;
          error: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          organization_id: string;
          routine_id: string;
          trigger_id?: string | null;
          source: string;
          status?:
            | "pending"
            | "running"
            | "awaiting_approval"
            | "succeeded"
            | "failed";
          input_payload?: Record<string, unknown> | null;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_routine_runs"]["Row"]>;
        Relationships: [];
      };
      rgaios_approvals: {
        Row: {
          id: string;
          organization_id: string;
          routine_run_id: string | null;
          agent_id: string | null;
          tool_name: string;
          tool_args: Record<string, unknown>;
          reason: string | null;
          status: "pending" | "approved" | "rejected";
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          organization_id: string;
          routine_run_id?: string | null;
          agent_id?: string | null;
          tool_name: string;
          tool_args: Record<string, unknown>;
          reason?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_approvals"]["Row"]>;
        Relationships: [];
      };
      rgaios_audit_log: {
        Row: {
          id: string;
          organization_id: string | null;
          ts: string;
          kind: string;
          actor_type: string | null;
          actor_id: string | null;
          detail: Record<string, unknown>;
        };
        Insert: {
          organization_id?: string | null;
          kind: string;
          actor_type?: string | null;
          actor_id?: string | null;
          detail?: Record<string, unknown>;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_audit_log"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
