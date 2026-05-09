/**
 * Seed rgaios_onboarding_knowledge with the section playbooks and per-tool
 * long descriptions extracted from src/app/api/onboarding/chat/route.ts.
 *
 * Why a separate script: the route ships a slim ~2kb SYSTEM_PROMPT now;
 * the bulky per-section guidance and per-tool documentation live here in
 * the DB and get retrieved by embedding similarity each turn. Cuts the
 * onboarding chat input tokens dramatically and dodges Anthropic's
 * per-minute input rate limit.
 *
 * Usage:
 *   DATABASE_URL=postgres://... tsx scripts/seed-onboarding-knowledge.ts
 *
 * Re-runnable: truncates rgaios_onboarding_knowledge first, then
 * re-embeds and re-inserts every chunk so an edited section/tool description
 * gets picked up on the next deploy without leaking stale rows.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { FlagEmbedding, EmbeddingModel } from "fastembed";
import { tmpdir } from "node:os";
import path from "node:path";

// Allow running outside Next; load .env if dotenv is around, else fall
// through to whatever is already in process.env.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv/config");
} catch {
  // optional; CI sets env directly
}

// ---- Source of truth for section playbooks ---------------------------------
// Each entry is the long-form playbook for one section that USED to live
// inside SYSTEM_PROMPT in the route. Splitting them out is what makes the
// route prompt slim. Keep these terse but informative - they get injected
// into the model context only when retrieval picks them.

type Chunk = {
  kind: "section_instruction" | "tool_description" | "rule";
  sectionId: string | null;
  content: string;
};

const SECTION_CHUNKS: Chunk[] = [
  {
    kind: "section_instruction",
    sectionId: "section_1",
    content: `SECTION 1 - Communication preferences. This section captures ONLY four values: messaging_channel (telegram/slack/whatsapp), messaging_handle (their handle for that channel - @username, workspace.slack.com, or phone with country code), slack_workspace_url (optional), slack_channel_name (optional).

FORBIDDEN in Section 1 (these are Section 2 basicInfo fields - ask LATER): phone (standalone; "phone with country code" ONLY when it's the WhatsApp handle), timezone, preferred_comms / preferred communication method, email, full name, business name.

Ask in order (one question per turn, acknowledge each answer first):
1. Which messaging channel - Telegram, Slack, or WhatsApp?
2. Their handle for that channel.
3. "Do you have a Slack workspace you'd like to connect too?" YES then ask workspace URL, then channel name. NO then acknowledge briefly, do NOT ask further Slack questions.

EXTRACTION SHORTCUT (CRITICAL): if the user's reply contains BOTH a channel name (telegram/slack/whatsapp) AND a handle (anything starting with @, an email, a URL, or a +country phone) in the SAME message, immediately call complete_section_1 in this turn with the extracted values. Examples that MUST trigger an immediate tool call (no follow-up question): "telegram, my handle is @chrisacme" then channel=telegram, handle=@chrisacme. "use slack, workspace.slack.com #general" then channel=slack, handle=workspace.slack.com. "whatsapp +5511999990001" then channel=whatsapp, handle=+5511999990001. "tg @founder" then channel=telegram, handle=@founder.

Do NOT re-ask "which messaging channel?" if the user already named one. Treat synonyms (tg, telegram, slack, sl, whatsapp, wa) as the same channel.

Once you have those four values, call complete_section_1. Pass slack_workspace_url/slack_channel_name as null if they declined. IMMEDIATELY after the tool returns, proceed to Section 2. Do NOT say "section 1 done" or "let's move on".`,
  },
  {
    kind: "section_instruction",
    sectionId: "section_2",
    content: `SECTION 2 - Brand Questionnaire (13 sub-sections). Walk through each sub-section in order. For each: ask conversationally, grouping 1-3 related questions per turn. Don't force every field, accept what the client volunteers. Once you have enough for that sub-section, call save_questionnaire_section({section_id, data}) with only the fields you've actually captured. Then IMMEDIATELY ask the first question of the next sub-section. Never announce boundaries.

Sub-sections (in order) and field names:
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

After save_questionnaire_section for additionalContext (the final sub-section), call finalize_questionnaire. The system AUTOMATICALLY generates the brand profile and streams it - you do NOT need to call generate_brand_profile for the initial version.

URL-AWARE EXTRACTION: whenever the client volunteers a URL (their website, a social handle URL, a competitor's site, an inspiration page), call scrape_url({ url }) BEFORE asking the next question. The tool returns the page title and a short text excerpt. Use that to pre-fill obvious fields, ask sharper follow-ups, and gently confirm what you found ("Looks like you sell X - is that still the main offer?") rather than re-asking for info on the page. Only call scrape_url for HTTP(S) URLs the client actually shared. One call per URL per conversation. If the result is blocked/errored, just continue conversationally.`,
  },
  {
    kind: "section_instruction",
    sectionId: "section_3",
    content: `SECTION 3 - Brand Profile. This section does NOT ask the client any questions. The brand profile is generated from their questionnaire data.

Flow:
1. You call finalize_questionnaire. The system handles status messaging and streams the generated markdown profile into the chat automatically.
2. After the finalize_questionnaire tool result returns (it will say brand_profile_generated: true on success), write ONE short message (2-3 sentences) that asks them to review the profile above, tells them to reply "approve" if it looks right or describe changes they'd like, and mentions they can edit it later from their dashboard.
3. Wait for their response. If they approve ("looks good", "approve", "ship it") then call approve_brand_profile. The system handles transition messaging on its own. Stop immediately after the tool call - do NOT write more text. If they request changes then call generate_brand_profile({ feedback: "verbatim feedback" }). A new streaming version will render the same way. After it completes, ask for approval again.`,
  },
  {
    kind: "section_instruction",
    sectionId: "section_3_5",
    content: `SECTION 3.5 - Telegram bot connection (only if messaging_channel = telegram). After approve_brand_profile succeeds AND the client said messaging_channel = telegram in Section 1, immediately call open_telegram_connector. The system renders an inline panel that lists each Department Head agent that needs a bot and lets the client paste BotFather tokens right there.

Rules: If the channel is slack or whatsapp, SKIP this step entirely - go straight to Section 4 by calling show_brand_docs_uploader. Do NOT write any text right before or right after the open_telegram_connector tool call. The system emits a short transition line on its own. Wait silently while the client connects bots or hits Continue. The UI handles BotFather instructions; do NOT repeat them. The client will reply with a one-line summary like "Connected Telegram for Marketing." or "No Telegram bots connected yet". When that message arrives, write ONE short acknowledgement (1-2 sentences) that names which bots are live (or notes none were connected and they can wire them later from /agents), then proceed to Section 4 by calling show_brand_docs_uploader.`,
  },
  {
    kind: "section_instruction",
    sectionId: "section_4",
    content: `SECTION 4 - Brand Documents. Goal: collect the client's logos, brand guidelines, and any other brand assets.

Flow:
1. In one short sentence, invite them to drop in their logos / brand guidelines / other assets.
2. IMMEDIATELY call show_brand_docs_uploader. The system renders an inline drag-and-drop widget in the chat.
3. Wait silently while they upload or skip. Do NOT describe the widget or list the zones - the UI does that.
4. When the client sends a message indicating they're done ("uploaded", "that's all", "no docs"), call complete_brand_docs_section and proceed immediately to Section 6.`,
  },
  {
    kind: "section_instruction",
    sectionId: "section_6",
    content: `SECTION 6 - Software Access. Goal: confirm the client has added chris@rawgrowth.ai to each platform, or that they don't use it. Walk through platforms ONE AT A TIME, in order.

For each platform: ask something like "Have you added chris@rawgrowth.ai as admin on [Platform Name]?" For Drive/Notion: "Have you shared your Rawgrowth folder with chris@rawgrowth.ai?" If the client needs help, share the steps from the platform's steps array. When they confirm they've done it then call save_software_access({ platform: "<platform_id>", confirmed: true }). If they say they don't use that platform or want to skip then call save_software_access({ platform: "<platform_id>", confirmed: false, notes: "<why>" }).

After ALL 6 platforms have been covered with save_software_access calls, call complete_software_access_section. Then proceed to Section 7 without announcing the boundary.`,
  },
  {
    kind: "section_instruction",
    sectionId: "section_7",
    content: `SECTION 7 - Schedule Milestone Calls. Goal: get the client to book their 4 milestone calls with the team. The booking URL for ALL calls is the Calendly base URL provided in the next-action block.

Walk through calls ONE AT A TIME, in order. For each call: present it briefly and give the Calendly link as a clickable markdown link [Book <call.title>](<calendly_url>). When the client confirms they've booked it (or says skip/later) then call confirm_call_booking({ call_id: "<id>", booked: true/false, notes?: "..." }).

After all 4 calls are covered, call complete_schedule_calls_section. Then proceed to Section 8 without announcing.`,
  },
  {
    kind: "section_instruction",
    sectionId: "section_8",
    content: `SECTION 8 - Completion. Once Section 7 is done, call complete_onboarding immediately. After it returns, give a short warm congratulations mentioning: their AI department will begin training on their brand immediately, first deliverables land in their portal within ~5 days, their Week 1 Kickoff call will bring everything together. Keep it to 3-4 sentences. No bullet lists. No section labels.`,
  },
  {
    kind: "rule",
    sectionId: null,
    content: `STRICT RULE - no transition announcements. Do NOT say any of these or any close paraphrase: "moving on to the next section", "let's move on", "I'll move on", "let's continue", "next up", "now let's talk about", "now let's explore", "now let's shift to", "let's wrap things up", "let's discuss", "let's start with", "on to the next", "let's get to". Instead: acknowledge the client's previous answer in ONE short clause if you like (e.g. "Got it."), then ask your next question directly - no transitional phrasing that names a topic or section.`,
  },
  {
    kind: "rule",
    sectionId: null,
    content: `NEVER repeat a question that's already been answered in this conversation. Before asking, scan the message history for an answer to that exact question. If you find one, skip to the next field.`,
  },
  {
    kind: "rule",
    sectionId: null,
    content: `FILE-FIRST flow. The client lands on a big drop zone and is encouraged to drop brand assets (decks, brand guides, sales call transcripts, ad creatives, website screenshots, ICP docs) before any chat happens. Read what they upload. Use it to pre-fill questionnaire fields and skip the questions those files already answered. When a file gets uploaded, the user message reads "I uploaded a file: <name> (<size>)". Treat that as a signal to (a) acknowledge in ONE short clause, (b) silently extract anything useful (offer, ICP, voice, competitors, channel, pain points), (c) skip every Section 1/2 field whose answer is already in the file, (d) only ask about gaps the files did not answer.`,
  },
];

// ---- Tool long-form descriptions -------------------------------------------
// Slim 30-char descriptions live in the route's TOOLS array (still required so
// the model has a schema to invoke). Long-form documentation lives here -
// retrievable when the model needs depth on what a tool does.

const TOOL_CHUNKS: Chunk[] = [
  {
    kind: "tool_description",
    sectionId: "tool:complete_section_1",
    content: `Tool complete_section_1: persist Section 1 (communication preferences). Call once after all required info is gathered. Args: messaging_channel (telegram|slack|whatsapp), messaging_handle, slack_workspace_url (null if declined), slack_channel_name (null if declined). After it returns proceed straight to Section 2.`,
  },
  {
    kind: "tool_description",
    sectionId: "tool:save_questionnaire_section",
    content: `Tool save_questionnaire_section: upsert the answers for one Section 2 sub-section into the brand intake record. Include only fields the client actually provided. Args: section_id (one of the 13 sub-section ids: basicInfo, socialPresence, originStory, businessModel, targetAudience, goals, challenges, brandVoice, competitors, contentMessaging, sales, toolsSystems, additionalContext) and data (key/value map of field_name -> answer). Server merges with existing JSONB so partial fills accumulate.`,
  },
  {
    kind: "tool_description",
    sectionId: "tool:finalize_questionnaire",
    content: `Tool finalize_questionnaire: mark the brand questionnaire as submitted and advance onboarding_step to 3. Call once, after save_questionnaire_section for additionalContext. The system auto-chains the brand profile generation right after this returns - do NOT also call generate_brand_profile.`,
  },
  {
    kind: "tool_description",
    sectionId: "tool:generate_brand_profile",
    content: `Tool generate_brand_profile: regenerate the client's brand profile from their questionnaire data. The rendered markdown is automatically shown in the chat when this returns - never repeat its content in your reply. Arg feedback: client feedback to incorporate into a regenerated version. Pass null for the initial generation (but you usually don't need to call this directly - finalize_questionnaire auto-generates the first version).`,
  },
  {
    kind: "tool_description",
    sectionId: "tool:approve_brand_profile",
    content: `Tool approve_brand_profile: call when the client approves the latest brand profile. Marks it approved and advances onboarding_step to 4. The system auto-shows the next UI element (Telegram connector for telegram clients, brand-docs uploader for slack/whatsapp). Stop writing text after this tool call returns.`,
  },
  {
    kind: "tool_description",
    sectionId: "tool:show_brand_docs_uploader",
    content: `Tool show_brand_docs_uploader: render the inline brand-docs uploader in the chat so the client can drag in logos, guidelines, and assets. Call once at the start of Section 4. Do NOT describe the widget after - the UI handles its own copy.`,
  },
  {
    kind: "tool_description",
    sectionId: "tool:open_telegram_connector",
    content: `Tool open_telegram_connector: render the inline Telegram bot connector in the chat. Lists every Department Head agent with a pending Telegram slot and lets the client paste BotFather tokens right inside the conversation. Call this once after approve_brand_profile succeeds AND only when messaging_channel = telegram. Do not write text immediately before or after this tool call - the system handles the transition copy.`,
  },
  {
    kind: "tool_description",
    sectionId: "tool:open_integration_connector",
    content: `Tool open_integration_connector: render an inline OAuth connector card for a third-party integration. Arg provider must be one of slack, hubspot, google-drive, gmail. Call this once per provider during the integrations section so the client can finish OAuth without leaving the chat.`,
  },
  {
    kind: "tool_description",
    sectionId: "tool:complete_brand_docs_section",
    content: `Tool complete_brand_docs_section: call after the client confirms they're finished uploading (or have nothing to upload). Advances onboarding_step to 5.`,
  },
  {
    kind: "tool_description",
    sectionId: "tool:save_software_access",
    content: `Tool save_software_access: record the client's software access status for one platform. Call once per platform in Section 6. Args: platform (id matching SOFTWARE_ACCESS_PLATFORMS), confirmed (true if they've added chris@rawgrowth.ai; false if skipped/don't use), notes (optional context like "no crm yet" or "will do later").`,
  },
  {
    kind: "tool_description",
    sectionId: "tool:complete_software_access_section",
    content: `Tool complete_software_access_section: call once after all platforms have been covered with save_software_access. Advances onboarding_step to 6.`,
  },
  {
    kind: "tool_description",
    sectionId: "tool:confirm_call_booking",
    content: `Tool confirm_call_booking: record whether the client booked one of the milestone calls. Call once per call in Section 7. Args: call_id (matching SCHEDULE_CALLS), booked (true if confirmed, false if skipped/will book later), notes (optional context).`,
  },
  {
    kind: "tool_description",
    sectionId: "tool:complete_schedule_calls_section",
    content: `Tool complete_schedule_calls_section: call after all 4 milestone calls have been covered. Advances onboarding_step to 7.`,
  },
  {
    kind: "tool_description",
    sectionId: "tool:complete_onboarding",
    content: `Tool complete_onboarding: mark the client as fully onboarded. Call this in Section 8 after Section 7 is complete. The system emits a celebrate event + portal button after this returns. Write only ONE short congratulatory sentence after.`,
  },
  {
    kind: "tool_description",
    sectionId: "tool:scrape_url",
    content: `Tool scrape_url: fetch the public text content of a URL the client shared (their website, a social profile, a competitor, an inspiration page) so you can pre-fill questionnaire fields and ask sharper follow-ups. Returns { ok, title, excerpt } on success or { ok: false, blocked, error } when unreachable. Call BEFORE asking the next question whenever a URL appears in the user's message. Only call for URLs the client volunteered; do not invent URLs. One call per URL per conversation.`,
  },
];

const ALL_CHUNKS: Chunk[] = [...SECTION_CHUNKS, ...TOOL_CHUNKS];

async function loadDatabaseUrl(): Promise<string> {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // Fallback: read .env in repo root the way apply-cloud-migrations does.
  const here = new URL(".", import.meta.url).pathname;
  const repo = resolve(here, "..");
  try {
    const env = readFileSync(resolve(repo, ".env"), "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#"))
      .reduce<Record<string, string>>((m, l) => {
        const i = l.indexOf("=");
        if (i > 0) m[l.slice(0, i)] = l.slice(i + 1);
        return m;
      }, {});
    if (env.DATABASE_URL) return env.DATABASE_URL;
  } catch {}
  throw new Error("DATABASE_URL missing - set env or .env file");
}

async function main() {
  const databaseUrl = await loadDatabaseUrl();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  console.log("[seed-onboarding-knowledge] connected");

  // Truncate so a re-run with edited copy doesn't leak stale rows.
  // Migration must already have run; if the table is missing, fail loud
  // so the operator runs apply-cloud-migrations first.
  const { rows: tableCheck } = await client.query(
    `select 1 from information_schema.tables where table_name = 'rgaios_onboarding_knowledge'`,
  );
  if (tableCheck.length === 0) {
    console.error(
      "[seed-onboarding-knowledge] rgaios_onboarding_knowledge missing - run scripts/apply-cloud-migrations.mjs first",
    );
    process.exit(1);
  }
  await client.query("truncate rgaios_onboarding_knowledge");
  console.log("[seed-onboarding-knowledge] truncated existing rows");

  // Init fastembed - same singleton pattern src/lib/knowledge/embedder uses
  // but standalone here so the script can run without the Next runtime.
  console.log("[seed-onboarding-knowledge] initialising fastembed (cold start ~5s)");
  const embedder = await FlagEmbedding.init({
    model: EmbeddingModel.BGESmallEN,
    cacheDir:
      process.env.FASTEMBED_CACHE_DIR ?? path.join(tmpdir(), "rawclaw-fastembed"),
  });

  console.log(`[seed-onboarding-knowledge] embedding ${ALL_CHUNKS.length} chunks`);
  const texts = ALL_CHUNKS.map((c) => c.content);
  const vectors: number[][] = [];
  // fastembed returns batches via async iterator
  for await (const batch of embedder.embed(texts, Math.min(texts.length, 32))) {
    for (const v of batch) {
      if (v.length !== 384) {
        throw new Error(`Unexpected embedding dim ${v.length} (expected 384)`);
      }
      vectors.push(v);
    }
  }
  if (vectors.length !== ALL_CHUNKS.length) {
    throw new Error(
      `Embedding count mismatch: ${vectors.length} vectors vs ${ALL_CHUNKS.length} chunks`,
    );
  }

  let inserted = 0;
  for (let i = 0; i < ALL_CHUNKS.length; i++) {
    const chunk = ALL_CHUNKS[i];
    const vec = `[${vectors[i].join(",")}]`;
    await client.query(
      `insert into rgaios_onboarding_knowledge (kind, section_id, content, embedding)
       values ($1, $2, $3, $4::vector)`,
      [chunk.kind, chunk.sectionId, chunk.content, vec],
    );
    inserted += 1;
  }

  console.log(`[seed-onboarding-knowledge] inserted ${inserted} rows`);
  await client.end();
}

main().catch((err) => {
  console.error("[seed-onboarding-knowledge] failed:", err);
  process.exit(1);
});
