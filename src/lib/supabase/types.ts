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
          mcp_token: string | null;
          marketing: boolean;
          sales: boolean;
          fulfilment: boolean;
          finance: boolean;
          // v3 onboarding state (migration 0017)
          onboarding_completed: boolean;
          onboarding_step: number;
          messaging_channel: string | null;
          messaging_handle: string | null;
          slack_workspace_url: string | null;
          slack_channel_name: string | null;
          current_month: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          mcp_token?: string | null;
          marketing?: boolean;
          sales?: boolean;
          fulfilment?: boolean;
          finance?: boolean;
          onboarding_completed?: boolean;
          onboarding_step?: number;
          messaging_channel?: string | null;
          messaging_handle?: string | null;
          slack_workspace_url?: string | null;
          slack_channel_name?: string | null;
          current_month?: number | null;
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
          role: "owner" | "admin" | "member" | "developer";
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
          role?: "owner" | "admin" | "member" | "developer";
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_users"]["Row"]>;
        Relationships: [];
      };
      rgaios_slack_bindings: {
        Row: {
          id: string;
          organization_id: string;
          slack_team_id: string;
          slack_channel_id: string;
          slack_channel_name: string | null;
          agent_id: string;
          trigger_type:
            | "new_message"
            | "new_file"
            | "app_mention"
            | "transcript";
          output_type:
            | "slack_thread"
            | "slack_channel"
            | "dm_user"
            | "gmail";
          output_config: Record<string, unknown>;
          prompt_template: string | null;
          enabled: boolean;
          created_at: string;
          last_fired_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          slack_team_id: string;
          slack_channel_id: string;
          slack_channel_name?: string | null;
          agent_id: string;
          trigger_type:
            | "new_message"
            | "new_file"
            | "app_mention"
            | "transcript";
          output_type:
            | "slack_thread"
            | "slack_channel"
            | "dm_user"
            | "gmail";
          output_config?: Record<string, unknown>;
          prompt_template?: string | null;
          enabled?: boolean;
          last_fired_at?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["rgaios_slack_bindings"]["Row"]
        >;
        Relationships: [];
      };
      rgaios_telegram_messages: {
        Row: {
          id: string;
          organization_id: string;
          connection_id: string | null;
          agent_telegram_bot_id: string | null;
          chat_id: number;
          sender_user_id: number | null;
          sender_username: string | null;
          sender_first_name: string | null;
          message_id: number;
          text: string | null;
          received_at: string;
          responded_at: string | null;
          response_text: string | null;
          placeholder_message_id: number | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          connection_id?: string | null;
          agent_telegram_bot_id?: string | null;
          chat_id: number;
          sender_user_id?: number | null;
          sender_username?: string | null;
          sender_first_name?: string | null;
          message_id: number;
          text?: string | null;
          responded_at?: string | null;
          response_text?: string | null;
          placeholder_message_id?: number | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["rgaios_telegram_messages"]["Row"]
        >;
        Relationships: [];
      };
      rgaios_agent_telegram_bots: {
        Row: {
          id: string;
          organization_id: string;
          agent_id: string;
          bot_id: number;
          bot_username: string | null;
          bot_first_name: string | null;
          bot_token: string;
          webhook_secret: string;
          status: "connected" | "error" | "disconnected";
          metadata: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          agent_id: string;
          bot_id: number;
          bot_username?: string | null;
          bot_first_name?: string | null;
          bot_token: string;
          webhook_secret: string;
          status?: "connected" | "error" | "disconnected";
          metadata?: Record<string, unknown>;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["rgaios_agent_telegram_bots"]["Row"]
        >;
        Relationships: [];
      };
      rgaios_invites: {
        Row: {
          token_hash: string;
          email: string;
          name: string | null;
          role: "owner" | "admin" | "member" | "developer";
          organization_id: string;
          invited_by: string | null;
          expires_at: string;
          accepted_at: string | null;
          created_at: string;
          allowed_departments: string[];
        };
        Insert: {
          token_hash: string;
          email: string;
          name?: string | null;
          role?: "owner" | "admin" | "member" | "developer";
          organization_id: string;
          invited_by?: string | null;
          expires_at: string;
          accepted_at?: string | null;
          allowed_departments?: string[];
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_invites"]["Row"]>;
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
          // v3 per-agent bots (migration 0024). Null = org-wide integration.
          agent_id: string | null;
          provider_config_key: string;
          nango_connection_id: string;
          display_name: string | null;
          status: "connected" | "error" | "disconnected" | "pending_token";
          metadata: Record<string, unknown>;
          connected_at: string;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          agent_id?: string | null;
          provider_config_key: string;
          nango_connection_id: string;
          display_name?: string | null;
          status?: "connected" | "error" | "disconnected" | "pending_token";
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
          bucket: string;
        };
        Insert: {
          organization_id: string;
          title: string;
          tags?: string[];
          storage_path: string;
          mime_type?: string;
          size_bytes?: number | null;
          uploaded_by?: string | null;
          bucket?: string;
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
          department: "marketing" | "sales" | "fulfilment" | "finance" | "development" | null;
          is_department_head: boolean;
          system_prompt: string | null;
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
          department?: "marketing" | "sales" | "fulfilment" | "finance" | "development" | null;
          is_department_head?: boolean;
          system_prompt?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_agents"]["Row"]>;
        Relationships: [];
      };
      rgaios_agent_skills: {
        Row: {
          agent_id: string;
          skill_id: string;
          organization_id: string;
          created_at: string;
        };
        Insert: {
          agent_id: string;
          skill_id: string;
          organization_id: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["rgaios_agent_skills"]["Row"]
        >;
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
          last_fired_at: string | null;
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
          last_fired_at?: string | null;
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

      // v3 tables below (migrations 0018–0027).
      rgaios_brand_intakes: {
        Row: {
          id: string;
          organization_id: string;
          basic_info: Record<string, unknown>;
          social_presence: Record<string, unknown>;
          origin_story: Record<string, unknown>;
          business_model: Record<string, unknown>;
          target_audience: Record<string, unknown>;
          goals: Record<string, unknown>;
          challenges: Record<string, unknown>;
          brand_voice: Record<string, unknown>;
          competitors: Record<string, unknown>;
          content_messaging: Record<string, unknown>;
          sales: Record<string, unknown>;
          tools_systems: Record<string, unknown>;
          additional_context: Record<string, unknown>;
          call_data: Record<string, unknown>;
          full_transcript: Record<string, unknown> | null;
          submitted_at: number | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["rgaios_brand_intakes"]["Row"]> & {
          organization_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_brand_intakes"]["Row"]>;
        Relationships: [];
      };
      rgaios_brand_profiles: {
        Row: {
          id: string;
          organization_id: string;
          version: number;
          content: string;
          status: "generating" | "ready" | "approved";
          generated_at: number;
          approved_at: number | null;
          approved_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["rgaios_brand_profiles"]["Row"]> & {
          organization_id: string;
          generated_at: number;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_brand_profiles"]["Row"]>;
        Relationships: [];
      };
      rgaios_onboarding_documents: {
        Row: {
          id: string;
          organization_id: string;
          type: "logo" | "guideline" | "asset" | "other";
          storage_url: string;
          filename: string;
          size: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["rgaios_onboarding_documents"]["Row"]> & {
          organization_id: string;
          storage_url: string;
          filename: string;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_onboarding_documents"]["Row"]>;
        Relationships: [];
      };
      rgaios_software_access: {
        Row: {
          id: string;
          organization_id: string;
          platform: string;
          access_type: string;
          confirmed: boolean;
          notes: string | null;
          confirmed_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["rgaios_software_access"]["Row"]> & {
          organization_id: string;
          platform: string;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_software_access"]["Row"]>;
        Relationships: [];
      };
      rgaios_scheduled_calls: {
        Row: {
          id: string;
          organization_id: string;
          title: string;
          month: number;
          week: number;
          calendly_url: string | null;
          scheduled_at: number | null;
          completed: boolean;
          notes: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["rgaios_scheduled_calls"]["Row"]> & {
          organization_id: string;
          title: string;
          month: number;
          week: number;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_scheduled_calls"]["Row"]>;
        Relationships: [];
      };
      rgaios_scrape_snapshots: {
        Row: {
          id: string;
          organization_id: string;
          kind: "social" | "competitor" | "site";
          url: string;
          title: string | null;
          content: string | null;
          embedding: string | null;
          status: "pending" | "running" | "succeeded" | "failed" | "blocked";
          error: string | null;
          scraped_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["rgaios_scrape_snapshots"]["Row"]> & {
          organization_id: string;
          kind: "social" | "competitor" | "site";
          url: string;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_scrape_snapshots"]["Row"]>;
        Relationships: [];
      };
      rgaios_agent_files: {
        Row: {
          id: string;
          organization_id: string;
          agent_id: string;
          filename: string;
          storage_path: string;
          mime_type: string;
          size_bytes: number;
          uploaded_by: string | null;
          uploaded_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["rgaios_agent_files"]["Row"]> & {
          organization_id: string;
          agent_id: string;
          filename: string;
          storage_path: string;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_agent_files"]["Row"]>;
        Relationships: [];
      };
      rgaios_agent_file_chunks: {
        Row: {
          id: string;
          file_id: string;
          organization_id: string;
          agent_id: string;
          chunk_index: number;
          content: string;
          token_count: number | null;
          embedding: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["rgaios_agent_file_chunks"]["Row"]> & {
          file_id: string;
          organization_id: string;
          agent_id: string;
          chunk_index: number;
          content: string;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_agent_file_chunks"]["Row"]>;
        Relationships: [];
      };
      rgaios_sales_calls: {
        Row: {
          id: string;
          organization_id: string;
          source_type:
            | "audio_upload"
            | "loom"
            | "fireflies"
            | "gong"
            | "other_url";
          source_url: string | null;
          filename: string | null;
          transcript: string | null;
          duration_sec: number | null;
          status: "pending" | "transcribing" | "ready" | "error";
          metadata: Record<string, unknown>;
          error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["rgaios_sales_calls"]["Row"]> & {
          organization_id: string;
          source_type:
            | "audio_upload"
            | "loom"
            | "fireflies"
            | "gong"
            | "other_url";
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_sales_calls"]["Row"]>;
        Relationships: [];
      };
      rgaios_company_chunks: {
        Row: {
          id: string;
          organization_id: string;
          source: string;
          source_id: string | null;
          chunk_index: number;
          content: string;
          token_count: number | null;
          embedding: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["rgaios_company_chunks"]["Row"]> & {
          organization_id: string;
          source: string;
          chunk_index: number;
          content: string;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_company_chunks"]["Row"]>;
        Relationships: [];
      };
      rgaios_kalendly_calendar_bindings: {
        Row: {
          id: string;
          organization_id: string;
          calendar_id: string;
          calendar_summary: string;
          default_timezone: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["rgaios_kalendly_calendar_bindings"]["Row"]> & {
          organization_id: string;
          calendar_id: string;
          calendar_summary: string;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_kalendly_calendar_bindings"]["Row"]>;
        Relationships: [];
      };
      rgaios_kalendly_event_types: {
        Row: {
          id: string;
          organization_id: string;
          slug: string;
          title: string;
          description: string;
          duration_minutes: number;
          color: string;
          location: Record<string, unknown>;
          rules: Record<string, unknown>;
          custom_questions: Record<string, unknown>[];
          active: boolean;
          position: number;
          agent_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["rgaios_kalendly_event_types"]["Row"]> & {
          organization_id: string;
          slug: string;
          title: string;
          duration_minutes: number;
          location: Record<string, unknown>;
          rules: Record<string, unknown>;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_kalendly_event_types"]["Row"]>;
        Relationships: [];
      };
      rgaios_kalendly_availability: {
        Row: {
          id: string;
          organization_id: string;
          timezone: string;
          weekly_hours: Record<string, unknown>[];
          date_overrides: Record<string, unknown>[];
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["rgaios_kalendly_availability"]["Row"]> & {
          organization_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_kalendly_availability"]["Row"]>;
        Relationships: [];
      };
      rgaios_kalendly_bookings: {
        Row: {
          id: string;
          organization_id: string;
          event_type_id: string;
          event_type_slug: string;
          guest_name: string;
          guest_email: string;
          guest_timezone: string;
          custom_answers: Record<string, string>;
          start_utc: string;
          end_utc: string;
          google_event_id: string | null;
          meet_link: string | null;
          manage_token: string;
          status: "confirmed" | "cancelled" | "rescheduled";
          rescheduled_to_booking_id: string | null;
          notified_agent_at: string | null;
          created_at: string;
          cancelled_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["rgaios_kalendly_bookings"]["Row"]> & {
          organization_id: string;
          event_type_id: string;
          event_type_slug: string;
          guest_name: string;
          guest_email: string;
          guest_timezone: string;
          start_utc: string;
          end_utc: string;
          manage_token: string;
        };
        Update: Partial<Database["public"]["Tables"]["rgaios_kalendly_bookings"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
