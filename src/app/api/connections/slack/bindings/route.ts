import { NextResponse, type NextRequest } from "next/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { getConnection } from "@/lib/connections/queries";
import {
  createBinding,
  listBindingsForOrg,
} from "@/lib/slack/bindings";

export const runtime = "nodejs";

const VALID_TRIGGERS = new Set([
  "new_message",
  "new_file",
  "app_mention",
  "transcript",
]);
const VALID_OUTPUTS = new Set([
  "slack_thread",
  "slack_channel",
  "dm_user",
  "gmail",
]);

/**
 * GET /api/connections/slack/bindings
 * List every Slack binding for this org (all channels, all agents).
 */
export async function GET() {
  try {
    const organizationId = await currentOrganizationId();
    const bindings = await listBindingsForOrg(organizationId);
    return NextResponse.json({ bindings });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * POST /api/connections/slack/bindings
 * Body: {
 *   slack_channel_id, slack_channel_name?, agent_id, trigger_type,
 *   output_type, output_config?, prompt_template?
 * }
 *
 * team_id is resolved from the installed Slack connection (not trusted
 * from client input).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      slack_channel_id?: string;
      slack_channel_name?: string;
      agent_id?: string;
      trigger_type?: string;
      output_type?: string;
      output_config?: Record<string, unknown>;
      prompt_template?: string;
      enabled?: boolean;
    };

    const channelId = String(body.slack_channel_id ?? "").trim();
    const agentId = String(body.agent_id ?? "").trim();
    const triggerType = String(body.trigger_type ?? "").trim();
    const outputType = String(body.output_type ?? "").trim();

    if (!channelId || !agentId || !triggerType || !outputType) {
      return NextResponse.json(
        {
          error:
            "slack_channel_id, agent_id, trigger_type, output_type are all required",
        },
        { status: 400 },
      );
    }
    if (!VALID_TRIGGERS.has(triggerType)) {
      return NextResponse.json(
        { error: `trigger_type must be one of ${[...VALID_TRIGGERS].join(", ")}` },
        { status: 400 },
      );
    }
    if (!VALID_OUTPUTS.has(outputType)) {
      return NextResponse.json(
        { error: `output_type must be one of ${[...VALID_OUTPUTS].join(", ")}` },
        { status: 400 },
      );
    }

    const organizationId = await currentOrganizationId();
    const slackConn = await getConnection(organizationId, "slack");
    const teamId = (slackConn?.metadata as { team_id?: string } | null)
      ?.team_id;
    if (!teamId) {
      return NextResponse.json(
        { error: "Slack workspace not installed for this org" },
        { status: 400 },
      );
    }

    const binding = await createBinding({
      organization_id: organizationId,
      slack_team_id: teamId,
      slack_channel_id: channelId,
      slack_channel_name: body.slack_channel_name ?? null,
      agent_id: agentId,
      trigger_type: triggerType as
        | "new_message"
        | "new_file"
        | "app_mention"
        | "transcript",
      output_type: outputType as
        | "slack_thread"
        | "slack_channel"
        | "dm_user"
        | "gmail",
      output_config: body.output_config ?? {},
      prompt_template: body.prompt_template ?? null,
      enabled: body.enabled ?? true,
    });

    return NextResponse.json({ ok: true, binding });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
