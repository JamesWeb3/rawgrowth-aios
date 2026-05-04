import { type VercelConfig } from "@vercel/config/v1";

/**
 * Vercel project config. Supersedes vercel.json.
 *
 * Vercel scheduler hits the cron paths below + sends Authorization:
 * Bearer ${CRON_SECRET}. Route handlers verify that header before doing
 * any work.
 *
 * functions.maxDuration bumped per route where the default 10s budget
 * is too tight (chat completions, mini-saas HTML gen, sales-call
 * Whisper transcription).
 */
export const config: VercelConfig = {
  framework: "nextjs",
  // Hobby plan only allows daily cron. Schedule routine-tick once a
  // day; finer cadences need a Pro upgrade or external cron poller.
  crons: [
    {
      path: "/api/cron/schedule-tick",
      schedule: "0 6 * * *",
    },
    {
      path: "/api/cron/insights-tick",
      schedule: "0 7 * * *",
    },
  ],
  functions: {
    "src/app/api/agents/[id]/chat/route.ts": { maxDuration: 60 },
    "src/app/api/mini-saas/route.ts": { maxDuration: 120 },
    "src/app/api/mini-saas/[id]/route.ts": { maxDuration: 120 },
    "src/app/api/onboarding/sales-calls/upload/route.ts": { maxDuration: 300 },
    "src/app/api/onboarding/chat/route.ts": { maxDuration: 60 },
    "src/app/api/cron/schedule-tick/route.ts": { maxDuration: 60 },
    "src/app/api/cron/provision-tick/route.ts": { maxDuration: 300 },
    "src/app/api/cron/insights-tick/route.ts": { maxDuration: 300 },
    "src/app/api/insights/route.ts": { maxDuration: 120 },
  },
};

export default config;
