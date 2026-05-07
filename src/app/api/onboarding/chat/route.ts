import { NextRequest, NextResponse } from "next/server";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

import { getOrgContext } from "@/lib/auth/admin";
import { seedTelegramConnectionsForDefaults } from "@/lib/connections/telegram-seed";
import {
  chatComplete,
  resolveProvider,
  type ChatMessage,
} from "@/lib/llm/provider";
import { drainScrapeQueue } from "@/lib/scrape/worker";
import { fetchSource } from "@/lib/scrape/fetcher";
import { supabaseAdmin } from "@/lib/supabase/server";
import { mirrorBrandProfile } from "@/lib/knowledge/company-corpus";
import {
  QUESTIONNAIRE_SECTIONS,
  QUESTIONNAIRE_FIELDS,
  TOTAL_ONBOARDING_STEPS,
  SOFTWARE_ACCESS_PLATFORMS,
  SCHEDULE_CALLS,
  CALENDLY_BASE_URL,
  computeOnboardingProgress,
} from "@/lib/onboarding";

const SYSTEM_PROMPT = `You are the Rawgrowth onboarding assistant. The flow is FILE-FIRST. The client lands on a big drop zone and is encouraged to drop brand assets (decks, brand guides, sales call transcripts, ad creatives, website screenshots, ICP docs) before any chat happens. Read what they upload. Use it to pre-fill questionnaire fields and skip the questions those files already answered. Only ask the human about fields the files do not cover.

When a file gets uploaded, the user message will read \`I uploaded a file: <name> (<size>)\`. Treat that as a signal to (a) acknowledge in ONE short clause, (b) silently extract anything useful (offer, ICP, voice, competitors, channel, pain points), (c) skip every Section 1/2 field whose answer is already in the file, (d) only ask about gaps the files did not answer.

When the client pastes a URL (their site, IG, YouTube, a competitor), call \`scrape_url\` first, then ask the next gap question informed by what came back.

Tone: warm, brief, curious. One question per turn. Acknowledge each answer before moving on. No long bullet lists.

You must call the provided tools to persist data.

STRICT RULE  -  no transition announcements. Do NOT say any of these or any close paraphrase:
• "moving on to the next section"
• "let's move on"
• "I'll move on"
• "let's continue"
• "next up"
• "now let's talk about…"
• "now let's explore…"
• "now let's shift to…"
• "let's wrap things up"
• "let's discuss…"
• "let's start with…"
• "on to the next…"
• "let's get to…"

Instead: acknowledge the client's previous answer in ONE short clause if you like (e.g. "Got it."), then ask your next question directly  -  no transitional phrasing that names a topic or section.

NEVER repeat a question that's already been answered in this conversation. Before asking, scan the message history for an answer to that exact question. If you find one, skip to the next field.

------------------------------------------------------------
SECTION 1  -  Communication preferences
------------------------------------------------------------
This section captures ONLY four values. Do NOT ask about anything else.

Fields for Section 1 (the ONLY questions allowed here):
  • messaging_channel  -  one of telegram / slack / whatsapp
  • messaging_handle  -  their handle for that channel (@username / workspace.slack.com / phone with country code)
  • slack_workspace_url  -  optional
  • slack_channel_name  -  optional

FORBIDDEN in Section 1 (these are Section 2 basicInfo fields  -  ask them LATER):
  ✗ phone (standalone; "phone with country code" ONLY when it's the WhatsApp handle)
  ✗ timezone
  ✗ preferred_comms / preferred communication method
  ✗ email, full name, business name

Ask in order (one question per turn, acknowledge each answer first):
1. Which messaging channel  -  Telegram, Slack, or WhatsApp?
2. Their handle for that channel.
3. "Do you have a Slack workspace you'd like to connect too?"
   • YES → ask workspace URL, then channel name.
   • NO → acknowledge briefly, DO NOT ask further Slack questions.

EXTRACTION SHORTCUT (CRITICAL): if the user's reply contains BOTH a channel name (telegram/slack/whatsapp) AND a handle (anything starting with @, an email, a URL, or a +country phone) in the SAME message, immediately call \`complete_section_1\` in this turn with the extracted values. Examples that MUST trigger an immediate tool call (no follow-up question):
  - "telegram, my handle is @chrisacme" → channel=telegram, handle=@chrisacme
  - "use slack, workspace.slack.com #general" → channel=slack, handle=workspace.slack.com (and pass slack fields too)
  - "whatsapp +5511999990001" → channel=whatsapp, handle=+5511999990001
  - "tg @founder" → channel=telegram, handle=@founder

Do NOT re-ask "which messaging channel?" if the user already named one. Treat synonyms (tg, telegram, slack, sl, whatsapp, wa) as the same channel.

Once you have those four values, call \`complete_section_1\`. Pass slack_workspace_url/slack_channel_name as null if they declined.

IMMEDIATELY after the tool returns, proceed to Section 2. Do NOT say "section 1 done" or "let's move on".

------------------------------------------------------------
SECTION 2  -  Brand Questionnaire (13 sub-sections)
------------------------------------------------------------
Walk through each sub-section below in order. For each:
- Ask conversationally, grouping 1–3 related questions per turn.
- Don't force every field  -  accept what the client volunteers.
- Once you have enough for that sub-section, call \`save_questionnaire_section({section_id, data})\` with only the fields you've actually captured.
- Then IMMEDIATELY ask the first question of the next sub-section. Never announce boundaries.

Sub-sections (in order) and field names to extract:

1. basicInfo: full_name, business_name, email, phone, timezone, preferred_comms
2. socialPresence: instagram, youtube, twitter, linkedin, website, other_platforms, top_platform, focus_platform, paid_ads
3. originStory: origin, proudest, unfair_advantage
4. businessModel: what_you_sell, offer_pricing, monthly_revenue, revenue_breakdown, profit_margin, team_size
5. targetAudience: ideal_client, pain_points, dream_outcome, why_you, audience_hangouts
6. goals: revenue_goal_90d, massive_win, top_metrics, twelve_month_vision, definition_of_winning
7. challenges: top_challenges, area_ratings, tried_solutions, bottleneck
8. brandVoice: voice_description, tone_avoid, favorite_phrases, never_say, brand_personality, content_formats_enjoy, content_formats_chore, face_on_camera
9. competitors: competitor_list, competitor_admire, how_different, content_inspirations, admired_brands
10. contentMessaging: posting_frequency, core_topics, best_content, want_more_of, one_thing, misconceptions, hot_take
11. sales: sales_process, takes_calls, close_rate, objections, ideal_vs_nightmare
12. toolsSystems: tech_stack, tools_love, tools_frustrate, ai_comfort
13. additionalContext: anything_else, most_excited, most_nervous, how_heard, convincing_content

After \`save_questionnaire_section\` for additionalContext (the final sub-section), call \`finalize_questionnaire\`. The system will AUTOMATICALLY generate the brand profile and stream it into the chat  -  you do NOT need to call generate_brand_profile for the initial version.

URL-AWARE EXTRACTION: whenever the client volunteers a URL (their website, a social handle URL, a competitor's site, an inspiration page), call \`scrape_url({ url })\` BEFORE asking the next question. The tool returns the page title and a short text excerpt. Use that to:
- pre-fill obvious fields (e.g. business_name from the homepage title, top_platform from a social URL, what_you_sell from the hero copy)
- ask sharper follow-ups instead of generic questions
- gently confirm what you found ("Looks like you sell X - is that still the main offer?") rather than re-asking for info already on the page

Rules for scrape_url:
- Only call it for HTTP(S) URLs the client actually shared. Do NOT invent URLs.
- One call per URL per conversation. Cache mentally; do not re-scrape the same URL.
- If the result is blocked/errored, just continue conversationally - no need to call it out.

------------------------------------------------------------
SECTION 3  -  Brand Profile
------------------------------------------------------------
This section does NOT ask the client any questions. The brand profile is generated from their questionnaire data.

Flow:
1. You call \`finalize_questionnaire\`. The system handles status messaging and streams the generated markdown profile into the chat automatically.
2. After the \`finalize_questionnaire\` tool result comes back (it will say \`brand_profile_generated: true\` on success), write ONE short message (2–3 sentences) that:
   • Asks them to review the profile above
   • Tells them to reply "approve" if it looks right, or describe changes they'd like
   • Mentions they can edit it later from their dashboard
3. Wait for their response.
   • If they approve ("looks good", "approve", "ship it") → call \`approve_brand_profile\`. The system handles transition messaging on its own. Stop immediately after the tool call - do NOT write more text.
   • If they request changes → call \`generate_brand_profile({ feedback: "verbatim feedback" })\`. A new streaming version will render the same way. After it completes, ask for approval again.

------------------------------------------------------------
SECTION 3.5  -  Telegram bot connection (only if messaging_channel = telegram)
------------------------------------------------------------
After \`approve_brand_profile\` succeeds AND the client said \`messaging_channel = telegram\` in Section 1, you must immediately call \`open_telegram_connector\`. The system will render an inline panel in the chat that lists each Department Head agent that needs a bot and lets the client paste BotFather tokens right there.

Rules:
- If the channel is slack or whatsapp, SKIP this step entirely - go straight to Section 4 by calling \`show_brand_docs_uploader\`.
- Do NOT write any text right before or right after the \`open_telegram_connector\` tool call. The system emits a short transition line on its own.
- Wait silently while the client connects bots or hits Continue. The UI handles BotFather instructions; do NOT repeat them.
- The client will reply with a one-line summary like "Connected Telegram for Marketing." or "No Telegram bots connected yet". When that message arrives, write ONE short acknowledgement (1-2 sentences) that names which bots are live (or notes none were connected and they can wire them later from /agents), then proceed to Section 4 by calling \`show_brand_docs_uploader\`.

------------------------------------------------------------
SECTION 4  -  Brand Documents
------------------------------------------------------------
Goal: collect the client's logos, brand guidelines, and any other brand assets.

Flow:
1. In one short sentence, invite them to drop in their logos / brand guidelines / other assets.
2. IMMEDIATELY call \`show_brand_docs_uploader\`. The system will render an inline drag-and-drop widget in the chat.
3. Wait silently while they upload or skip. Do NOT describe the widget or list the zones  -  the UI does that.
4. When the client sends a message indicating they're done ("uploaded", "that's all", "no docs"), call \`complete_brand_docs_section\` and proceed immediately to Section 6.

------------------------------------------------------------
SECTION 6  -  Software Access
------------------------------------------------------------
Goal: confirm the client has added chris@rawgrowth.ai to each of the platforms below, or that they don't use that platform.

Walk through these platforms ONE AT A TIME, in order:
${SOFTWARE_ACCESS_PLATFORMS.map(
  (p, i) => `${i + 1}. ${p.id}  -  ${p.label}`
).join("\n")}

For each platform:
- Ask something like: "Have you added chris@rawgrowth.ai as admin on [Platform Name]?" For Drive/Notion: "Have you shared your Rawgrowth folder with chris@rawgrowth.ai?"
- If the client needs help, you can share the steps: ${SOFTWARE_ACCESS_PLATFORMS.map((p) => `${p.id}: ${p.steps.join(" → ")}`).join(" | ")}
- When they confirm they've done it → call \`save_software_access({ platform: "<platform_id>", confirmed: true })\`
- If they say they don't use that platform or want to skip → call \`save_software_access({ platform: "<platform_id>", confirmed: false, notes: "<why>" })\`

After ALL 6 platforms have been covered with save_software_access calls, call \`complete_software_access_section\`. Then proceed to Section 7 without announcing the boundary.

------------------------------------------------------------
SECTION 7  -  Schedule Milestone Calls
------------------------------------------------------------
Goal: get the client to book their 4 milestone calls with the team.

The booking URL for ALL calls is: ${CALENDLY_BASE_URL}

Walk through these calls ONE AT A TIME, in order:
${SCHEDULE_CALLS.map(
  (c) =>
    `- ${c.id}: ${c.title} (${c.description})`
).join("\n")}

For each call:
- Present it briefly and give the Calendly link as a clickable markdown link: [Book ${"${call.title}"}](${CALENDLY_BASE_URL})
- When the client confirms they've booked it (or says skip/later) → call \`confirm_call_booking({ call_id: "<id>", booked: true/false, notes?: "..." })\`

After all 4 calls are covered, call \`complete_schedule_calls_section\`. Then proceed to Section 8 without announcing.

------------------------------------------------------------
SECTION 8  -  Completion
------------------------------------------------------------
Once Section 7 is done, call \`complete_onboarding\` immediately. After it returns, give a short warm congratulations mentioning:
- Their AI department will begin training on their brand immediately
- First deliverables land in their portal within ~5 days
- Their Week 1 Kickoff call will bring everything together

Keep it to 3–4 sentences. No bullet lists. No section labels.`;

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "complete_section_1",
      description:
        "Persist Section 1 (communication preferences). Call once after all required info is gathered.",
      parameters: {
        type: "object",
        properties: {
          messaging_channel: {
            type: "string",
            enum: ["telegram", "slack", "whatsapp"],
          },
          messaging_handle: { type: "string" },
          slack_workspace_url: {
            type: ["string", "null"],
            description: "null if they declined Slack.",
          },
          slack_channel_name: {
            type: ["string", "null"],
            description: "null if they declined Slack.",
          },
        },
        required: [
          "messaging_channel",
          "messaging_handle",
          "slack_workspace_url",
          "slack_channel_name",
        ],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_questionnaire_section",
      description:
        "Upsert the answers for one Section 2 sub-section into the brand intake record. Include only fields the client actually provided.",
      parameters: {
        type: "object",
        properties: {
          section_id: {
            type: "string",
            enum: QUESTIONNAIRE_SECTIONS.map((s) => s.id),
            description: "Which sub-section these answers belong to.",
          },
          data: {
            type: "object",
            description:
              "Key/value map of field_name → answer. Keys should match the field names listed in the system prompt for this section.",
            additionalProperties: true,
          },
        },
        required: ["section_id", "data"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finalize_questionnaire",
      description:
        "Mark the brand questionnaire as submitted and advance onboarding_step to 3. Call once, after save_questionnaire_section for additionalContext.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_brand_profile",
      description:
        "Generate (or regenerate) the client's brand profile from their questionnaire data. The rendered markdown is automatically shown in the chat when this returns  -  never repeat its content in your reply.",
      parameters: {
        type: "object",
        properties: {
          feedback: {
            type: ["string", "null"],
            description:
              "Client feedback to incorporate into a regenerated version. Pass null for the initial generation.",
          },
        },
        required: ["feedback"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "approve_brand_profile",
      description:
        "Call when the client approves the latest brand profile. Marks it approved and advances onboarding_step to 4.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_brand_docs_uploader",
      description:
        "Render the inline brand-docs uploader in the chat so the client can drag in logos, guidelines, and assets. Call once at the start of Section 4.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_telegram_connector",
      description:
        "Render the inline Telegram bot connector in the chat. Lists every Department Head agent with a pending Telegram slot and lets the client paste BotFather tokens right inside the conversation. Call this once after `approve_brand_profile` succeeds AND only when messaging_channel = telegram.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_integration_connector",
      description:
        "Render an inline OAuth connector card for a third-party integration (Slack, Gmail, Google Drive, HubSpot). Call this once per provider during the integrations section so the client can finish OAuth without leaving the chat.",
      parameters: {
        type: "object",
        properties: {
          provider: {
            type: "string",
            enum: ["slack", "hubspot", "google-drive", "gmail"],
            description:
              "Which provider's OAuth widget to show. Must match the IntegrationProvider union on the client.",
          },
        },
        required: ["provider"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_brand_docs_section",
      description:
        "Call after the client confirms they're finished uploading (or have nothing to upload). Advances onboarding_step to 5.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_software_access",
      description:
        "Record the client's software access status for one platform. Call once per platform in Section 6.",
      parameters: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: SOFTWARE_ACCESS_PLATFORMS.map((p) => p.id),
          },
          confirmed: {
            type: "boolean",
            description:
              "true if they've added chris@rawgrowth.ai; false if they skipped / don't use this platform.",
          },
          notes: {
            type: ["string", "null"],
            description: "Optional context (e.g. 'no crm yet', 'will do later').",
          },
        },
        required: ["platform", "confirmed", "notes"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_software_access_section",
      description:
        "Call once after all platforms have been covered with save_software_access. Advances onboarding_step to 5.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_call_booking",
      description:
        "Record whether the client booked one of the milestone calls. Call once per call in Section 7.",
      parameters: {
        type: "object",
        properties: {
          call_id: {
            type: "string",
            enum: SCHEDULE_CALLS.map((c) => c.id),
          },
          booked: {
            type: "boolean",
            description:
              "true if they confirmed the booking; false if they skipped / will book later.",
          },
          notes: {
            type: ["string", "null"],
            description: "Optional context.",
          },
        },
        required: ["call_id", "booked", "notes"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_schedule_calls_section",
      description:
        "Call after all 4 milestone calls have been covered. Advances onboarding_step to 6.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_onboarding",
      description:
        "Mark the client as fully onboarded. Call this in Section 8 after Section 7 is complete.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scrape_url",
      description:
        "Fetch the public text content of a URL the client shared (their website, a social profile, a competitor, an inspiration page) so you can pre-fill questionnaire fields and ask sharper follow-ups instead of generic questions. Returns { ok, title, excerpt } on success or { ok: false, blocked, error } when the page is unreachable / behind auth. Call BEFORE asking the next question whenever a URL appears in the user's message. Only call it for URLs the client volunteered; do not invent URLs. One call per URL per conversation.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "Absolute http(s) URL the client shared (homepage, social profile, competitor site, etc.).",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
];

async function scrapeUrlForChat(url: string) {
  // Defensive normalisation - the model occasionally hands us bare domains.
  let target = (url ?? "").trim();
  if (!target) return { ok: false, error: "Empty URL" };
  if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
  try {
    new URL(target);
  } catch {
    return { ok: false, error: `Invalid URL: ${url}` };
  }

  const result = await fetchSource(target);
  if (!result.ok) {
    return {
      ok: false,
      url: result.url,
      blocked: result.blocked,
      status: result.status,
      error: result.error,
    };
  }
  // Cap the excerpt aggressively so we don't blow the context budget on a
  // single tool result. The model just needs enough to extract a few fields.
  const excerpt = (result.content || "").slice(0, 3000);
  return {
    ok: true as const,
    url: result.url,
    status: result.status,
    title: result.title,
    excerpt,
    truncated: (result.content?.length ?? 0) > excerpt.length,
  };
}

type IncomingMessage = { role: "user" | "assistant"; content: string };

// ---- Tool handlers ----------------------------------------------------------

async function completeSection1(
  userId: string,
  args: {
    messaging_channel: string;
    messaging_handle: string;
    slack_workspace_url: string | null;
    slack_channel_name: string | null;
  }
) {
  const update: Record<string, unknown> = {
    messaging_channel: args.messaging_channel,
    messaging_handle: args.messaging_handle,
    onboarding_step: 2,
    updated_at: new Date().toISOString(),
  };
  if (args.slack_workspace_url) update.slack_workspace_url = args.slack_workspace_url;
  if (args.slack_channel_name) update.slack_channel_name = args.slack_channel_name;

  const { error } = await supabaseAdmin()
    .from("rgaios_organizations")
    .update(update)
    .eq("id", userId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function saveQuestionnaireSection(
  userId: string,
  args: { section_id: string; data: Record<string, unknown> }
) {
  const section = QUESTIONNAIRE_SECTIONS.find((s) => s.id === args.section_id);
  if (!section) {
    console.error(
      `[onboarding] save_questionnaire_section: unknown section_id "${args.section_id}"`
    );
    return { ok: false, error: `Unknown section_id: ${args.section_id}` };
  }

  console.debug(
    `[onboarding] save_questionnaire_section → ${section.column} for ${userId}:`,
    args.data
  );

  // Merge with existing JSONB so partial fills accumulate.
  const { data: existing } = await supabaseAdmin()
    .from("rgaios_brand_intakes")
    .select(section.column)
    .eq("organization_id", userId)
    .maybeSingle();

  const existingData =
    ((existing as Record<string, unknown> | null)?.[section.column] as Record<string, unknown> | undefined) ?? {};
  const merged = { ...existingData, ...args.data };

  const { error } = await supabaseAdmin()
    .from("rgaios_brand_intakes")
    .upsert(
      { organization_id: userId, [section.column]: merged },
      { onConflict: "organization_id" }
    );

  if (error) {
    console.error(
      `[onboarding] save_questionnaire_section FAILED for ${section.column}:`,
      error
    );
    return { ok: false, error: error.message };
  }

  return { ok: true, merged };
}

async function generateBrandProfile(
  userId: string,
  feedback: string | null,
  onChunk?: (delta: string) => void
): Promise<{ ok: true; content: string; version: number } | { ok: false; error: string }> {
  const { data: intake } = await supabaseAdmin()
    .from("rgaios_brand_intakes")
    .select("*")
    .eq("organization_id", userId)
    .maybeSingle();

  if (!intake) return { ok: false, error: "No brand intake found for client." };

  const sections = QUESTIONNAIRE_SECTIONS.map((s) => {
    const data = (intake as Record<string, unknown>)[s.column];
    if (!data || typeof data !== "object" || Object.keys(data).length === 0)
      return null;
    return `${s.label}: ${JSON.stringify(data)}`;
  })
    .filter(Boolean)
    .join("\n\n");

  const feedbackBlock = feedback
    ? `\n\n## Client feedback to incorporate in this revision\n${feedback}\n\nRewrite the profile taking this feedback into account.`
    : "";

  const prompt = `You are a brand strategist building a comprehensive brand profile for an AI department install. Using the intake data below, produce a detailed brand profile in markdown.

Include these sections (as H2 headings):
1. Company Overview
2. Brand Identity & Voice
3. Target Audience / ICP
4. Content Strategy Framework
5. Sales Positioning
6. Competitive Landscape
7. Key Messaging Pillars
8. Recommended AI Agent Configuration

Be specific. Use their actual data, not generic templates. Write as if you are briefing the AI agents that will work for this company.${feedbackBlock}

## Intake data
${sections}`;

  let content = "";
  try {
    const provider = resolveProvider("ONBOARDING_LLM_PROVIDER");
    const result = await chatComplete({
      provider,
      system:
        "You are a brand strategist building a comprehensive brand profile.",
      messages: [{ role: "user", content: prompt }],
      maxSteps: 1,
      onTextDelta: (delta) => {
        content += delta;
        onChunk?.(delta);
      },
    });
    // For non-streaming providers (anthropic-api, anthropic-cli) onTextDelta
    // never fires; emit the final text as one delta so the chat surface
    // still receives it for rendering.
    if (!content && result.text) {
      content = result.text;
      onChunk?.(result.text);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Profile generation failed";
    return { ok: false, error: message };
  }

  if (!content.trim())
    return { ok: false, error: "Generation returned no content." };

  const { data: latest } = await supabaseAdmin()
    .from("rgaios_brand_profiles")
    .select("version")
    .eq("organization_id", userId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (latest?.version ?? 0) + 1;

  const { error } = await supabaseAdmin().from("rgaios_brand_profiles").insert({
    organization_id: userId,
    version: nextVersion,
    content,
    status: "ready",
    generated_at: Date.now(),
  });
  if (error) return { ok: false, error: error.message };

  return { ok: true, content, version: nextVersion };
}

async function approveBrandProfile(userId: string) {
  // status='ready' filter so a regen that landed mid-flight (status
  // 'generating' or already 'approved') doesn't get flipped under us.
  const { data: latest } = await supabaseAdmin()
    .from("rgaios_brand_profiles")
    .select("id, content")
    .eq("organization_id", userId)
    .eq("status", "ready")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest) return { ok: false, error: "No ready brand profile to approve." };

  const nowMs = Date.now();
  const { error: profileErr } = await supabaseAdmin()
    .from("rgaios_brand_profiles")
    .update({ status: "approved", approved_at: nowMs, approved_by: userId })
    .eq("id", latest.id);
  if (profileErr) return { ok: false, error: profileErr.message };

  // Mirror the freshly-approved brand markdown into rgaios_company_chunks
  // so chat preamble RAG can surface it. Without this, fresh clients
  // finish onboarding with a brand profile but zero corpus chunks - so
  // the company-corpus RPC returns empty hits and agents only get the
  // direct brand-profile injection (no semantic match across the rest
  // of the org's content). Best-effort.
  try {
    await mirrorBrandProfile(userId, latest.id, latest.content);
  } catch (err) {
    console.warn(
      "[approve_brand_profile] corpus mirror failed:",
      (err as Error).message,
    );
  }

  const { error: clientErr } = await supabaseAdmin()
    .from("rgaios_organizations")
    .update({ onboarding_step: 4, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (clientErr) return { ok: false, error: clientErr.message };

  try {
    const seedResult = await seedTelegramConnectionsForDefaults(userId);
    console.info(
      `[approve_brand_profile] telegram seed: seeded=${seedResult.seeded} skipped=${seedResult.skipped}`,
    );
  } catch (err) {
    console.error("[approve_brand_profile] telegram seed failed:", err);
  }

  // Kick the onboarding scrape (socials + competitors + site) in the
  // background. drainScrapeQueue is self-seeding from rgaios_brand_intakes
  // and writes terminal rows to rgaios_scrape_snapshots, which is what
  // /api/dashboard/gate's isScrapeComplete waits on. Fire-and-forget:
  // Playwright + N URLs is slow, and the dashboard gate polls until done.
  drainScrapeQueue(userId).catch((err) =>
    console.error("[approve_brand_profile] scrape kick failed:", err),
  );

  return { ok: true };
}

async function completeBrandDocsSection(userId: string) {
  const { error } = await supabaseAdmin()
    .from("rgaios_organizations")
    .update({ onboarding_step: 5, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function saveSoftwareAccess(
  userId: string,
  args: { platform: string; confirmed: boolean; notes: string | null }
) {
  const platform = SOFTWARE_ACCESS_PLATFORMS.find((p) => p.id === args.platform);
  if (!platform) return { ok: false, error: `Unknown platform: ${args.platform}` };

  console.debug(
    `[onboarding] save_software_access → ${args.platform} confirmed=${args.confirmed}`
  );

  const { error } = await supabaseAdmin().from("rgaios_software_access").upsert(
    {
      organization_id: userId,
      platform: args.platform,
      access_type: "admin",
      confirmed: args.confirmed,
      notes: args.notes,
      confirmed_at: args.confirmed ? new Date().toISOString() : null,
    },
    { onConflict: "organization_id,platform" }
  );

  if (error) {
    console.error(`[onboarding] save_software_access FAILED:`, error);
    return { ok: false, error: error.message };
  }
  return {
    ok: true,
    merged: {
      platform: platform.label,
      confirmed: args.confirmed,
      ...(args.notes ? { notes: args.notes } : {}),
    },
  };
}

async function completeSoftwareAccessSection(userId: string) {
  const { error } = await supabaseAdmin()
    .from("rgaios_organizations")
    .update({ onboarding_step: 6, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function confirmCallBooking(
  userId: string,
  args: { call_id: string; booked: boolean; notes: string | null }
) {
  const call = SCHEDULE_CALLS.find((c) => c.id === args.call_id);
  if (!call) return { ok: false, error: `Unknown call_id: ${args.call_id}` };

  console.debug(
    `[onboarding] confirm_call_booking → ${args.call_id} booked=${args.booked}`
  );

  // Try to find an existing row for this client + call to update (we don't have
  // a unique key on (client_id, title), so we match by organization_id + month + week).
  const { data: existing } = await supabaseAdmin()
    .from("rgaios_scheduled_calls")
    .select("id")
    .eq("organization_id", userId)
    .eq("month", call.month)
    .eq("week", call.week)
    .limit(1)
    .maybeSingle();

  const payload = {
    organization_id: userId,
    title: call.title,
    month: call.month,
    week: call.week,
    calendly_url: CALENDLY_BASE_URL,
    scheduled_at: args.booked ? Date.now() : null,
    notes: args.notes,
  };

  if (existing?.id) {
    const { error } = await supabaseAdmin()
      .from("rgaios_scheduled_calls")
      .update(payload)
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabaseAdmin().from("rgaios_scheduled_calls").insert(payload);
    if (error) return { ok: false, error: error.message };
  }

  return {
    ok: true,
    merged: {
      call: call.title,
      booked: args.booked,
      ...(args.notes ? { notes: args.notes } : {}),
    },
  };
}

async function completeScheduleCallsSection(userId: string) {
  const { error } = await supabaseAdmin()
    .from("rgaios_organizations")
    .update({ onboarding_step: 7, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function completeOnboarding(
  userId: string,
  transcript: IncomingMessage[]
) {
  // Flip client to active. The onboarding_completed flag is what the
  // dashboard onboarding gate (src/app/page.tsx) checks - without it
  // the user gets bounced back to /onboarding even though every section
  // and the brand profile are done.
  const { error: clientErr } = await supabaseAdmin()
    .from("rgaios_organizations")
    .update({
      onboarding_step: 8,
      onboarding_completed: true,
      status: "active",
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", userId);
  if (clientErr) return { ok: false, error: clientErr.message };

  // Persist the full conversational transcript for later reference/analysis
  const cleanTranscript = transcript
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
    )
    .map((m) => ({ role: m.role, content: m.content }));

  const { error: transcriptErr } = await supabaseAdmin()
    .from("rgaios_brand_intakes")
    .upsert(
      {
        organization_id: userId,
        full_transcript: cleanTranscript,
      },
      { onConflict: "organization_id" }
    );
  if (transcriptErr) {
    // Don't fail the whole completion over this  -  log and continue
    console.error(
      "[onboarding] transcript save failed:",
      transcriptErr.message
    );
  }

  return { ok: true, transcript_turns: cleanTranscript.length };
}

async function finalizeQuestionnaire(userId: string) {
  const nowMs = Date.now();

  const { error: intakeErr } = await supabaseAdmin()
    .from("rgaios_brand_intakes")
    .upsert(
      { organization_id: userId, submitted_at: nowMs },
      { onConflict: "organization_id" }
    );
  if (intakeErr) return { ok: false, error: intakeErr.message };

  const { error: clientErr } = await supabaseAdmin()
    .from("rgaios_organizations")
    .update({ onboarding_step: 3, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (clientErr) return { ok: false, error: clientErr.message };

  return { ok: true };
}

// ---- Route ------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId || !ctx.userId)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Provider key check happens inside the provider abstraction at call
    // time. Onboarding works with openai (OPENAI_API_KEY), anthropic-api
    // (ANTHROPIC_API_KEY), or anthropic-cli (host's Claude Max OAuth).

    // v3: onboarding chat is scoped to the active organization. orgId is
    // the primary key into the rgaios_* tables.
    const orgId = ctx.activeOrgId;
    const user = {
      id: orgId,
      name: ctx.userName,
      email: ctx.userEmail,
    };

    const { messages: incoming } = (await req.json()) as {
      messages: IncomingMessage[];
    };

    // ---- Hydrate full onboarding state from the DB ----
    const { data: client } = await supabaseAdmin()
      .from("rgaios_organizations")
      .select(
        "name, email, company, messaging_channel, messaging_handle, slack_workspace_url, slack_channel_name, onboarding_step"
      )
      .eq("id", user.id)
      .maybeSingle();

    const { data: intake } = await supabaseAdmin()
      .from("rgaios_brand_intakes")
      .select("*")
      .eq("organization_id", orgId)
      .maybeSingle();

    const { data: latestProfile } = await supabaseAdmin()
      .from("rgaios_brand_profiles")
      .select("id, version, status")
      .eq("organization_id", orgId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const section1Done = !!client?.messaging_channel;
    const questionnaireSubmitted = !!intake?.submitted_at;
    const profileGenerated = !!latestProfile;
    const profileApproved = latestProfile?.status === "approved";
    const currentStep = client?.onboarding_step ?? 1;

    // Section 6 state
    const { data: softwareAccessRows } = await supabaseAdmin()
      .from("rgaios_software_access")
      .select("platform, confirmed")
      .eq("organization_id", orgId);
    const softwarePlatformsCovered = new Set(
      (softwareAccessRows ?? []).map((r) => r.platform)
    );
    const brandDocsDone = currentStep >= 5;
    const softwareAccessDone = currentStep >= 6;

    // Section 7 state
    const { data: callRows } = await supabaseAdmin()
      .from("rgaios_scheduled_calls")
      .select("title, month, week, scheduled_at")
      .eq("organization_id", orgId);
    const bookedCallIds = new Set(
      (callRows ?? [])
        .map((r) => {
          const match = SCHEDULE_CALLS.find(
            (c) => c.month === r.month && c.week === r.week
          );
          return match?.id;
        })
        .filter(Boolean) as string[]
    );
    const scheduleCallsDone = currentStep >= 7;

    // Section 8 state
    const { data: clientDone } = await supabaseAdmin()
      .from("rgaios_organizations")
      .select("status")
      .eq("id", user.id)
      .maybeSingle();
    const onboardingDone = clientDone?.status === "active";

    // Which Section 2 sub-sections have any data, and what was captured.
    const subsectionState = QUESTIONNAIRE_SECTIONS.map((s) => {
      const data = (((intake as Record<string, unknown> | null)?.[s.column]) ?? {}) as Record<string, unknown>;
      const keys = Object.keys(data);
      return { ...s, captured: keys, saved: keys.length > 0 };
    });

    // ---- Compute the NEXT ACTION ----
    const knownLines: string[] = [];
    if (client?.name) knownLines.push(`- full_name: ${JSON.stringify(client.name)}`);
    if (client?.email) knownLines.push(`- email: ${JSON.stringify(client.email)}`);
    if (client?.company)
      knownLines.push(`- business_name: ${JSON.stringify(client.company)}`);

    let nextActionBlock = "";

    if (!section1Done) {
      nextActionBlock = `Section 1 is NOT yet complete. Your ONE and ONLY job right now is Section 1  -  ask about messaging channel (Telegram/Slack/WhatsApp), handle, then the optional Slack workspace. Do NOT ask any Section 2 questions (no timezone, no phone, no preferred_comms) until \`complete_section_1\` has been called.`;
    } else if (!questionnaireSubmitted) {
      const nextSub = subsectionState.find((s) => !s.saved);
      if (nextSub) {
        const allFields = QUESTIONNAIRE_FIELDS[nextSub.id] || [];
        const remaining = allFields.filter((f) => !nextSub.captured.includes(f));
        const captured = nextSub.captured.length
          ? `Already captured for this sub-section: ${JSON.stringify(
              (intake as Record<string, unknown> | null)?.[nextSub.column]
            )}. DO NOT re-ask any of these fields.`
          : "Nothing captured for this sub-section yet.";

        // basicInfo-specific hints: reuse anything we already have from Section 1
        // or from the client record, and skip timezone if we can derive it.
        let basicInfoHints = "";
        if (nextSub.id === "basicInfo") {
          const hints: string[] = [];
          const handle = client?.messaging_handle;
          if (
            handle &&
            client?.messaging_channel === "whatsapp" &&
            typeof handle === "string" &&
            handle.startsWith("+")
          ) {
            hints.push(
              `The client's WhatsApp handle is "${handle}"  -  that IS their phone number with country code. Do NOT ask them for a phone number; just include { phone: "${handle}" } in your basicInfo save.`
            );
          } else if (handle) {
            hints.push(
              `The client's messaging handle is "${handle}" (not a phone number). If you need a phone number, ask once.`
            );
          }
          hints.push(
            `If the client's phone number or WhatsApp handle has a country code (e.g. +64 → New Zealand → NZT, +44 → UK → GMT/BST, +61 → Australia), INFER the timezone from it and use that value WITHOUT asking. Only ask about timezone if the country has multiple zones (US, Canada, Australia, Russia, Brazil)  -  in that case ask which city or state.`
          );
          hints.push(
            `Scan the recent conversation for anything the client already said about phone, timezone, email, preferred_comms, full_name, business_name. If they already mentioned it, use that value WITHOUT asking again.`
          );
          basicInfoHints = "\n\nBasic info hints:\n- " + hints.join("\n- ");
        }

        nextActionBlock = `Section 1 is complete. The current Section 2 sub-section is "${nextSub.label}" (section_id: "${nextSub.id}"). ${captured} Remaining fields to ask about: ${
          remaining.length ? remaining.join(", ") : "(all basic fields covered  -  wrap up with a short extra question if useful, then save)."
        }. Once you have enough, call \`save_questionnaire_section({section_id: "${nextSub.id}", data: {...}})\`. Pass ONLY the new fields you captured in this turn  -  existing data will be merged server-side.${basicInfoHints}`;
      } else {
        nextActionBlock = `All 13 Section 2 sub-sections are saved but \`finalize_questionnaire\` hasn't been called. Call it now  -  the brand profile will be auto-generated.`;
      }
    } else if (!profileGenerated) {
      nextActionBlock = `Questionnaire is submitted but the brand profile hasn't been generated. This is unexpected  -  call \`generate_brand_profile({ feedback: null })\` to recover.`;
    } else if (!profileApproved) {
      nextActionBlock = `Brand profile v${latestProfile?.version} is rendered and waiting on the client's decision. If they approve → call \`approve_brand_profile\`. If they ask for changes → call \`generate_brand_profile({ feedback: "<their exact words>" })\`.`;
    } else if (!brandDocsDone) {
      // Section 3.5  -  Telegram connector (only when messaging_channel = telegram).
      // The connector renders AFTER approve_brand_profile (which seeds the
      // pending bot slots) and BEFORE the brand-docs uploader. We detect
      // its lifecycle by scanning the wire transcript: assistant text
      // mentions "Telegram bots" / "BotFather" once we've shown it, and
      // the user replies with a "Connected Telegram for ..." or
      // "No Telegram bots connected" canned summary from
      // TelegramConnectorBlock when they hit Continue.
      const isTelegramClient = client?.messaging_channel === "telegram";
      const telegramConnectorShown = incoming.some(
        (m) =>
          m.role === "assistant" &&
          typeof m.content === "string" &&
          /BotFather|Telegram bots wired|Telegram connector/i.test(m.content),
      );
      const telegramConnectorReplied = incoming.some(
        (m) =>
          m.role === "user" &&
          typeof m.content === "string" &&
          /^(Connected Telegram for|No Telegram bots connected)/i.test(
            m.content.trim(),
          ),
      );

      if (isTelegramClient && !telegramConnectorReplied) {
        if (!telegramConnectorShown) {
          nextActionBlock = `You are in Section 3.5 (Telegram bot connection). The client picked Telegram in Section 1, so they need to wire up at least one Department Head bot before we move on. Call \`open_telegram_connector\` IMMEDIATELY. Do NOT write any text - the system handles the transition line. Do NOT call \`show_brand_docs_uploader\` yet.`;
        } else {
          nextActionBlock = `You are in Section 3.5. The Telegram connector is already visible to the client. Wait silently for them to either connect bots or hit Continue. When their canned summary message arrives ("Connected Telegram for ..." or "No Telegram bots connected ..."), write ONE short acknowledgement (1-2 sentences max, name which bots are live or note none) and then IMMEDIATELY call \`show_brand_docs_uploader\` to start Section 4. Do NOT call \`open_telegram_connector\` again.`;
        }
      } else {
        // Section 4  -  brand documents
        const { data: docs } = await supabaseAdmin()
          .from("rgaios_onboarding_documents")
          .select("id, type, filename")
          .eq("organization_id", orgId);
        const uploadCount = docs?.length ?? 0;
        const uploaderShown = incoming.some(
          (m) =>
            m.role === "assistant" &&
            typeof m.content === "string" &&
            /upload|drag|drop/i.test(m.content)
        );
        if (!uploaderShown && uploadCount === 0) {
          nextActionBlock = `You are in Section 4 (Brand Documents). Say ONE short inviting sentence asking them to drop in logos, brand guidelines, or other assets. Then IMMEDIATELY call \`show_brand_docs_uploader\`. Do NOT describe the widget.`;
        } else {
          nextActionBlock = `You are in Section 4. The uploader is already visible to the client. They have uploaded ${uploadCount} file(s) so far${uploadCount ? `: ${docs!.map((d: { filename: string }) => d.filename).join(", ")}` : ""}. Wait for them to say they're done (or indicate they have nothing). When they do, call \`complete_brand_docs_section\`. Do NOT call \`show_brand_docs_uploader\` again.`;
        }
      }
    } else if (!softwareAccessDone) {
      // Section 6  -  find next platform to ask about
      const nextPlatform = SOFTWARE_ACCESS_PLATFORMS.find(
        (p) => !softwarePlatformsCovered.has(p.id)
      );
      if (nextPlatform) {
        nextActionBlock = `You are in Section 6. Platforms already covered: ${
          [...softwarePlatformsCovered].join(", ") || "none"
        }. Next platform to ask about: "${nextPlatform.label}" (platform id: "${nextPlatform.id}"). Ask if they've added chris@rawgrowth.ai there. When they answer, call \`save_software_access({ platform: "${nextPlatform.id}", confirmed: <true|false>, notes: <null or short reason> })\`.`;
      } else {
        nextActionBlock = `All 6 software platforms have been covered (${[...softwarePlatformsCovered].join(", ")}). Call \`complete_software_access_section\` now.`;
      }
    } else if (!scheduleCallsDone) {
      // Section 7  -  find next call to ask about
      const nextCall = SCHEDULE_CALLS.find((c) => !bookedCallIds.has(c.id));
      if (nextCall) {
        nextActionBlock = `You are in Section 7. Calls already handled: ${
          [...bookedCallIds].join(", ") || "none"
        }. Next call to present: "${nextCall.title}" (call_id: "${nextCall.id}"). Share the Calendly link as a markdown link \`[Book ${nextCall.title}](${CALENDLY_BASE_URL})\` and ask them to book it. When they respond, call \`confirm_call_booking({ call_id: "${nextCall.id}", booked: <true|false>, notes: <null or short reason> })\`.`;
      } else {
        nextActionBlock = `All 4 milestone calls have been covered. Call \`complete_schedule_calls_section\` now.`;
      }
    } else if (!onboardingDone) {
      nextActionBlock = `Sections 1–7 are complete. Call \`complete_onboarding\` now, then write a short warm congratulations (3–4 sentences).`;
    } else {
      nextActionBlock = `Onboarding is fully complete. If the client says anything further, respond warmly and briefly.`;
    }

    const contextPrompt = `\n\n------------------------------------------------------------\nALREADY KNOWN (from the clients record)  -  do NOT ask these again\n------------------------------------------------------------\n${
      knownLines.length ? knownLines.join("\n") : "(nothing yet)"
    }\n\nWhen you call \`save_questionnaire_section\` for \`basicInfo\`, automatically include \`full_name\`, \`business_name\`, and \`email\` from the known list alongside any NEW fields the client gives you (\`phone\`, \`timezone\`, \`preferred_comms\`). Messaging preferences are NOT already known  -  you still ask about them in Section 1.\n\n------------------------------------------------------------\nNEXT ACTION  -  follow this exactly\n------------------------------------------------------------\n${nextActionBlock}\n`;

    // Only user/assistant roles go to the model. Defensive: drop anything
    // else (reasoning bubbles, uploader placeholders) and empty-content rows.
    const safeIncoming = incoming.filter(
      (m): m is IncomingMessage =>
        !!m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof (m as { content?: unknown }).content === "string" &&
        ((m as { content: string }).content).trim().length > 0
    );

    // Provider-agnostic conversation buffer. After each tool-using step we
    // fold the assistant's tool calls + the local tool results into a pair
    // of synthetic messages so any backend (openai / anthropic-api /
    // anthropic-cli) sees the same turn shape on the next step.
    const messages: ChatMessage[] = safeIncoming.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const systemBlock = SYSTEM_PROMPT + contextPrompt;

    // Provider preference: env override wins. Otherwise auto-pick:
    //   - if Claude Max OAuth is connected for this org -> claude-max-oauth
    //     (no OPENAI_API_KEY needed, fastest path on Vercel hobby)
    //   - else fall back to whatever resolveProvider returns (defaults openai)
    const envOverride = process.env.ONBOARDING_LLM_PROVIDER;
    let provider = envOverride
      ? resolveProvider("ONBOARDING_LLM_PROVIDER")
      : resolveProvider();
    let claudeMaxOauthToken: string | undefined;
    if (!envOverride) {
      // Try Claude Max first
      try {
        const { tryDecryptSecret } = await import("@/lib/crypto");
        const { data: conn } = await supabaseAdmin()
          .from("rgaios_connections")
          .select("metadata")
          .eq("organization_id", user.id)
          .eq("provider_config_key", "claude-max")
          .maybeSingle();
        const meta = (conn?.metadata ?? {}) as { access_token?: string };
        const tok = tryDecryptSecret(meta.access_token);
        if (tok) {
          provider = "claude-max-oauth";
          claudeMaxOauthToken = tok;
        }
      } catch {}
    }

    // Local refresh helper. Mirrors tryRefreshClaudeMaxToken in
    // src/lib/agent/chat.ts so onboarding chat survives the same
    // expired-access-token case Atlas chat already handles.
    async function refreshClaudeMaxToken(orgId: string): Promise<string | null> {
      try {
        const { encryptSecret, tryDecryptSecret } = await import("@/lib/crypto");
        const { refreshClaudeMaxAccessToken } = await import("@/lib/agent/oauth");
        const { data } = await supabaseAdmin()
          .from("rgaios_connections")
          .select("metadata")
          .eq("organization_id", orgId)
          .eq("provider_config_key", "claude-max")
          .maybeSingle();
        if (!data) return null;
        const meta = (data.metadata ?? {}) as {
          access_token?: string;
          refresh_token?: string;
        };
        const currentRefresh = tryDecryptSecret(meta.refresh_token);
        if (!currentRefresh) return null;
        const r = await refreshClaudeMaxAccessToken(currentRefresh);
        if (!r.ok) {
          console.warn(`[onboarding-chat] refresh failed: ${r.error.slice(0, 200)}`);
          return null;
        }
        await supabaseAdmin()
          .from("rgaios_connections")
          .update({
            metadata: {
              ...meta,
              access_token: encryptSecret(r.access_token),
              refresh_token: r.refresh_token
                ? encryptSecret(r.refresh_token)
                : (meta.refresh_token ?? ""),
              expires_in: r.expires_in ?? null,
              installed_at: new Date().toISOString(),
            },
          } as never)
          .eq("organization_id", orgId)
          .eq("provider_config_key", "claude-max");
        return r.access_token;
      } catch (e) {
        console.warn(`[onboarding-chat] refresh threw: ${(e as Error).message}`);
        return null;
      }
    }
    const oauthModel = "claude-sonnet-4-6";
    const openaiModel = "gpt-4o";
    const gatewayModel = "anthropic/claude-sonnet-4.6";

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        };

        console.log(
          `[onboarding-chat] start org=${user.id} provider=${provider} hasClaudeMax=${!!claudeMaxOauthToken} hasOpenAI=${!!process.env.OPENAI_API_KEY} hasAnthropic=${!!process.env.ANTHROPIC_API_KEY}`,
        );
        emit({
          type: "debug",
          marker: "v3-heartbeat",
          provider,
          hasClaudeMax: !!claudeMaxOauthToken,
          hasOpenAI: !!process.env.OPENAI_API_KEY,
          hasAnthropic: !!process.env.ANTHROPIC_API_KEY,
        });


        try {
          for (let iter = 0; iter < 6; iter++) {
            // Track whether the provider streamed any token via onTextDelta.
            // anthropic-cli returns the whole text after the subprocess
            // finishes (no incremental stream); without this flag the loop
            // would break with the model's reply visible only in step.text
            // and never reaching the client.
            let streamedAny = false;
            emit({
              type: "debug",
              phase: "calling-chatComplete",
              iter,
              tokenLen: claudeMaxOauthToken?.length ?? 0,
              model: provider === "claude-max-oauth" ? oauthModel : openaiModel,
              systemLen: systemBlock.length,
              msgsLen: messages.length,
              toolsLen: TOOLS.length,
            });

            // Vercel egress + intermediary proxies are aggressive about
            // closing idle streams. Anthropic OAuth /v1/messages is
            // non-streaming (fire and collect) and routinely takes 5-30s
            // on a tools-heavy prompt. Without a periodic heartbeat the
            // upstream tears the connection between us and the client at
            // ~3s of silence, the consumer sees a silent EOF, and the
            // model reply is lost. Tick every second.
            const heartbeat = setInterval(() => {
              try {
                emit({ type: "debug", phase: "wait-tick" });
              } catch {}
            }, 1000);

            let step;
            const callChat = async (
              providerOverride?: typeof provider,
              modelOverride?: string,
            ) =>
              chatComplete({
                provider: providerOverride ?? provider,
                model:
                  modelOverride ??
                  ((providerOverride ?? provider) === "claude-max-oauth"
                    ? oauthModel
                    : (providerOverride ?? provider) === "vercel-gateway"
                      ? gatewayModel
                      : openaiModel),
                system: systemBlock,
                messages,
                tools: TOOLS,
                temperature: 0.3,
                maxSteps: 1,
                claudeMaxOauthToken,
                organizationId: user.id,
                onTextDelta: (delta) => {
                  streamedAny = true;
                  emit({ type: "text", delta });
                },
              });

            // Build fallback chain. Claude Max OAuth is primary; on
            // 429 (Pedro's pool saturated by concurrent CLI sessions)
            // try the next provider that's actually configured. Each
            // attempt is logged so the bell shows what fired.
            const fallbacks: Array<{ p: typeof provider; reason: string }> = [];
            if (provider === "claude-max-oauth") {
              if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) {
                fallbacks.push({ p: "vercel-gateway", reason: "gateway available" });
              }
              if (process.env.ANTHROPIC_API_KEY) {
                fallbacks.push({ p: "anthropic-api", reason: "anthropic-api key set" });
              }
              if (process.env.OPENAI_API_KEY) {
                fallbacks.push({ p: "openai", reason: "openai key set" });
              }
            }

            try {
              try {
                step = await callChat();
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                // 401: silent refresh on claude-max (token rotated on
                // host without updating the DB row).
                if (provider === "claude-max-oauth" && msg.includes("401")) {
                  console.warn(`[onboarding-chat] 401 from claude-max, attempting refresh`);
                  const fresh = await refreshClaudeMaxToken(user.id);
                  if (fresh) {
                    claudeMaxOauthToken = fresh;
                    step = await callChat();
                  } else {
                    throw e;
                  }
                } else if (msg.includes("429") && fallbacks.length > 0) {
                  // 429: walk the fallback chain. Stop at the first one
                  // that returns text. Emits a debug event per attempt so
                  // the operator can see why we ended up where we did.
                  console.warn(`[onboarding-chat] 429 on ${provider}, trying ${fallbacks.length} fallback(s)`);
                  let fallbackErr = e;
                  for (const f of fallbacks) {
                    try {
                      emit({ type: "debug", phase: "fallback", to: f.p, reason: f.reason });
                      step = await callChat(f.p);
                      console.warn(`[onboarding-chat] fallback ${f.p} succeeded`);
                      break;
                    } catch (fe) {
                      const fmsg = fe instanceof Error ? fe.message : String(fe);
                      console.warn(`[onboarding-chat] fallback ${f.p} failed: ${fmsg.slice(0, 120)}`);
                      fallbackErr = fe;
                    }
                  }
                  if (!step) throw fallbackErr;
                } else {
                  throw e;
                }
              }
            } catch (err) {
              clearInterval(heartbeat);
              const raw = err instanceof Error ? err.message : String(err);
              console.error(`[onboarding-chat] chatComplete THREW: ${raw}`);
              // Surface a friendly message for known failure modes so
              // the operator knows what to do instead of staring at a
              // dead chat. Re-throw so the outer try/catch closes the
              // stream cleanly.
              const friendly = raw.includes("429")
                ? "Your Claude Max account is rate-limited right now. Wait a few minutes (or close other Claude sessions) and try again."
                : raw.includes("401")
                  ? "Claude Max session expired - reconnect at /connections."
                  : raw.includes("model")
                    ? `Model error: ${raw}`
                    : null;
              try {
                emit({
                  type: "error",
                  message: friendly ?? raw,
                  raw: friendly ? raw : undefined,
                });
              } catch {}
              throw err;
            }
            clearInterval(heartbeat);
            emit({
              type: "debug",
              phase: "chatComplete-returned",
              iter,
              textLenReturned: step.text.length,
              toolCallsReturned: step.toolCalls.length,
              streamedAny,
              textPreview: step.text.slice(0, 300),
            });

            const textContent = step.text;
            const toolCalls = step.toolCalls;

            console.log(
              `[onboarding-chat] iter=${iter} textLen=${textContent.length} toolCalls=${toolCalls.length} streamed=${streamedAny}`,
            );
            emit({
              type: "debug",
              iter,
              textLen: textContent.length,
              toolCalls: toolCalls.length,
              streamed: streamedAny,
              textPreview: textContent.slice(0, 200),
            });

            // Flush text from non-streaming providers (anthropic-cli) as a
            // single delta so the chat UI renders it like the streamed path.
            if (!streamedAny && textContent.trim()) {
              emit({ type: "text", delta: textContent });
            }

            if (toolCalls.length === 0) break;

            // Fold the assistant turn (text + tool-call summary) so the next
            // step's model sees what we just did. We use a single combined
            // assistant message because the user/assistant-only contract
            // can't carry the OpenAI-native `tool_calls` field.
            const assistantSummary = [
              textContent.trim(),
              ...toolCalls.map(
                (tc) =>
                  `[tool_call] ${tc.name}(${JSON.stringify(tc.input)})`,
              ),
            ]
              .filter(Boolean)
              .join("\n");
            messages.push({ role: "assistant", content: assistantSummary });

            for (const tc of toolCalls) {
              type ToolResult = {
                ok: boolean;
                error?: string;
                merged?: Record<string, unknown>;
                note?: string;
                brand_profile_generated?: boolean;
              };
              let result: ToolResult = { ok: false };
              let label: string | null = null;
              console.debug(
                `[onboarding] tool call → ${tc.name}`,
                JSON.stringify(tc.input),
              );

              // Derive a human-readable label for the reasoning bubble.
              const parsedForReasoning: Record<string, unknown> = (tc.input as Record<string, unknown>) ?? {};
              let reasoningLabel = "Processing";
              if (tc.name === "complete_section_1") {
                reasoningLabel = "Extracting your communication preferences";
              } else if (tc.name === "save_questionnaire_section") {
                const sec = QUESTIONNAIRE_SECTIONS.find(
                  (s) => s.id === parsedForReasoning.section_id
                );
                reasoningLabel = `Extracting your ${String(sec?.label ?? parsedForReasoning.section_id ?? "answers").toLowerCase()}`;
              } else if (tc.name === "finalize_questionnaire") {
                reasoningLabel = "Finalising your questionnaire";
              } else if (tc.name === "generate_brand_profile") {
                reasoningLabel = "Drafting your brand profile";
              } else if (tc.name === "approve_brand_profile") {
                reasoningLabel = "Approving your brand profile";
              } else if (tc.name === "show_brand_docs_uploader") {
                reasoningLabel = "Opening the upload panel";
              } else if (tc.name === "open_telegram_connector") {
                reasoningLabel = "Opening the Telegram connector";
              } else if (tc.name === "open_integration_connector") {
                const prov =
                  typeof parsedForReasoning.provider === "string"
                    ? parsedForReasoning.provider
                    : "integration";
                reasoningLabel = `Opening the ${prov} connector`;
              } else if (tc.name === "complete_brand_docs_section") {
                reasoningLabel = "Locking in your brand documents";
              } else if (tc.name === "save_software_access") {
                const plat = SOFTWARE_ACCESS_PLATFORMS.find(
                  (p) => p.id === parsedForReasoning.platform
                );
                reasoningLabel = `Recording access for ${(plat?.label ?? parsedForReasoning.platform ?? "platform").toString()}`;
              } else if (tc.name === "complete_software_access_section") {
                reasoningLabel = "Locking in software access";
              } else if (tc.name === "confirm_call_booking") {
                const call = SCHEDULE_CALLS.find(
                  (c) => c.id === parsedForReasoning.call_id
                );
                reasoningLabel = `Logging ${(call?.title ?? parsedForReasoning.call_id ?? "call").toString()}`;
              } else if (tc.name === "complete_schedule_calls_section") {
                reasoningLabel = "Locking in milestone calls";
              } else if (tc.name === "complete_onboarding") {
                reasoningLabel = "Finalising your onboarding";
              } else if (tc.name === "scrape_url") {
                const rawUrl =
                  typeof parsedForReasoning.url === "string"
                    ? parsedForReasoning.url
                    : "";
                let host = rawUrl;
                try {
                  host = new URL(
                    /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`,
                  ).hostname;
                } catch {}
                reasoningLabel = host ? `Scanning ${host}` : "Scanning URL";
              }
              const reasoningId =
                (globalThis.crypto?.randomUUID?.() as string) ||
                `r_${Date.now()}_${Math.random()}`;
              emit({
                type: "reasoning",
                status: "thinking",
                id: reasoningId,
                label: reasoningLabel,
              });

              try {
                // Tool argument shapes are validated by the model schema.
                // Cast through unknown for each handler's specific arg type.
                const parsed = parsedForReasoning as never as {
                  messaging_channel: string;
                  messaging_handle: string;
                  slack_workspace_url: string | null;
                  slack_channel_name: string | null;
                  section_id: string;
                  data: Record<string, unknown>;
                  feedback?: string | null;
                  platform: string;
                  confirmed: boolean;
                  notes: string | null;
                  call_id: string;
                  booked: boolean;
                };
                if (tc.name === "complete_section_1") {
                  result = await completeSection1(user.id, parsed);
                  label = "Communication preferences";
                } else if (tc.name === "save_questionnaire_section") {
                  result = await saveQuestionnaireSection(user.id, parsed);
                  const section = QUESTIONNAIRE_SECTIONS.find(
                    (s) => s.id === parsed.section_id
                  );
                  label = section?.label ?? parsed.section_id;
                } else if (tc.name === "finalize_questionnaire") {
                  result = await finalizeQuestionnaire(user.id);
                  label = "Questionnaire submitted";

                  // Auto-chain: generate the brand profile immediately, streaming
                  // the markdown into the chat. This guarantees it happens even if
                  // the model forgets to call generate_brand_profile next.
                  if (result.ok) {
                    emit({
                      type: "text",
                      delta:
                        "\n\nGenerating your brand profile now  -  this takes 20–30 seconds.\n\n",
                    });
                    const genResult = await generateBrandProfile(
                      user.id,
                      null,
                      (delta) => emit({ type: "text", delta })
                    );
                    if (genResult.ok) {
                      emit({ type: "text", delta: "\n\n" });
                      result = {
                        ok: true,
                        brand_profile_generated: true,
                        note: "Questionnaire is saved and the brand profile has been rendered to the user. DO NOT repeat the profile text. Write ONE short message (2–3 sentences) asking them to approve or suggest changes, and remind them they can edit the profile later from their dashboard.",
                      };
                      label = "Brand profile generated";
                    } else {
                      emit({
                        type: "error",
                        message: `Brand profile generation failed: ${genResult.error}`,
                      });
                      result = {
                        ok: false,
                        error: `Brand profile generation failed: ${genResult.error}`,
                      };
                    }
                  }
                } else if (tc.name === "generate_brand_profile") {
                  // Used for regeneration after client feedback.
                  emit({
                    type: "text",
                    delta:
                      "\n\nRegenerating with your feedback  -  one moment.\n\n",
                  });
                  const genResult = await generateBrandProfile(
                    user.id,
                    parsed.feedback ?? null,
                    (delta) => emit({ type: "text", delta })
                  );
                  if (genResult.ok) {
                    emit({ type: "text", delta: "\n\n" });
                    result = {
                      ok: true,
                      note: "The regenerated brand profile has been rendered. DO NOT repeat its content. Ask if this version works or if they'd like another round of changes. Remind them the profile can be edited later from their dashboard.",
                    };
                    label = `Brand profile v${genResult.version}`;
                  } else {
                    emit({ type: "error", message: genResult.error });
                    result = { ok: false, error: genResult.error };
                  }
                } else if (tc.name === "approve_brand_profile") {
                  result = await approveBrandProfile(user.id);
                  label = "Brand profile approved";
                  // Auto-chain so the model can't stall after approval.
                  // Telegram clients land on the inline bot connector first
                  // (Section 3.5); Slack/WhatsApp clients skip straight to
                  // the brand-docs uploader (Section 4).
                  if (result.ok) {
                    if (client?.messaging_channel === "telegram") {
                      emit({
                        type: "text",
                        delta:
                          "\n\nLocked in. Let's get your Telegram bots wired up before we move on - paste a BotFather token for any Department Head you want live now, or skip and wire them later.\n\n",
                      });
                      emit({ type: "telegram_connector" });
                      result = {
                        ok: true,
                        note: "Brand profile approved AND the Telegram connector has been shown. Do NOT write any more text. Stop immediately and wait for the next user message.",
                      };
                    } else {
                      emit({
                        type: "text",
                        delta:
                          "\n\nLocked in. Drop in any logos, brand guidelines, or other assets below  -  or skip if you don't have any yet.\n\n",
                      });
                      emit({ type: "brand_docs_uploader" });
                      result = {
                        ok: true,
                        note: "Brand profile approved AND the brand-docs uploader has been shown. Do NOT write any more text. Stop immediately and wait for the next user message.",
                      };
                    }
                  }
                } else if (tc.name === "open_telegram_connector") {
                  emit({ type: "telegram_connector" });
                  result = {
                    ok: true,
                    note: "Telegram connector has been rendered to the client. Wait for their next message before doing anything else.",
                  };
                  label = "Telegram connector shown";
                } else if (tc.name === "open_integration_connector") {
                  const allowed = new Set([
                    "slack",
                    "hubspot",
                    "google-drive",
                    "gmail",
                  ]);
                  const input = (tc.input ?? {}) as Record<string, unknown>;
                  const provider =
                    typeof input.provider === "string" ? input.provider : "";
                  if (!allowed.has(provider)) {
                    result = {
                      ok: false,
                      error: `unknown provider '${provider}' - allowed: slack, hubspot, google-drive, gmail`,
                    };
                  } else {
                    emit({ type: "integration_connector", provider });
                    result = {
                      ok: true,
                      note: `Integration connector for ${provider} has been rendered. Wait silently for the OAuth round-trip; the client will type a continue message when done.`,
                    };
                    label = `Integration connector shown (${provider})`;
                  }
                } else if (tc.name === "show_brand_docs_uploader") {
                  emit({ type: "brand_docs_uploader" });
                  result = {
                    ok: true,
                    note: "Uploader has been rendered to the client. Wait for their next message before doing anything else.",
                  };
                  label = "Uploader shown";
                } else if (tc.name === "complete_brand_docs_section") {
                  result = await completeBrandDocsSection(user.id);
                  label = "Brand documents done";
                } else if (tc.name === "save_software_access") {
                  result = await saveSoftwareAccess(user.id, parsed);
                  const plat = SOFTWARE_ACCESS_PLATFORMS.find(
                    (p) => p.id === parsed.platform
                  );
                  label = plat?.label ?? parsed.platform;
                } else if (tc.name === "complete_software_access_section") {
                  result = await completeSoftwareAccessSection(user.id);
                  label = "Software access complete";
                } else if (tc.name === "confirm_call_booking") {
                  result = await confirmCallBooking(user.id, parsed);
                  const call = SCHEDULE_CALLS.find(
                    (c) => c.id === parsed.call_id
                  );
                  label = call?.title ?? parsed.call_id;
                } else if (tc.name === "complete_schedule_calls_section") {
                  result = await completeScheduleCallsSection(user.id);
                  label = "Milestone calls scheduled";
                } else if (tc.name === "scrape_url") {
                  const rawUrl =
                    typeof parsedForReasoning.url === "string"
                      ? parsedForReasoning.url
                      : "";
                  const scrape = await scrapeUrlForChat(rawUrl);
                  // Cast through a permissive shape - the tool result schema
                  // is wider than ToolResult's typed slots; the model just
                  // sees the JSON payload.
                  result = scrape as unknown as ToolResult;
                  let host = rawUrl;
                  try {
                    host = new URL(
                      /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`,
                    ).hostname;
                  } catch {}
                  label = host ? `Scraped ${host}` : "Scraped URL";
                } else if (tc.name === "complete_onboarding") {
                  result = await completeOnboarding(user.id, incoming);
                  label = "Onboarding complete";
                  if (result.ok) {
                    emit({ type: "celebrate" });
                    emit({ type: "portal_button" });
                    result = {
                      ok: true,
                      note: "Onboarding finalized. Write ONE short congratulatory sentence (e.g. 'You're all set  -  welcome to Rawgrowth.'). The Continue to Portal button is already rendered for them. Do NOT describe it.",
                    };
                  }
                } else {
                  result = { ok: false, error: `Unknown tool: ${tc.name}` };
                }
              } catch (err: unknown) {
                const message = err instanceof Error ? err.message : "Tool error";
                result = { ok: false, error: message };
              }

              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify(result),
              });

              // Close out the reasoning bubble with the extracted fields
              if (result?.ok) {
                let fields: Record<string, unknown> | undefined;
                if (tc.name === "save_questionnaire_section" && result.merged) {
                  fields = result.merged;
                } else if (tc.name === "complete_section_1") {
                  fields = {
                    messaging_channel: parsedForReasoning.messaging_channel,
                    messaging_handle: parsedForReasoning.messaging_handle,
                    ...(parsedForReasoning.slack_workspace_url
                      ? { slack_workspace_url: parsedForReasoning.slack_workspace_url }
                      : {}),
                    ...(parsedForReasoning.slack_channel_name
                      ? { slack_channel_name: parsedForReasoning.slack_channel_name }
                      : {}),
                  };
                } else if (tc.name === "scrape_url") {
                  const r = result as unknown as {
                    url?: string;
                    title?: string | null;
                    excerpt?: string;
                    status?: number;
                  };
                  fields = {
                    url: r.url ?? parsedForReasoning.url,
                    ...(r.title ? { title: r.title } : {}),
                    ...(r.status ? { status: r.status } : {}),
                    ...(r.excerpt
                      ? {
                          excerpt:
                            r.excerpt.length > 220
                              ? `${r.excerpt.slice(0, 220)}…`
                              : r.excerpt,
                        }
                      : {}),
                  };
                }
                const doneLabel = reasoningLabel
                  .replace(/^Extracting/, "Saved")
                  .replace(/^Drafting/, "Drafted")
                  .replace(/^Finalising your questionnaire/, "Questionnaire submitted")
                  .replace(/^Finalising your onboarding/, "Onboarding complete")
                  .replace(/^Approving/, "Approved")
                  .replace(/^Recording access for /, "Access recorded for ")
                  .replace(/^Logging /, "Booked ")
                  .replace(/^Locking in software access/, "Software access locked in")
                  .replace(/^Locking in milestone calls/, "Calls locked in")
                  .replace(/^Locking in your brand documents/, "Brand documents locked in")
                  .replace(/^Opening the upload panel/, "Upload panel opened")
                  .replace(/^Opening the Telegram connector/, "Telegram connector opened")
                  .replace(/^Scanning /, "Scanned ");
                emit({
                  type: "reasoning",
                  status: "done",
                  id: reasoningId,
                  label: doneLabel,
                  fields,
                });

                const progress = await computeOnboardingProgress(user.id);
                emit({
                  type: "progress",
                  current: progress.current,
                  total: progress.total,
                  completed: progress.completed,
                  label,
                });
              } else {
                emit({
                  type: "reasoning",
                  status: "error",
                  id: reasoningId,
                  label: reasoningLabel,
                  error: result?.error,
                });
              }
            }
          }
          try {
            emit({ type: "debug", phase: "loop-finished-cleanly" });
          } catch {}
          controller.close();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Stream error";
          const stack = err instanceof Error ? err.stack : "";
          console.error(`[onboarding-chat] OUTER catch: ${message}\n${stack}`);
          try {
            emit({
              type: "error",
              message,
              stack: stack?.slice(0, 800),
              phase: "outer-catch",
            });
          } catch {}
          // Use close() instead of error() so any queued emits flush
          // out to the client before the stream EOFs.
          try {
            controller.close();
          } catch {
            controller.error(err);
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// satisfy Next's expectation that the module has exports
export const dynamic = "force-dynamic";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _TOTAL = TOTAL_ONBOARDING_STEPS;
