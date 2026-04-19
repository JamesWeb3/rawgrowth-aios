import { type VercelConfig } from "@vercel/config/v1";

/**
 * Vercel project config. Supersedes vercel.json.
 *
 * The Vercel scheduler hits the cron paths below on the schedules shown
 * and sends `Authorization: Bearer ${CRON_SECRET}`. Route handlers should
 * verify that header before doing any work (see schedule-tick/route.ts).
 */
export const config: VercelConfig = {
  framework: "nextjs",
  crons: [
    {
      path: "/api/cron/schedule-tick",
      schedule: "* * * * *", // every minute — finest granularity Vercel allows on Pro
    },
  ],
};

export default config;
