import { supabaseAdmin } from "@/lib/supabase/server";

export interface QuestionnaireSection {
  id: string;
  column: string;
  label: string;
}

export const QUESTIONNAIRE_SECTIONS: QuestionnaireSection[] = [
  { id: "basicInfo", column: "basic_info", label: "Basic info" },
  { id: "socialPresence", column: "social_presence", label: "Social & digital presence" },
  { id: "originStory", column: "origin_story", label: "Your story" },
  { id: "businessModel", column: "business_model", label: "Business model & revenue" },
  { id: "targetAudience", column: "target_audience", label: "Target audience" },
  { id: "goals", column: "goals", label: "Goals & vision" },
  { id: "challenges", column: "challenges", label: "Current challenges" },
  { id: "brandVoice", column: "brand_voice", label: "Brand voice" },
  { id: "competitors", column: "competitors", label: "Competitive landscape" },
  { id: "contentMessaging", column: "content_messaging", label: "Content & messaging" },
  { id: "sales", column: "sales", label: "Sales & conversion" },
  { id: "toolsSystems", column: "tools_systems", label: "Tools & systems" },
  { id: "additionalContext", column: "additional_context", label: "Additional context" },
  { id: "salesCalls", column: "sales_calls", label: "Sales calls" },
];

// Per-sub-section field catalog used by the chat guard to tell the model which
// fields remain unanswered in the current sub-section.
export const QUESTIONNAIRE_FIELDS: Record<string, string[]> = {
  basicInfo: ["full_name", "business_name", "email", "phone", "timezone", "preferred_comms"],
  socialPresence: [
    "instagram",
    "youtube",
    "twitter",
    "linkedin",
    "website",
    "other_platforms",
    "top_platform",
    "focus_platform",
    "paid_ads",
  ],
  originStory: ["origin", "proudest", "unfair_advantage"],
  businessModel: [
    "what_you_sell",
    "offer_pricing",
    "monthly_revenue",
    "revenue_breakdown",
    "profit_margin",
    "team_size",
  ],
  targetAudience: [
    "ideal_client",
    "pain_points",
    "dream_outcome",
    "why_you",
    "audience_hangouts",
  ],
  goals: [
    "revenue_goal_90d",
    "massive_win",
    "top_metrics",
    "twelve_month_vision",
    "definition_of_winning",
  ],
  challenges: ["top_challenges", "area_ratings", "tried_solutions", "bottleneck"],
  brandVoice: [
    "voice_description",
    "tone_avoid",
    "favorite_phrases",
    "never_say",
    "brand_personality",
    "content_formats_enjoy",
    "content_formats_chore",
    "face_on_camera",
  ],
  competitors: [
    "competitor_list",
    "competitor_admire",
    "how_different",
    "content_inspirations",
    "admired_brands",
  ],
  contentMessaging: [
    "posting_frequency",
    "core_topics",
    "best_content",
    "want_more_of",
    "one_thing",
    "misconceptions",
    "hot_take",
  ],
  sales: ["sales_process", "takes_calls", "close_rate", "objections", "ideal_vs_nightmare"],
  toolsSystems: ["tech_stack", "tools_love", "tools_frustrate", "ai_comfort"],
  additionalContext: [
    "anything_else",
    "most_excited",
    "most_nervous",
    "how_heard",
    "convincing_content",
  ],
};

// Section 1 (comms) + 13 questionnaire sub-sections + Section 3 (brand profile) + Section 4 (brand docs) + Section 6 (software access) + Section 7 (calls) + Section 8 (complete)
export const TOTAL_ONBOARDING_STEPS =
  1 + QUESTIONNAIRE_SECTIONS.length + 1 + 1 + 1 + 1 + 1;

export const BRAND_DOC_ZONES: Array<{
  id: "logo" | "guideline" | "asset";
  label: string;
  accept: string;
  description: string;
}> = [
  {
    id: "logo",
    label: "Logo Files",
    accept: ".png,.svg,.ai,.eps,.jpg,.jpeg,.pdf",
    description: "PNG, SVG, AI, EPS, or PDF",
  },
  {
    id: "guideline",
    label: "Brand Guidelines",
    accept: ".pdf,.doc,.docx,.txt",
    description: "PDF, DOC, DOCX, or text",
  },
  {
    id: "asset",
    label: "Other Brand Assets",
    accept: "*",
    description: "Colors, fonts, templates, anything else",
  },
];

// Section 6  -  platforms where the client should add chris@rawgrowth.ai
export const SOFTWARE_ACCESS_PLATFORMS: Array<{
  id: string;
  label: string;
  steps: string[];
}> = [
  {
    id: "instagram_bm",
    label: "Instagram Business Manager",
    steps: [
      "Go to business.facebook.com/settings",
      "Click People, then add chris@rawgrowth.ai as Admin",
      "Confirm the invitation",
    ],
  },
  {
    id: "youtube_studio",
    label: "YouTube Studio",
    steps: [
      "Go to studio.youtube.com",
      "Settings → Permissions → Invite",
      "Add chris@rawgrowth.ai as Manager",
    ],
  },
  {
    id: "crm",
    label: "CRM (GoHighLevel / Close / HubSpot)",
    steps: [
      "Open your CRM admin settings",
      "Team / Users section",
      "Add chris@rawgrowth.ai with admin or manager access",
    ],
  },
  {
    id: "google_drive",
    label: "Google Drive / Notion",
    steps: [
      "Create a shared folder for Rawgrowth",
      "Share it with chris@rawgrowth.ai as Editor",
    ],
  },
  {
    id: "analytics",
    label: "Google Analytics",
    steps: [
      "Admin → Account Access",
      "Add chris@rawgrowth.ai as Analyst or Editor",
    ],
  },
  {
    id: "other",
    label: "Any other tools flagged in the questionnaire",
    steps: ["Invite chris@rawgrowth.ai and share details in Slack"],
  },
];

// Section 7  -  only the first kickoff call gets booked during onboarding.
// Future milestone calls (Month 2/3/4) will be scheduled later by the team.
export const SCHEDULE_CALLS: Array<{
  id: string;
  title: string;
  description: string;
  month: number;
  week: number;
}> = [
  {
    id: "week1",
    title: "Week 1 Kickoff",
    description: "Meet the team, review your brand profile, set Month 1 goals",
    month: 1,
    week: 1,
  },
];

export const CALENDLY_BASE_URL =
  "https://calendly.com/chriswestt/rawgrowth-discovery";

export interface OnboardingProgress {
  current: number;
  total: number;
  completed: string[];
}

// In v3 onboarding state lives on rgaios_organizations. One org = one trial
// client; rawclaw's multi-member model is out of scope for onboarding
// (owner completes it, invitees land in the already-onboarded dashboard).
export async function computeOnboardingProgress(
  organizationId: string
): Promise<OnboardingProgress> {
  const completed: string[] = [];
  const db = supabaseAdmin();

  const { data: org } = await db
    .from("rgaios_organizations")
    .select("messaging_channel, onboarding_step, onboarding_completed")
    .eq("id", organizationId)
    .maybeSingle();

  if (org?.messaging_channel || (org?.onboarding_step ?? 1) >= 2) {
    completed.push("section1");
  }

  const columns = QUESTIONNAIRE_SECTIONS.map((s) => s.column).join(", ");
  const { data: intake } = await db
    .from("rgaios_brand_intakes")
    .select(columns)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (intake) {
    for (const section of QUESTIONNAIRE_SECTIONS) {
      // `columns` is a runtime-built select string, so supabase-js cannot
      // statically infer the row shape and collapses `intake` to a
      // GenericStringError. Every column is a real rgaios_brand_intakes
      // JSONB column, so cast through unknown to the indexable shape.
      const value = (intake as unknown as Record<string, unknown>)[section.column];
      if (value && typeof value === "object" && Object.keys(value).length > 0) {
        completed.push(section.id);
      }
    }
  }

  // Section 3  -  brand profile approved
  const { data: approvedProfile } = await db
    .from("rgaios_brand_profiles")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "approved")
    .limit(1)
    .maybeSingle();
  if (approvedProfile) completed.push("brandProfile");

  // Section 4  -  brand docs complete (step >= 5)
  if ((org?.onboarding_step ?? 1) >= 5) completed.push("brandDocs");

  // Section 6  -  software access complete (step >= 6)
  if ((org?.onboarding_step ?? 1) >= 6) completed.push("softwareAccess");

  // Section 7  -  scheduled calls complete (step >= 7)
  if ((org?.onboarding_step ?? 1) >= 7) completed.push("scheduleCalls");

  // Section 8  -  onboarding fully completed flag on the org row
  if (org?.onboarding_completed) completed.push("onboardingComplete");

  return {
    current: completed.length,
    total: TOTAL_ONBOARDING_STEPS,
    completed,
  };
}
