/**
 * Static catalog of available skills. Curated by operator.
 *
 * Primary source: https://github.com/scanbott/claude-skills (154 Claude Code
 * skills for marketing, sales, content, engineering, and ops workflows).
 * Rebranded as "RawClaw" capabilities. Assignment to agents is per-tenant
 * via rgaios_agent_skills  -  the catalog itself is global / code-defined.
 */

export type SkillCategory =
  | "engineering"
  | "marketing"
  | "sales"
  | "finance"
  | "design"
  | "ui"
  | "ops";

export type Skill = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: SkillCategory;
  sourceRepo: string;
  sourceSkill: string;
  brand: string;
  iconKey:
    | "rocket"
    | "megaphone"
    | "badge-dollar"
    | "wallet"
    | "palette"
    | "component"
    | "wrench";
};

export const SKILLS_CATALOG: Skill[] = [
  {
    "id": "rawclaw-react-patterns",
    "name": "RawClaw React Patterns",
    "tagline": "React + Next.js best practices by Vercel Engineering.",
    "description": "Performance patterns, hooks usage, data fetching, caching, and bundle optimization heuristics. Keeps your React code fast and predictable by default.",
    "category": "engineering",
    "sourceRepo": "https://github.com/vercel-labs/agent-skills",
    "sourceSkill": "vercel-react-best-practices",
    "brand": "#60a5fa",
    "iconKey": "rocket"
  },
  {
    "id": "rawclaw-frontend-design",
    "name": "RawClaw Frontend Design",
    "tagline": "Anthropic's frontend design playbook.",
    "description": "Distinctive, production-grade UI design. Avoids generic AI aesthetics  -  creates polished interfaces with strong visual hierarchy and taste.",
    "category": "design",
    "sourceRepo": "https://github.com/anthropics/skills",
    "sourceSkill": "frontend-design",
    "brand": "#ec4899",
    "iconKey": "palette"
  },
  {
    "id": "rawclaw-ui-shadcn",
    "name": "RawClaw UI (shadcn)",
    "tagline": "shadcn/ui component library expertise.",
    "description": "Install, compose, and theme shadcn/ui components. Handles CLI, custom registries, Tailwind integration, and accessibility best practices.",
    "category": "ui",
    "sourceRepo": "https://github.com/shadcn/ui",
    "sourceSkill": "shadcn",
    "brand": "#06b6d4",
    "iconKey": "component"
  },
  {
    "id": "rawclaw-ab-test-setup",
    "name": "RawClaw Ab Test Setup",
    "tagline": "When the user wants to plan, design, or implement an A/B test or experiment, or build a growth experimentation program.",
    "description": "When the user wants to plan, design, or implement an A/B test or experiment, or build a growth experimentation program. Also use when the user mentions \"A/B test,\" \"split test,\" \"experiment,\" \"test this change,\" \"variant copy,\" \"multivariate test,\" \"hypothesis,\" \"should I test this,\" \"which version is better,\" \"test two versions,\" \"statistical significance,\" \"how long should I run this test,\" \"growth experiments,\" \"experiment velocity,\" \"experiment backlog,\" \"ICE score,\" \"experimentation program,\" or \"experiment playbook.\" Use this whenever someone is comparing two approaches and wants to measure which performs better, or when they want to build a systematic experimentation practice. For tracking implementation, see analytics-tracking. For page-level conversion optimization, see page-cro.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ab-test-setup",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-ad-creative",
    "name": "RawClaw Ad Creative",
    "tagline": "When the user wants to generate, iterate, or scale ad creative  -  headlines, descriptions, primary text, or full ad variations  -  for any paid advertising platform.",
    "description": "When the user wants to generate, iterate, or scale ad creative  -  headlines, descriptions, primary text, or full ad variations  -  for any paid advertising platform. Also use when the user mentions 'ad copy variations,' 'ad creative,' 'generate headlines,' 'RSA headlines,' 'bulk ad copy,' 'ad iterations,' 'creative testing,' 'ad performance optimization,' 'write me some ads,' 'Facebook ad copy,' 'Google ad headlines,' 'LinkedIn ad text,' or 'I need more ad variations.' Use this whenever someone needs to produce ad copy at scale or iterate on existing ads. For campaign strategy and targeting, see paid-ads. For landing page copy, see copywriting.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ad-creative",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads",
    "name": "RawClaw Ads",
    "tagline": "Multi-platform paid advertising audit and optimization skill.",
    "description": "Multi-platform paid advertising audit and optimization skill. Analyzes Google, Meta, YouTube, LinkedIn, TikTok, Microsoft, and Apple Ads. 250+ checks with scoring, parallel agents, industry templates, and AI creative generation.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads-apple",
    "name": "RawClaw Ads Apple",
    "tagline": "Apple Ads (formerly Apple Search Ads) deep analysis for mobile app advertisers.",
    "description": "Apple Ads (formerly Apple Search Ads) deep analysis for mobile app advertisers. Evaluates campaign structure, bid health, Custom Product Pages (CPPs), MMP attribution, budget pacing, TAP coverage (Today/Search/Product Pages), Maximize Conversions bidding, and goal CPA benchmarks by country. Use when user says Apple Ads, Apple Search Ads, ASA, App Store ads, Apple ads, Search Ads, or is advertising a mobile app on iOS.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads-apple",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads-audit",
    "name": "RawClaw Ads Audit",
    "tagline": "Full multi-platform paid advertising audit with parallel subagent delegation.",
    "description": "Full multi-platform paid advertising audit with parallel subagent delegation. Analyzes Google Ads, Meta Ads, LinkedIn Ads, TikTok Ads, and Microsoft Ads accounts. Generates health score per platform and aggregate score. Use when user says audit, full ad check, analyze my ads, account health check, or PPC audit.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads-audit",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads-budget",
    "name": "RawClaw Ads Budget",
    "tagline": "Budget allocation and bidding strategy review across all ad platforms.",
    "description": "Budget allocation and bidding strategy review across all ad platforms. Evaluates spend distribution, bidding strategy appropriateness, scaling readiness, and identifies campaigns to kill or scale. Uses 70/20/10 rule, 3x Kill Rule, and 20% scaling rule. Use when user says budget allocation, bidding strategy, ad spend, ROAS target, media budget, or scaling.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads-budget",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads-competitor",
    "name": "RawClaw Ads Competitor",
    "tagline": "Competitor ad intelligence analysis across Google, Meta, LinkedIn, TikTok, Microsoft, and Apple Ads.",
    "description": "Competitor ad intelligence analysis across Google, Meta, LinkedIn, TikTok, Microsoft, and Apple Ads. Analyzes competitor ad copy, creative strategy, keyword targeting, estimated spend, and identifies competitive gaps and opportunities. Use when user says competitor ads, ad spy, competitive analysis, competitor PPC, or ad intelligence.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads-competitor",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads-create",
    "name": "RawClaw Ads Create",
    "tagline": "Campaign concept and copy brief generator for paid advertising.",
    "description": "Campaign concept and copy brief generator for paid advertising. Reads brand-profile.json and optional audit results to produce structured campaign concepts, messaging pillars, and copy briefs. Outputs campaign-brief.md to the current directory. Run after /ads dna and before /ads generate. Triggers on: create campaign, campaign brief, ad concepts, write ad copy, campaign strategy, ad messaging, creative brief, generate concepts.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads-create",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads-creative",
    "name": "RawClaw Ads Creative",
    "tagline": "Cross-platform creative quality audit covering ad copy, video, image, and format diversity across all platforms.",
    "description": "Cross-platform creative quality audit covering ad copy, video, image, and format diversity across all platforms. Detects creative fatigue, evaluates platform-native compliance, and provides production priorities. Use when user says creative audit, ad creative, creative fatigue, ad copy, ad design, or creative review.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads-creative",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads-dna",
    "name": "RawClaw Ads Dna",
    "tagline": "Brand DNA extractor for paid advertising.",
    "description": "Brand DNA extractor for paid advertising. Scans a website URL to extract visual identity, tone of voice, color palette, typography, and imagery style. Outputs brand-profile.json to the current directory. Run before /ads create or /ads generate for brand-consistent creative. Triggers on: brand DNA, brand profile, extract brand, brand identity, brand colors, what is the brand voice, analyze brand, brand style guide.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads-dna",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads-generate",
    "name": "RawClaw Ads Generate",
    "tagline": "AI image generation for paid ad creatives.",
    "description": "AI image generation for paid ad creatives. Reads campaign-brief.md and brand-profile.json to produce platform-sized ad images using banana-claude. Requires banana-claude (v1.4.1+) with nanobanana-mcp configured. Triggers on: generate ads, create images, make ad creatives, generate visuals, create ad images, generate campaign images, make the images, generate from brief.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads-generate",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads-google",
    "name": "RawClaw Ads Google",
    "tagline": "Google Ads deep analysis covering Search, Performance Max, Display, YouTube, and Demand Gen campaigns.",
    "description": "Google Ads deep analysis covering Search, Performance Max, Display, YouTube, and Demand Gen campaigns. Evaluates 80 checks across conversion tracking, wasted spend, account structure, keywords, ads, and settings. Use when user says Google Ads, Google PPC, search ads, PMax, Performance Max, or Google campaign.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads-google",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads-landing",
    "name": "RawClaw Ads Landing",
    "tagline": "Landing page quality assessment for paid advertising campaigns.",
    "description": "Landing page quality assessment for paid advertising campaigns. Evaluates message match, page speed, mobile experience, trust signals, form optimization, and conversion rate potential. Use when user says landing page, post-click experience, landing page audit, conversion rate, or landing page optimization.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads-landing",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads-linkedin",
    "name": "RawClaw Ads Linkedin",
    "tagline": "LinkedIn Ads deep analysis for B2B advertising.",
    "description": "LinkedIn Ads deep analysis for B2B advertising. Evaluates 27 checks across technical setup, audience targeting, creative quality, lead gen forms, and bidding strategy. Includes Thought Leader Ads, ABM, and predictive audiences. Use when user says LinkedIn Ads, B2B ads, sponsored content, lead gen forms, InMail, or LinkedIn campaign.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads-linkedin",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads-math",
    "name": "RawClaw Ads Math",
    "tagline": "PPC financial calculator and modeling tool.",
    "description": "PPC financial calculator and modeling tool. CPA, ROAS, CPL calculations, break-even analysis, impression share opportunity sizing, budget forecasting, LTV:CAC ratio analysis, and MER (Marketing Efficiency Ratio) assessment. Requires zero API access. Works with pasted data from exports. Use when user says PPC math, ad calculator, break-even, budget forecast, ROAS calculator, CPA calculator, impression share, LTV CAC, or MER.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads-math",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads-meta",
    "name": "RawClaw Ads Meta",
    "tagline": "Meta Ads deep analysis covering Facebook and Instagram advertising.",
    "description": "Meta Ads deep analysis covering Facebook and Instagram advertising. Evaluates 50 checks across Pixel/CAPI health, creative diversity and fatigue, account structure, and audience targeting. Includes Advantage+ assessment. Use when user says Meta Ads, Facebook Ads, Instagram Ads, Advantage+, or Meta campaign.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads-meta",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads-microsoft",
    "name": "RawClaw Ads Microsoft",
    "tagline": "Microsoft/Bing Ads deep analysis covering search, Performance Max, Audience Network, and Copilot integration.",
    "description": "Microsoft/Bing Ads deep analysis covering search, Performance Max, Audience Network, and Copilot integration. Evaluates 24 checks with focus on Google import validation, unique Microsoft features, and cost advantage assessment. Use when user says Microsoft Ads, Bing Ads, Bing PPC, Copilot ads, or Microsoft campaign.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads-microsoft",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads-photoshoot",
    "name": "RawClaw Ads Photoshoot",
    "tagline": "Product photography enhancement for ad creatives using banana-claude image generation.",
    "description": "Product photography enhancement for ad creatives using banana-claude image generation. Takes a product image and generates 5 professional photography styles for ad use: Studio, Floating, Ingredient, In Use, and Lifestyle. Requires banana-claude (v1.4.1+) with nanobanana-mcp. Triggers on: product photo, product photography, photoshoot, enhance product image, product shoot, product photos for ads, generate product photos, studio shot, lifestyle photo.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads-photoshoot",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads-plan",
    "name": "RawClaw Ads Plan",
    "tagline": "Strategic paid advertising planning with industry-specific templates.",
    "description": "Strategic paid advertising planning with industry-specific templates. Covers platform selection, campaign architecture, budget planning, creative strategy, and phased implementation roadmap. Use when user says ad plan, ad strategy, campaign planning, media plan, PPC strategy, or advertising plan.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads-plan",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads-test",
    "name": "RawClaw Ads Test",
    "tagline": "A/B test design and experiment planning for paid advertising.",
    "description": "A/B test design and experiment planning for paid advertising. Structured hypothesis framework, statistical significance calculator, test duration estimator, sample size calculator, and platform-specific experiment setup guides (Meta Experiments, Google Experiments, LinkedIn A/B). Use when user says A/B test, split test, experiment design, test hypothesis, statistical significance, sample size, or test duration.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads-test",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads-tiktok",
    "name": "RawClaw Ads Tiktok",
    "tagline": "TikTok Ads deep analysis covering creative quality, tracking, bidding, campaign structure, and TikTok Shop.",
    "description": "TikTok Ads deep analysis covering creative quality, tracking, bidding, campaign structure, and TikTok Shop. Evaluates 28 checks with emphasis on creative-first strategy, safe zone compliance, and Smart+ campaigns. Use when user says TikTok Ads, TikTok marketing, TikTok Shop, Spark Ads, Smart+, or TikTok campaign.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads-tiktok",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-ads-youtube",
    "name": "RawClaw Ads Youtube",
    "tagline": "YouTube Ads specific analysis covering campaign types, creative quality, audience targeting, and measurement.",
    "description": "YouTube Ads specific analysis covering campaign types, creative quality, audience targeting, and measurement. Evaluates video ad performance across skippable, non-skippable, bumper, Shorts, Demand Gen, and Connected TV formats. Covers VAC→Demand Gen migration, Shorts creative requirements, and CTV shoppable ads. Use when user says YouTube Ads, video ads, pre-roll, bumper ads, YouTube campaign, Shorts ads, or CTV ads.",
    "category": "engineering",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ads-youtube",
    "brand": "#60a5fa",
    "iconKey": "rocket"
  },
  {
    "id": "rawclaw-agent-operating-pattern",
    "name": "RawClaw Agent Operating Pattern",
    "tagline": "The standardized workflow every Rawgrowth agent follows.",
    "description": "The standardized workflow every Rawgrowth agent follows. Load this to understand how agents gather context, query data, reference examples, execute, and self-improve.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "agent-operating-pattern",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-ai-seo",
    "name": "RawClaw Ai Seo",
    "tagline": "When the user wants to optimize content for AI search engines, get cited by LLMs, or appear in AI-generated answers.",
    "description": "When the user wants to optimize content for AI search engines, get cited by LLMs, or appear in AI-generated answers. Also use when the user mentions 'AI SEO,' 'AEO,' 'GEO,' 'LLMO,' 'answer engine optimization,' 'generative engine optimization,' 'LLM optimization,' 'AI Overviews,' 'optimize for ChatGPT,' 'optimize for Perplexity,' 'AI citations,' 'AI visibility,' 'zero-click search,' 'how do I show up in AI answers,' 'LLM mentions,' or 'optimize for Claude/Gemini.' Use this whenever someone wants their content to be cited or surfaced by AI assistants and AI search engines. For traditional technical and on-page SEO audits, see seo-audit. For structured data implementation, see schema-markup.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ai-seo",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-analytics-tracking",
    "name": "RawClaw Analytics Tracking",
    "tagline": "When the user wants to set up, improve, or audit analytics tracking and measurement.",
    "description": "When the user wants to set up, improve, or audit analytics tracking and measurement. Also use when the user mentions \"set up tracking,\" \"GA4,\" \"Google Analytics,\" \"conversion tracking,\" \"event tracking,\" \"UTM parameters,\" \"tag manager,\" \"GTM,\" \"analytics implementation,\" \"tracking plan,\" \"how do I measure this,\" \"track conversions,\" \"attribution,\" \"Mixpanel,\" \"Segment,\" \"are my events firing,\" or \"analytics isn't working.\" Use this whenever someone asks how to know if something is working or wants to measure marketing results. For A/B test measurement, see ab-test-setup.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "analytics-tracking",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-banana",
    "name": "RawClaw Banana",
    "tagline": "AI image generation Creative Director powered by Google Gemini Nano Banana models.",
    "description": "AI image generation Creative Director powered by Google Gemini Nano Banana models. Use this skill for ANY request involving image creation, editing, visual asset production, or creative direction. Triggers on: generate an image, create a photo, edit this picture, design a logo, make a banner, visual for my anything, and all /banana commands. Handles text-to-image, image editing, multi-turn creative sessions, batch workflows, and brand presets.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "banana",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-brand-voice",
    "name": "RawClaw Brand Voice",
    "tagline": "Load the Rawgrowth brand voice, identity framework, and Chris West's voice profile.",
    "description": "Load the Rawgrowth brand voice, identity framework, and Chris West's voice profile. Use before writing ANY content, copy, or client-facing material.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "brand-voice",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-churn-prevention",
    "name": "RawClaw Churn Prevention",
    "tagline": "When the user wants to reduce churn, build cancellation flows, set up save offers, recover failed payments, or implement retention strategies.",
    "description": "When the user wants to reduce churn, build cancellation flows, set up save offers, recover failed payments, or implement retention strategies. Also use when the user mentions 'churn,' 'cancel flow,' 'offboarding,' 'save offer,' 'dunning,' 'failed payment recovery,' 'win-back,' 'retention,' 'exit survey,' 'pause subscription,' 'involuntary churn,' 'people keep canceling,' 'churn rate is too high,' 'how do I keep users,' or 'customers are leaving.' Use this whenever someone is losing subscribers or wants to build systems to prevent it. For post-cancel win-back email sequences, see email-sequence. For in-app upgrade paywalls, see paywall-upgrade-cro.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "churn-prevention",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-clickup",
    "name": "RawClaw Clickup",
    "tagline": "Fetches all ClickUp tasks assigned to Chris West, presents status and priority, identifies which ones Cleo can act on (comms/outreach), drafts the proposed action for approval, executes on APPROVE, updates task status in ClickUp.",
    "description": "Fetches all ClickUp tasks assigned to Chris West, presents status and priority, identifies which ones Cleo can act on (comms/outreach), drafts the proposed action for approval, executes on APPROVE, updates task status in ClickUp. Triggers on \"/clickup\", \"check clickup\", \"what are my clickup tasks\", \"show me my tasks\", \"run through my to-dos\".",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "clickup",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-client-onboard",
    "name": "RawClaw Client Onboard",
    "tagline": "Generate a client CLAUDE.",
    "description": "Generate a client CLAUDE.md and knowledge base from brand intake form responses and Fathom discovery call transcript. Use when onboarding a new client.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "client-onboard",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-client-onboard-pipeline",
    "name": "RawClaw Client Onboard Pipeline",
    "tagline": "Full client onboarding pipeline triggered by Stripe payment or manual \"new client [email]\".",
    "description": "Full client onboarding pipeline triggered by Stripe payment or manual \"new client [email]\". Finds all sales calls, searches Gmail for agreement, creates Supabase records, creates Discord channels, sends welcome email, and builds a fulfillment plan from call intelligence. Triggers on \"new client [email]\", \"onboard [name]\", \"client paid\", or Stripe webhook via n8n.",
    "category": "sales",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "client-onboard-pipeline",
    "brand": "#0cbf6a",
    "iconKey": "badge-dollar"
  },
  {
    "id": "rawclaw-client-onboarding",
    "name": "RawClaw Client Onboarding",
    "tagline": "Load the complete client onboarding SOP.",
    "description": "Load the complete client onboarding SOP. Use when a new client signs up, when setting up client infrastructure, or for onboarding-related tasks.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "client-onboarding",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-client-strategy-pipeline",
    "name": "RawClaw Client Strategy Pipeline",
    "tagline": "Data-driven client strategy pipeline.",
    "description": "Data-driven client strategy pipeline. Given a client name or monthly review trigger, pulls client metrics, deliverables, sales call history, and brand intake from Supabase, loads into NotebookLM for grounded analysis, and generates a strategy brief with highest-impact actions. Triggers on \"client strategy [client]\", \"monthly review [client]\", \"client report [client]\", or any client strategy/review request.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "client-strategy-pipeline",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-cold-email",
    "name": "RawClaw Cold Email",
    "tagline": "Write B2B cold emails and follow-up sequences that get replies.",
    "description": "Write B2B cold emails and follow-up sequences that get replies. Use when the user wants to write cold outreach emails, prospecting emails, cold email campaigns, sales development emails, or SDR emails. Also use when the user mentions \"cold outreach,\" \"prospecting email,\" \"outbound email,\" \"email to leads,\" \"reach out to prospects,\" \"sales email,\" \"follow-up email sequence,\" \"nobody's replying to my emails,\" or \"how do I write a cold email.\" Covers subject lines, opening lines, body copy, CTAs, personalization, and multi-touch follow-up sequences. For warm/lifecycle email sequences, see email-sequence. For sales collateral beyond emails, see sales-enablement.",
    "category": "sales",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "cold-email",
    "brand": "#0cbf6a",
    "iconKey": "badge-dollar"
  },
  {
    "id": "rawclaw-comms",
    "name": "RawClaw Comms",
    "tagline": "Scrapes all of Chris's inboxes (Slack, WhatsApp, Instagram DMs, Signal, Telegram via Matrix bridges), identifies every unanswered message, reports back grouped by platform, then drafts and sends replies on approval.",
    "description": "Scrapes all of Chris's inboxes (Slack, WhatsApp, Instagram DMs, Signal, Telegram via Matrix bridges), identifies every unanswered message, reports back grouped by platform, then drafts and sends replies on approval. Triggers on \"/comms\", \"check my messages\", \"what have I missed\", \"inbox check\", \"reply to my messages\".",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "comms",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-community-marketing",
    "name": "RawClaw Community Marketing",
    "tagline": "Build and grow online communities that drive product growth and brand loyalty.",
    "description": "Build and grow online communities that drive product growth and brand loyalty. Use when the user wants to create a community strategy, grow a Discord or Slack community, manage a forum or subreddit, build brand advocates, increase word-of-mouth, drive community-led growth, engage users post-signup, or turn customers into evangelists. Trigger phrases: \"build a community,\" \"community strategy,\" \"Discord community,\" \"Slack community,\" \"community-led growth,\" \"brand advocates,\" \"user community,\" \"forum strategy,\" \"community engagement,\" \"grow our community,\" \"ambassador program,\" \"community flywheel.\"",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "community-marketing",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-competitor-alternatives",
    "name": "RawClaw Competitor Alternatives",
    "tagline": "When the user wants to create competitor comparison or alternative pages for SEO and sales enablement.",
    "description": "When the user wants to create competitor comparison or alternative pages for SEO and sales enablement. Also use when the user mentions 'alternative page,' 'vs page,' 'competitor comparison,' 'comparison page,' '[Product] vs [Product],' '[Product] alternative,' 'competitive landing pages,' 'how do we compare to X,' 'battle card,' or 'competitor teardown.' Use this for any content that positions your product against competitors. Covers four formats: singular alternative, plural alternatives, you vs competitor, and competitor vs competitor. For sales-specific competitor docs, see sales-enablement.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "competitor-alternatives",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-content-creation",
    "name": "RawClaw Content Creation",
    "tagline": "Load content creation frameworks, hook libraries, YouTube scripting system, and platform strategies.",
    "description": "Load content creation frameworks, hook libraries, YouTube scripting system, and platform strategies. Use before creating any content.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "content-creation",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-content-ideation-pipeline",
    "name": "RawClaw Content Ideation Pipeline",
    "tagline": "Data-driven content ideation pipeline.",
    "description": "Data-driven content ideation pipeline. Analyzes past content performance, recent sales call questions, and competitor outliers to generate ranked content ideas backtested against what actually works. Pulls from Supabase (content metrics, sales calls), YouTube (competitor data via yt-search), and Obsidian (content pillars, frameworks). Loads everything into NotebookLM for grounded analysis. Triggers on \"what should I make next\", \"content ideas\", \"content ideation\", \"plan content\", or weekly content planning.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "content-ideation-pipeline",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-content-strategy",
    "name": "RawClaw Content Strategy",
    "tagline": "When the user wants to plan a content strategy, decide what content to create, or figure out what topics to cover.",
    "description": "When the user wants to plan a content strategy, decide what content to create, or figure out what topics to cover. Also use when the user mentions \"content strategy,\" \"what should I write about,\" \"content ideas,\" \"blog strategy,\" \"topic clusters,\" \"content planning,\" \"editorial calendar,\" \"content marketing,\" \"content roadmap,\" \"what content should I create,\" \"blog topics,\" \"content pillars,\" or \"I don't know what to write.\" Use this whenever someone needs help deciding what content to produce, not just writing it. For writing individual pieces, see copywriting. For SEO-specific audits, see seo-audit. For social media content specifically, see social-content.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "content-strategy",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-copy-editing",
    "name": "RawClaw Copy Editing",
    "tagline": "When the user wants to edit, review, or improve existing marketing copy, or refresh outdated content.",
    "description": "When the user wants to edit, review, or improve existing marketing copy, or refresh outdated content. Also use when the user mentions 'edit this copy,' 'review my copy,' 'copy feedback,' 'proofread,' 'polish this,' 'make this better,' 'copy sweep,' 'tighten this up,' 'this reads awkwardly,' 'clean up this text,' 'too wordy,' 'sharpen the messaging,' 'refresh this content,' 'update this page,' 'this content is outdated,' or 'content audit.' Use this when the user already has copy and wants it improved or refreshed rather than rewritten from scratch. For writing new copy, see copywriting.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "copy-editing",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-copy-pipeline",
    "name": "RawClaw Copy Pipeline",
    "tagline": "End-to-end copywriting pipeline backtested against real data.",
    "description": "End-to-end copywriting pipeline backtested against real data. Given a copy task (landing page, email sequence, VSL, DM sequence, ad), pulls sales call transcripts and objections from Supabase, loads best-performing copy examples, brand voice, and relevant data into NotebookLM for grounded analysis, then writes copy informed by what actually closes deals. Triggers on \"write copy for [X]\", \"copy pipeline [X]\", \"write a [landing page/email/VSL/DM/ad]\", or any copywriting request.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "copy-pipeline",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-copywriting",
    "name": "RawClaw Copywriting",
    "tagline": "Standalone copywriting skill using Planner-Generator-Evaluator pattern.",
    "description": "Standalone copywriting skill using Planner-Generator-Evaluator pattern. Loads brand voice, pulls copy examples from Supabase, writes copy in Chris's voice across all formats (email, DM, VSL, landing page, social, ad). Triggers on 'write copy', 'copywriting', 'draft a [email/DM/VSL/landing page/caption/ad]', or any direct copywriting request.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "copywriting",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-customer-research",
    "name": "RawClaw Customer Research",
    "tagline": "When the user wants to conduct, analyze, or synthesize customer research.",
    "description": "When the user wants to conduct, analyze, or synthesize customer research. Use when the user mentions \"customer research,\" \"ICP research,\" \"talk to customers,\" \"analyze transcripts,\" \"customer interviews,\" \"survey analysis,\" \"support ticket analysis,\" \"voice of customer,\" \"VOC,\" \"build personas,\" \"customer personas,\" \"jobs to be done,\" \"JTBD,\" \"what do customers say,\" \"what are customers struggling with,\" \"Reddit mining,\" \"G2 reviews,\" \"review mining,\" \"digital watering holes,\" \"community research,\" \"forum research,\" \"competitor reviews,\" \"customer sentiment,\" or \"find out why customers churn/convert/buy.\" Use for both analyzing existing research assets AND gathering new research from online sources. For writing copy informed by research, see copywriting. For acting on research to improve pages, see page-cro.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "customer-research",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-dashboard-deploy",
    "name": "RawClaw Dashboard Deploy",
    "tagline": "Dashboard build, deploy, and troubleshooting process.",
    "description": "Dashboard build, deploy, and troubleshooting process. Use when building or deploying the Vercel dashboard.",
    "category": "engineering",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "dashboard-deploy",
    "brand": "#60a5fa",
    "iconKey": "rocket"
  },
  {
    "id": "rawclaw-email-sequence",
    "name": "RawClaw Email Sequence",
    "tagline": "When the user wants to create or optimize an email sequence, drip campaign, automated email flow, or lifecycle email program.",
    "description": "When the user wants to create or optimize an email sequence, drip campaign, automated email flow, or lifecycle email program. Also use when the user mentions \"email sequence,\" \"drip campaign,\" \"nurture sequence,\" \"onboarding emails,\" \"welcome sequence,\" \"re-engagement emails,\" \"email automation,\" \"lifecycle emails,\" \"trigger-based emails,\" \"email funnel,\" \"email workflow,\" \"what emails should I send,\" \"welcome series,\" or \"email cadence.\" Use this for any multi-email automated flow. For cold outreach emails, see cold-email. For in-app onboarding, see onboarding-cro.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "email-sequence",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-flywheel",
    "name": "RawClaw Flywheel",
    "tagline": "Load the SIE (Signal Intelligence Expression) flywheel framework.",
    "description": "Load the SIE (Signal Intelligence Expression) flywheel framework. Use when planning strategy, building systems, or evaluating whether work aligns with the core loop.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "flywheel",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-form-cro",
    "name": "RawClaw Form Cro",
    "tagline": "When the user wants to optimize any form that is NOT signup/registration  -  including lead capture forms, contact forms, demo request forms, application forms, survey forms, or checkout forms.",
    "description": "When the user wants to optimize any form that is NOT signup/registration  -  including lead capture forms, contact forms, demo request forms, application forms, survey forms, or checkout forms. Also use when the user mentions \"form optimization,\" \"lead form conversions,\" \"form friction,\" \"form fields,\" \"form completion rate,\" \"contact form,\" \"nobody fills out our form,\" \"form abandonment,\" \"too many fields,\" \"demo request form,\" or \"lead form isn't converting.\" Use this for any non-signup form that captures information. For signup/registration forms, see signup-flow-cro. For popups containing forms, see popup-cro.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "form-cro",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-free-tool-strategy",
    "name": "RawClaw Free Tool Strategy",
    "tagline": "When the user wants to plan, evaluate, or build a free tool for marketing purposes  -  lead generation, SEO value, or brand awareness.",
    "description": "When the user wants to plan, evaluate, or build a free tool for marketing purposes  -  lead generation, SEO value, or brand awareness. Also use when the user mentions \"engineering as marketing,\" \"free tool,\" \"marketing tool,\" \"calculator,\" \"generator,\" \"interactive tool,\" \"lead gen tool,\" \"build a tool for leads,\" \"free resource,\" \"ROI calculator,\" \"grader tool,\" \"audit tool,\" \"should I build a free tool,\" or \"tools for lead gen.\" Use this whenever someone wants to build something useful and give it away to attract leads or earn links. For downloadable content lead magnets (ebooks, checklists, templates), see lead-magnets.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "free-tool-strategy",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-frontend-theme",
    "name": "RawClaw Frontend Theme",
    "tagline": "Enforces the Rawgrowth.",
    "description": "Enforces the Rawgrowth.ai design system on all frontend development. Injects the full token set, typography rules, component patterns, and layout conventions before any UI code is written. Triggers on \"build a frontend\", \"build a UI\", \"build a dashboard\", \"create a page\", \"design a component\", or any request involving HTML/CSS/React/Next.js/Tailwind output.",
    "category": "engineering",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "frontend-theme",
    "brand": "#60a5fa",
    "iconKey": "rocket"
  },
  {
    "id": "rawclaw-funnel-pipeline",
    "name": "RawClaw Funnel Pipeline",
    "tagline": "Data-driven funnel optimization pipeline.",
    "description": "Data-driven funnel optimization pipeline. Analyzes conversion data, sales call transcripts, content performance, and copy across funnel stages to identify the highest-impact optimization. Pulls from Supabase (funnel_analytics, sales_calls, revenue, content_pipeline), loads into NotebookLM for grounded analysis, and outputs specific changes with predicted impact. Triggers on \"optimize funnel\", \"funnel pipeline\", \"why aren't we converting\", \"fix [landing page/email/funnel step]\", or any conversion optimization request.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "funnel-pipeline",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-gmail",
    "name": "RawClaw Gmail",
    "tagline": "Manage your Gmail inbox from Claude Code.",
    "description": "Manage your Gmail inbox from Claude Code. List, read, triage, reply, send, and create filters.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "gmail",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-google-calendar",
    "name": "RawClaw Google Calendar",
    "tagline": "Create, list, update, and delete Google Calendar events.",
    "description": "Create, list, update, and delete Google Calendar events. Book meetings, send invites, check availability. Triggers on \"book a meeting\", \"schedule a call\", \"add to calendar\", \"check my calendar\", \"when am I free\", \"cancel the meeting\".",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "google-calendar",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-gsap",
    "name": "RawClaw Gsap",
    "tagline": "GSAP animation reference for HyperFrames.",
    "description": "GSAP animation reference for HyperFrames. Covers gsap.to(), from(), fromTo(), easing, stagger, defaults, timelines (gsap.timeline(), position parameter, labels, nesting, playback), and performance (transforms, will-change, quickTo). Use when writing GSAP animations in HyperFrames compositions.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "gsap",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-gstack",
    "name": "RawClaw Gstack",
    "tagline": "|",
    "description": "|",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "gstack",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-humanizer",
    "name": "RawClaw Humanizer",
    "tagline": "|",
    "description": "|",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "humanizer",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-hyperframes",
    "name": "RawClaw Hyperframes",
    "tagline": "Create video compositions, animations, title cards, overlays, captions, voiceovers, audio-reactive visuals, and scene transitions in HyperFrames HTML.",
    "description": "Create video compositions, animations, title cards, overlays, captions, voiceovers, audio-reactive visuals, and scene transitions in HyperFrames HTML. Use when asked to build any HTML-based video content, add captions or subtitles synced to audio, generate text-to-speech narration, create audio-reactive animation (beat sync, glow, pulse driven by music), add animated text highlighting (marker sweeps, hand-drawn circles, burst lines, scribble, sketchout), or add transitions between scenes (crossfades, wipes, reveals, shader transitions). Covers composition authoring, timing, media, and the full video production workflow. For CLI commands (init, lint, preview, render, transcribe, tts) see the hyperframes-cli skill.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "hyperframes",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-hyperframes-cli",
    "name": "RawClaw Hyperframes Cli",
    "tagline": "HyperFrames CLI tool  -  hyperframes init, lint, preview, render, transcribe, tts, doctor, browser, info, upgrade, compositions, docs, benchmark.",
    "description": "HyperFrames CLI tool  -  hyperframes init, lint, preview, render, transcribe, tts, doctor, browser, info, upgrade, compositions, docs, benchmark. Use when scaffolding a project, linting or validating compositions, previewing in the studio, rendering to video, transcribing audio, generating TTS, or troubleshooting the HyperFrames environment.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "hyperframes-cli",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-hyperframes-registry",
    "name": "RawClaw Hyperframes Registry",
    "tagline": "Install and wire registry blocks and components into HyperFrames compositions.",
    "description": "Install and wire registry blocks and components into HyperFrames compositions. Use when running hyperframes add, installing a block or component, wiring an installed item into index.html, or working with hyperframes.json. Covers the add command, install locations, block sub-composition wiring, component snippet merging, and registry discovery.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "hyperframes-registry",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-launch-strategy",
    "name": "RawClaw Launch Strategy",
    "tagline": "When the user wants to plan a product launch, feature announcement, or release strategy.",
    "description": "When the user wants to plan a product launch, feature announcement, or release strategy. Also use when the user mentions 'launch,' 'Product Hunt,' 'feature release,' 'announcement,' 'go-to-market,' 'beta launch,' 'early access,' 'waitlist,' 'product update,' 'how do I launch this,' 'launch checklist,' 'GTM plan,' or 'we're about to ship.' Use this whenever someone is preparing to release something publicly. For ongoing marketing after launch, see marketing-ideas.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "launch-strategy",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-lead-magnets",
    "name": "RawClaw Lead Magnets",
    "tagline": "When the user wants to create, plan, or optimize a lead magnet for email capture or lead generation.",
    "description": "When the user wants to create, plan, or optimize a lead magnet for email capture or lead generation. Also use when the user mentions \"lead magnet,\" \"gated content,\" \"content upgrade,\" \"downloadable,\" \"ebook,\" \"cheat sheet,\" \"checklist,\" \"template download,\" \"opt-in,\" \"freebie,\" \"PDF download,\" \"resource library,\" \"content offer,\" \"email capture content,\" \"Notion template,\" \"spreadsheet template,\" or \"what should I give away for emails.\" Use this for planning what to create and how to distribute it. For interactive tools as lead magnets, see free-tool-strategy. For writing the actual content, see copywriting. For the email sequence after capture, see email-sequence.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "lead-magnets",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-make-a-video",
    "name": "RawClaw Make A Video",
    "tagline": "Beginner-friendly end-to-end video creator for HyperFrames.",
    "description": "Beginner-friendly end-to-end video creator for HyperFrames. Use when the user says \"make a video\", \"create a video\", \"new video\", \"build a video\", \"video from scratch\", \"I want to make a video\", \"help me create a video\", or when someone who's never used HyperFrames before arrives with a concept, script, or rough idea and wants a finished MP4. Interviews the user in one pass, then builds the full video with mandatory preview and visual-verification gates.",
    "category": "design",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "make-a-video",
    "brand": "#ec4899",
    "iconKey": "palette"
  },
  {
    "id": "rawclaw-marketing-ideas",
    "name": "RawClaw Marketing Ideas",
    "tagline": "When the user needs marketing ideas, inspiration, or strategies for their SaaS or software product.",
    "description": "When the user needs marketing ideas, inspiration, or strategies for their SaaS or software product. Also use when the user asks for 'marketing ideas,' 'growth ideas,' 'how to market,' 'marketing strategies,' 'marketing tactics,' 'ways to promote,' 'ideas to grow,' 'what else can I try,' 'I don't know how to market this,' 'brainstorm marketing,' or 'what marketing should I do.' Use this as a starting point whenever someone is stuck or looking for inspiration on how to grow. For specific channel execution, see the relevant skill (paid-ads, social-content, email-sequence, etc.).",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "marketing-ideas",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-marketing-psychology",
    "name": "RawClaw Marketing Psychology",
    "tagline": "When the user wants to apply psychological principles, mental models, or behavioral science to marketing.",
    "description": "When the user wants to apply psychological principles, mental models, or behavioral science to marketing. Also use when the user mentions 'psychology,' 'mental models,' 'cognitive bias,' 'persuasion,' 'behavioral science,' 'why people buy,' 'decision-making,' 'consumer behavior,' 'anchoring,' 'social proof,' 'scarcity,' 'loss aversion,' 'framing,' or 'nudge.' Use this whenever someone wants to understand or apply how people think and make decisions in a marketing context.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "marketing-psychology",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-mcp-creator",
    "name": "RawClaw Mcp Creator",
    "tagline": "Build MCP (Model Context Protocol) servers from scratch.",
    "description": "Build MCP (Model Context Protocol) servers from scratch. Use when the user asks to \"build an MCP server\", \"create an MCP\", \"make a tool server\", \"add MCP tools\", or needs to connect an API/service as an MCP server for Claude.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "mcp-creator",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-nightly-dose",
    "name": "RawClaw Nightly Dose",
    "tagline": "Comprehensive nightly business intelligence brief.",
    "description": "Comprehensive nightly business intelligence brief. Sweeps all comms (email, Slack, WhatsApp), calendar, ClickUp, CRM, and agent work logs. Scores the day 1-10. Identifies next steps against the north star. Closes completed ClickUp tasks and creates new ones to keep the engine moving. No agent attribution -- just what happened. Triggers on \"/nightly-dose\", \"nightly update\", \"nightly brief\", \"daily recap\", \"what got done today\".",
    "category": "sales",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "nightly-dose",
    "brand": "#0cbf6a",
    "iconKey": "badge-dollar"
  },
  {
    "id": "rawclaw-notebooklm",
    "name": "RawClaw Notebooklm",
    "tagline": "Complete API for Google NotebookLM - full programmatic access including features not in the web UI.",
    "description": "Complete API for Google NotebookLM - full programmatic access including features not in the web UI. Create notebooks, add sources, generate all artifact types, download in multiple formats. Activates on explicit /notebooklm or intent like \"create a podcast about X\"",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "notebooklm",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-onboarding-cro",
    "name": "RawClaw Onboarding Cro",
    "tagline": "When the user wants to optimize post-signup onboarding, user activation, first-run experience, or time-to-value.",
    "description": "When the user wants to optimize post-signup onboarding, user activation, first-run experience, or time-to-value. Also use when the user mentions \"onboarding flow,\" \"activation rate,\" \"user activation,\" \"first-run experience,\" \"empty states,\" \"onboarding checklist,\" \"aha moment,\" \"new user experience,\" \"users aren't activating,\" \"nobody completes setup,\" \"low activation rate,\" \"users sign up but don't use the product,\" \"time to value,\" or \"first session experience.\" Use this whenever users are signing up but not sticking around. For signup/registration optimization, see signup-flow-cro. For ongoing email sequences, see email-sequence.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "onboarding-cro",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-ops-reference",
    "name": "RawClaw Ops Reference",
    "tagline": "Rawgrowth operational reference -- workspace architecture, Supabase schema, API connections, agent registry, cron schedule.",
    "description": "Rawgrowth operational reference -- workspace architecture, Supabase schema, API connections, agent registry, cron schedule. Load when you need system-level context.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ops-reference",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-page-cro",
    "name": "RawClaw Page Cro",
    "tagline": "When the user wants to optimize, improve, or increase conversions on any marketing page  -  including homepage, landing pages, pricing pages, feature pages, or blog posts.",
    "description": "When the user wants to optimize, improve, or increase conversions on any marketing page  -  including homepage, landing pages, pricing pages, feature pages, or blog posts. Also use when the user says \"CRO,\" \"conversion rate optimization,\" \"this page isn't converting,\" \"improve conversions,\" \"why isn't this page working,\" \"my landing page sucks,\" \"nobody's converting,\" \"low conversion rate,\" \"bounce rate is too high,\" \"people leave without signing up,\" or \"this page needs work.\" Use this even if the user just shares a URL and asks for feedback  -  they probably want conversion help. For signup/registration flows, see signup-flow-cro. For post-signup activation, see onboarding-cro. For forms outside of signup, see form-cro. For popups/modals, see popup-cro.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "page-cro",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-paid-ads",
    "name": "RawClaw Paid Ads",
    "tagline": "When the user wants help with paid advertising campaigns on Google Ads, Meta (Facebook/Instagram), LinkedIn, Twitter/X, or other ad platforms.",
    "description": "When the user wants help with paid advertising campaigns on Google Ads, Meta (Facebook/Instagram), LinkedIn, Twitter/X, or other ad platforms. Also use when the user mentions 'PPC,' 'paid media,' 'ROAS,' 'CPA,' 'ad campaign,' 'retargeting,' 'audience targeting,' 'Google Ads,' 'Facebook ads,' 'LinkedIn ads,' 'ad budget,' 'cost per click,' 'ad spend,' or 'should I run ads.' Use this for campaign strategy, audience targeting, bidding, and optimization. For bulk ad creative generation and iteration, see ad-creative. For landing page optimization, see page-cro.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "paid-ads",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-paywall-upgrade-cro",
    "name": "RawClaw Paywall Upgrade Cro",
    "tagline": "When the user wants to create or optimize in-app paywalls, upgrade screens, upsell modals, or feature gates.",
    "description": "When the user wants to create or optimize in-app paywalls, upgrade screens, upsell modals, or feature gates. Also use when the user mentions \"paywall,\" \"upgrade screen,\" \"upgrade modal,\" \"upsell,\" \"feature gate,\" \"convert free to paid,\" \"freemium conversion,\" \"trial expiration screen,\" \"limit reached screen,\" \"plan upgrade prompt,\" \"in-app pricing,\" \"free users won't upgrade,\" \"trial to paid conversion,\" or \"how do I get users to pay.\" Use this for any in-product moment where you're asking users to upgrade. Distinct from public pricing pages (see page-cro)  -  this focuses on in-product upgrade moments where the user has already experienced value. For pricing decisions, see pricing-strategy.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "paywall-upgrade-cro",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-popup-cro",
    "name": "RawClaw Popup Cro",
    "tagline": "When the user wants to create or optimize popups, modals, overlays, slide-ins, or banners for conversion purposes.",
    "description": "When the user wants to create or optimize popups, modals, overlays, slide-ins, or banners for conversion purposes. Also use when the user mentions \"exit intent,\" \"popup conversions,\" \"modal optimization,\" \"lead capture popup,\" \"email popup,\" \"announcement banner,\" \"overlay,\" \"collect emails with a popup,\" \"exit popup,\" \"scroll trigger,\" \"sticky bar,\" or \"notification bar.\" Use this for any overlay or interrupt-style conversion element. For forms outside of popups, see form-cro. For general page conversion optimization, see page-cro.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "popup-cro",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-pricing-strategy",
    "name": "RawClaw Pricing Strategy",
    "tagline": "When the user wants help with pricing decisions, packaging, or monetization strategy.",
    "description": "When the user wants help with pricing decisions, packaging, or monetization strategy. Also use when the user mentions 'pricing,' 'pricing tiers,' 'freemium,' 'free trial,' 'packaging,' 'price increase,' 'value metric,' 'Van Westendorp,' 'willingness to pay,' 'monetization,' 'how much should I charge,' 'my pricing is wrong,' 'pricing page,' 'annual vs monthly,' 'per seat pricing,' or 'should I offer a free plan.' Use this whenever someone is figuring out what to charge or how to structure their plans. For in-app upgrade screens, see paywall-upgrade-cro.",
    "category": "finance",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "pricing-strategy",
    "brand": "#a78bfa",
    "iconKey": "wallet"
  },
  {
    "id": "rawclaw-product-marketing-context",
    "name": "RawClaw Product Marketing Context",
    "tagline": "When the user wants to create or update their product marketing context document.",
    "description": "When the user wants to create or update their product marketing context document. Also use when the user mentions 'product context,' 'marketing context,' 'set up context,' 'positioning,' 'who is my target audience,' 'describe my product,' 'ICP,' 'ideal customer profile,' or wants to avoid repeating foundational information across marketing tasks. Use this at the start of any new project before using other marketing skills  -  it creates `.agents/product-marketing-context.md` that all other skills reference for product, audience, and positioning context.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "product-marketing-context",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-programmatic-seo",
    "name": "RawClaw Programmatic Seo",
    "tagline": "When the user wants to create SEO-driven pages at scale using templates and data.",
    "description": "When the user wants to create SEO-driven pages at scale using templates and data. Also use when the user mentions \"programmatic SEO,\" \"template pages,\" \"pages at scale,\" \"directory pages,\" \"location pages,\" \"[keyword] + [city] pages,\" \"comparison pages,\" \"integration pages,\" \"building many pages for SEO,\" \"pSEO,\" \"generate 100 pages,\" \"data-driven pages,\" or \"templated landing pages.\" Use this whenever someone wants to create many similar pages targeting different keywords or locations. For auditing existing SEO issues, see seo-audit. For content strategy planning, see content-strategy.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "programmatic-seo",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-rag-query",
    "name": "RawClaw Rag Query",
    "tagline": "Query the RawgrowthOS knowledge graph via RAGAnything/LightRAG",
    "description": "Query the RawgrowthOS knowledge graph via RAGAnything/LightRAG",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "rag-query",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-referral-program",
    "name": "RawClaw Referral Program",
    "tagline": "When the user wants to create, optimize, or analyze a referral program, affiliate program, or word-of-mouth strategy.",
    "description": "When the user wants to create, optimize, or analyze a referral program, affiliate program, or word-of-mouth strategy. Also use when the user mentions 'referral,' 'affiliate,' 'ambassador,' 'word of mouth,' 'viral loop,' 'refer a friend,' 'partner program,' 'referral incentive,' 'how to get referrals,' 'customers referring customers,' or 'affiliate payout.' Use this whenever someone wants existing users or partners to bring in new customers. For launch-specific virality, see launch-strategy.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "referral-program",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-research",
    "name": "RawClaw Research",
    "tagline": "Load research methodology, competitor analysis frameworks, and the client research template.",
    "description": "Load research methodology, competitor analysis frameworks, and the client research template. Use for any research or analysis task.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "research",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-revops",
    "name": "RawClaw Revops",
    "tagline": "When the user wants help with revenue operations, lead lifecycle management, or marketing-to-sales handoff processes.",
    "description": "When the user wants help with revenue operations, lead lifecycle management, or marketing-to-sales handoff processes. Also use when the user mentions 'RevOps,' 'revenue operations,' 'lead scoring,' 'lead routing,' 'MQL,' 'SQL,' 'pipeline stages,' 'deal desk,' 'CRM automation,' 'marketing-to-sales handoff,' 'data hygiene,' 'leads aren't getting to sales,' 'pipeline management,' 'lead qualification,' or 'when should marketing hand off to sales.' Use this for anything involving the systems and processes that connect marketing to revenue. For cold outreach emails, see cold-email. For email drip campaigns, see email-sequence. For pricing decisions, see pricing-strategy.",
    "category": "sales",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "revops",
    "brand": "#0cbf6a",
    "iconKey": "badge-dollar"
  },
  {
    "id": "rawclaw-saas",
    "name": "RawClaw Saas",
    "tagline": "Full-stack SaaS builder.",
    "description": "Full-stack SaaS builder. Give it an idea, it researches the market, plans the architecture, asks clarifying questions, builds the entire product (backend, auth, app UI, landing page, transactional email), runs E2E tests, reviews all code, and deploys to Vercel. One command, working SaaS.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "saas",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-sales",
    "name": "RawClaw Sales",
    "tagline": "Load sales playbook, objection handling, DM templates, and pricing details.",
    "description": "Load sales playbook, objection handling, DM templates, and pricing details. Use for any sales-related task  -  copy, DMs, emails, proposals, call prep.",
    "category": "sales",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "sales",
    "brand": "#0cbf6a",
    "iconKey": "badge-dollar"
  },
  {
    "id": "rawclaw-sales-enablement",
    "name": "RawClaw Sales Enablement",
    "tagline": "When the user wants to create sales collateral, pitch decks, one-pagers, objection handling docs, or demo scripts.",
    "description": "When the user wants to create sales collateral, pitch decks, one-pagers, objection handling docs, or demo scripts. Also use when the user mentions 'sales deck,' 'pitch deck,' 'one-pager,' 'leave-behind,' 'objection handling,' 'deal-specific ROI analysis,' 'demo script,' 'talk track,' 'sales playbook,' 'proposal template,' 'buyer persona card,' 'help my sales team,' 'sales materials,' or 'what should I give my sales reps.' Use this for any document or asset that helps a sales team close deals. For competitor comparison pages and battle cards, see competitor-alternatives. For marketing website copy, see copywriting. For cold outreach emails, see cold-email.",
    "category": "sales",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "sales-enablement",
    "brand": "#0cbf6a",
    "iconKey": "badge-dollar"
  },
  {
    "id": "rawclaw-sales-prep-pipeline",
    "name": "RawClaw Sales Prep Pipeline",
    "tagline": "Automated sales call prep pipeline.",
    "description": "Automated sales call prep pipeline. Given a prospect name or upcoming call, pulls similar past sales calls from Supabase, analyzes objection patterns and what closed, loads into NotebookLM for grounded insights, and generates a call prep brief with talking points, anticipated objections, and recommended approach. Triggers on \"prep for call with [X]\", \"sales prep [X]\", \"call prep [X]\", or before any booked sales call.",
    "category": "sales",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "sales-prep-pipeline",
    "brand": "#0cbf6a",
    "iconKey": "badge-dollar"
  },
  {
    "id": "rawclaw-schema-markup",
    "name": "RawClaw Schema Markup",
    "tagline": "When the user wants to add, fix, or optimize schema markup and structured data on their site.",
    "description": "When the user wants to add, fix, or optimize schema markup and structured data on their site. Also use when the user mentions \"schema markup,\" \"structured data,\" \"JSON-LD,\" \"rich snippets,\" \"schema.org,\" \"FAQ schema,\" \"product schema,\" \"review schema,\" \"breadcrumb schema,\" \"Google rich results,\" \"knowledge panel,\" \"star ratings in search,\" or \"add structured data.\" Use this whenever someone wants their pages to show enhanced results in Google. For broader SEO issues, see seo-audit. For AI search optimization, see ai-seo.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "schema-markup",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-self-install",
    "name": "RawClaw Self Install",
    "tagline": "Install new MCP servers, skills, and tools autonomously.",
    "description": "Install new MCP servers, skills, and tools autonomously. Use when you need a capability you don't have.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "self-install",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-seo-audit",
    "name": "RawClaw Seo Audit",
    "tagline": "When the user wants to audit, review, or diagnose SEO issues on their site.",
    "description": "When the user wants to audit, review, or diagnose SEO issues on their site. Also use when the user mentions \"SEO audit,\" \"technical SEO,\" \"why am I not ranking,\" \"SEO issues,\" \"on-page SEO,\" \"meta tags review,\" \"SEO health check,\" \"my traffic dropped,\" \"lost rankings,\" \"not showing up in Google,\" \"site isn't ranking,\" \"Google update hit me,\" \"page speed,\" \"core web vitals,\" \"crawl errors,\" or \"indexing issues.\" Use this even if the user just says something vague like \"my SEO is bad\" or \"help with SEO\"  -  start with an audit. For building pages at scale to target keywords, see programmatic-seo. For adding structured data, see schema-markup. For AI search optimization, see ai-seo.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "seo-audit",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-short-form-video",
    "name": "RawClaw Short Form Video",
    "tagline": "Build and iterate short-form vertical (9:16) videos in Hyperframes  -  TikTok/Reels/Shorts style.",
    "description": "Build and iterate short-form vertical (9:16) videos in Hyperframes  -  TikTok/Reels/Shorts style. Use when Nate says \"short-form video\", \"vertical video\", \"TikTok/Reels/Shorts\", \"make a short\", \"talking-head + motion graphics\", or when the target is a 1080x1920 composition with face video + synced scene overlays + karaoke captions. Encodes the full May Shorts 19 playbook: face-mode choreography, audio-synced scene timing, karaoke captions, and the 10-rule quality checklist.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "short-form-video",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-signal-scan",
    "name": "RawClaw Signal Scan",
    "tagline": "Biweekly cross-domain pattern recognition engine.",
    "description": "Biweekly cross-domain pattern recognition engine. Analyzes sales calls, revenue, content, and deliverables to find non-obvious correlations, trending shifts, and actionable insights. Stores patterns in Supabase with confidence scoring and compounding history. Reports findings to Chris via Telegram.",
    "category": "sales",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "signal-scan",
    "brand": "#0cbf6a",
    "iconKey": "badge-dollar"
  },
  {
    "id": "rawclaw-signup-flow-cro",
    "name": "RawClaw Signup Flow Cro",
    "tagline": "When the user wants to optimize signup, registration, account creation, or trial activation flows.",
    "description": "When the user wants to optimize signup, registration, account creation, or trial activation flows. Also use when the user mentions \"signup conversions,\" \"registration friction,\" \"signup form optimization,\" \"free trial signup,\" \"reduce signup dropoff,\" \"account creation flow,\" \"people aren't signing up,\" \"signup abandonment,\" \"trial conversion rate,\" \"nobody completes registration,\" \"too many steps to sign up,\" or \"simplify our signup.\" Use this whenever the user has a signup or registration flow that isn't performing. For post-signup onboarding, see onboarding-cro. For lead capture forms (not account creation), see form-cro.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "signup-flow-cro",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-site-architecture",
    "name": "RawClaw Site Architecture",
    "tagline": "When the user wants to plan, map, or restructure their website's page hierarchy, navigation, URL structure, or internal linking.",
    "description": "When the user wants to plan, map, or restructure their website's page hierarchy, navigation, URL structure, or internal linking. Also use when the user mentions \"sitemap,\" \"site map,\" \"visual sitemap,\" \"site structure,\" \"page hierarchy,\" \"information architecture,\" \"IA,\" \"navigation design,\" \"URL structure,\" \"breadcrumbs,\" \"internal linking strategy,\" \"website planning,\" \"what pages do I need,\" \"how should I organize my site,\" or \"site navigation.\" Use this whenever someone is planning what pages a website should have and how they connect. NOT for XML sitemaps (that's technical SEO  -  see seo-audit). For SEO audits, see seo-audit. For structured data, see schema-markup.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "site-architecture",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-skill-creator",
    "name": "RawClaw Skill Creator",
    "tagline": "Create a new executable skill from a repeatable process or SOP.",
    "description": "Create a new executable skill from a repeatable process or SOP. Use when the user says \"create a skill\", \"make a skill\", \"new skill\", \"turn this into a skill\", \"automate this process\", or wants to capture a workflow they run repeatedly so it executes automatically on trigger. Produces a fully installed, runnable skill.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "skill-creator",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-slack",
    "name": "RawClaw Slack",
    "tagline": "Manage Slack from Claude Code.",
    "description": "Manage Slack from Claude Code. List conversations, read messages, send replies, search for channels and DMs. Also handles incoming Slack events (mentions, DMs).",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "slack",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-social-content",
    "name": "RawClaw Social Content",
    "tagline": "When the user wants help creating, scheduling, or optimizing social media content for LinkedIn, Twitter/X, Instagram, TikTok, Facebook, or other platforms.",
    "description": "When the user wants help creating, scheduling, or optimizing social media content for LinkedIn, Twitter/X, Instagram, TikTok, Facebook, or other platforms. Also use when the user mentions 'LinkedIn post,' 'Twitter thread,' 'social media,' 'content calendar,' 'social scheduling,' 'engagement,' 'viral content,' 'what should I post,' 'repurpose this content,' 'tweet ideas,' 'LinkedIn carousel,' 'social media strategy,' or 'grow my following.' Use this for any social media content creation, repurposing, or scheduling task. For broader content strategy, see content-strategy.",
    "category": "marketing",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "social-content",
    "brand": "#ef4444",
    "iconKey": "megaphone"
  },
  {
    "id": "rawclaw-steal",
    "name": "RawClaw Steal",
    "tagline": "Extracts everything useful from any resource (GitHub repo, YouTube video, Instagram reel, Twitter/X post, or any URL) and maps it to Rawgrowth.",
    "description": "Extracts everything useful from any resource (GitHub repo, YouTube video, Instagram reel, Twitter/X post, or any URL) and maps it to Rawgrowth. Code/tools -> Extract & Report. Strategy/content/frameworks -> Extract & Implement into MD files. Triggers on \"/robber\", \"rob this\", \"steal from this\", \"extract from\", or when a URL is passed with intent to analyze.",
    "category": "engineering",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "steal",
    "brand": "#60a5fa",
    "iconKey": "rocket"
  },
  {
    "id": "rawclaw-story-sequence",
    "name": "RawClaw Story Sequence",
    "tagline": "Create Instagram story sequences or LinkedIn carousels end-to-end.",
    "description": "Create Instagram story sequences or LinkedIn carousels end-to-end. Asks 3 questions, researches what visual formats are actually working for competitors, writes copy in Chris's voice, then hands off to Dex for Canva production. Triggers on \"/story-sequence\", \"create story sequence\", \"instagram stories about [X]\", \"story sequence for [X]\", \"linkedin carousel\", or any request to make IG stories or LinkedIn image posts.",
    "category": "design",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "story-sequence",
    "brand": "#ec4899",
    "iconKey": "palette"
  },
  {
    "id": "rawclaw-supabase-postgres-best-practices",
    "name": "RawClaw Supabase Postgres Best Practices",
    "tagline": "Postgres performance optimization and best practices from Supabase.",
    "description": "Postgres performance optimization and best practices from Supabase. Use this skill when writing, reviewing, or optimizing Postgres queries, schema designs, or database configurations.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "supabase-postgres-best-practices",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-system-rules",
    "name": "RawClaw System Rules",
    "tagline": "Strict rules and guardrails for the Rawgrowth OS.",
    "description": "Strict rules and guardrails for the Rawgrowth OS. Data loading, output quality, security, and self-improvement protocols. Load when building new agents or auditing system behavior.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "system-rules",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-tech-stack",
    "name": "RawClaw Tech Stack",
    "tagline": "Rawgrowth master tech stack reference.",
    "description": "Rawgrowth master tech stack reference. Maps every tool, its purpose, owner, and integration point. Load when any agent needs to know which tool handles what.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "tech-stack",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-thumbnail-designer",
    "name": "RawClaw Thumbnail Designer",
    "tagline": "Generate YouTube thumbnails, story sequence visuals, and carousel graphics using the Rawgrowth design system and Canva.",
    "description": "Generate YouTube thumbnails, story sequence visuals, and carousel graphics using the Rawgrowth design system and Canva. Triggers on \"thumbnail [title]\", \"create thumbnail for [title]\", \"competitor thumbnails [channel]\", \"thumbnail audit\", or \"story visuals [topic]\".",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "thumbnail-designer",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-timezone",
    "name": "RawClaw Timezone",
    "tagline": "Show current times across Mark's key locations.",
    "description": "Show current times across Mark's key locations. Use when Mark says \"timezone\", \"what time is it\", \"team times\", \"check the time in\", or wants to know working hours for his team.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "timezone",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-tldr",
    "name": "RawClaw Tldr",
    "tagline": "Summarize the current conversation into a TLDR note and save it to your notes folder.",
    "description": "Summarize the current conversation into a TLDR note and save it to your notes folder. Use when you say \"tldr\", \"save a summary\", \"note this convo\", or want to capture key takeaways from the current session for future reference.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "tldr",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-ui-ux-pro-max",
    "name": "RawClaw Ui Ux Pro Max",
    "tagline": "UI/UX design intelligence.",
    "description": "UI/UX design intelligence. 67 styles, 96 palettes, 57 font pairings, 25 charts, 13 stacks (React, Next.js, Vue, Svelte, SwiftUI, React Native, Flutter, Tailwind, shadcn/ui). Actions: plan, build, create, design, implement, review, fix, improve, optimize, enhance, refactor, check UI/UX code. Projects: website, landing page, dashboard, admin panel, e-commerce, SaaS, portfolio, blog, mobile app, .html, .tsx, .vue, .svelte. Elements: button, modal, navbar, sidebar, card, table, form, chart. Styles: glassmorphism, claymorphism, minimalism, brutalism, neumorphism, bento grid, dark mode, responsive, skeuomorphism, flat design. Topics: color palette, accessibility, animation, layout, typography, font pairing, spacing, hover, shadow, gradient. Integrations: shadcn/ui MCP for component search and examples.",
    "category": "engineering",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "ui-ux-pro-max",
    "brand": "#60a5fa",
    "iconKey": "rocket"
  },
  {
    "id": "rawclaw-waterfall",
    "name": "RawClaw Waterfall",
    "tagline": "Drop a YouTube URL, your own video link, or a concept.",
    "description": "Drop a YouTube URL, your own video link, or a concept. Pulls transcript if video, then generates 5 YouTube video ideas, 1 LinkedIn post, 1 X thread, and 5 Instagram reel scripts -- all in Chris's voice. Saves everything to one Google Doc and returns the link. Triggers on \"/waterfall\", \"waterfall this\", \"waterfall [URL]\", or \"make content from [URL or concept]\".",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "waterfall",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-website-to-hyperframes",
    "name": "RawClaw Website To Hyperframes",
    "tagline": "|",
    "description": "|",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "website-to-hyperframes",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-yt-pipeline",
    "name": "RawClaw Yt Pipeline",
    "tagline": "End-to-end YouTube research pipeline.",
    "description": "End-to-end YouTube research pipeline. Given a topic, automatically searches YouTube (via yt-search), auto-selects the 5-8 best videos by relevance/engagement/recency/diversity, creates a NotebookLM notebook with those videos as sources (via notebooklm skill), queries for thorough analysis  -  trends, outliers, gaps  -  and presents key takeaways. Optionally generates deliverables (podcast, slide deck, report, YouTube script). Triggers on \"yt pipeline [topic]\", \"YouTube pipeline [topic]\", \"research [topic] on YouTube\", or \"YouTube research on [topic]\".",
    "category": "sales",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "yt-pipeline",
    "brand": "#0cbf6a",
    "iconKey": "badge-dollar"
  },
  {
    "id": "rawclaw-yt-promote",
    "name": "RawClaw Yt Promote",
    "tagline": "Turn a YouTube video into a multi-platform promotion package.",
    "description": "Turn a YouTube video into a multi-platform promotion package. Give it a video URL, transcript, or title + description. Extracts the 3 strongest hooks, then generates a Telegram channel message, a YouTube Community post, and a full Instagram story sequence (slide-by-slide copy ready to paste into the Chris Stories Canva template). All outputs delivered as ONE sorted Google Doc URL. Value-first, zero promo energy, CTA feels natural. Triggers on \"/yt-promote\", \"promote this video\", \"promote my YouTube video\", \"create promo for [video]\", or \"turn this video into posts\".",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "yt-promote",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-yt-search",
    "name": "RawClaw Yt Search",
    "tagline": "Search YouTube and return structured video results with engagement metrics.",
    "description": "Search YouTube and return structured video results with engagement metrics. Use for content research, competitor analysis, or topic validation.",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "yt-search",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  },
  {
    "id": "rawclaw-yt-spinoff",
    "name": "RawClaw Yt Spinoff",
    "tagline": "Pull a YouTube video transcript, extract the framework and voice patterns, then rewrite it as a Rawgrowth YouTube script.",
    "description": "Pull a YouTube video transcript, extract the framework and voice patterns, then rewrite it as a Rawgrowth YouTube script. Runs quality gate, saves to Google Doc, returns the link. Triggers on \"/yt-spinoff [URL]\", \"spin off this video\", \"make our version of [URL]\", or \"remix this [URL]\".",
    "category": "ops",
    "sourceRepo": "https://github.com/scanbott/claude-skills",
    "sourceSkill": "yt-spinoff",
    "brand": "#fbbf24",
    "iconKey": "wrench"
  }
];

export function getSkill(id: string): Skill | null {
  return SKILLS_CATALOG.find((s) => s.id === id) ?? null;
}

/**
 * Build the exact install command a client runs in their Claude Code to
 * install a given skill.
 */
export function installCommand(skill: Skill): string {
  return `npx skills add ${skill.sourceRepo} --skill ${skill.sourceSkill}`;
}
