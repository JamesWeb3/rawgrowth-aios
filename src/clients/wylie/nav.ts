import { Trophy, GraduationCap, Phone, Users } from "lucide-react";
import type { ClientModule } from "../registry";

/**
 * Wylie Hawkins X-Ray — bespoke tabs that render only on the VPS whose
 * org slug is "wylie". Everything under /wylie/* is owned by this module
 * and blocked for every other tenant.
 *
 * Build order (from action-plan.md §1):
 *   1. Leaderboard (first visible win)
 *   2. Training Hub
 *   3. Onboarding with graduation gates
 *   4. CRM + Dialer + Call Library (the biggest slice)
 *
 * Items marked `comingSoon: true` render in the sidebar but the pages
 * themselves are still stubs.
 */

export const WYLIE_SLUG = "wylie";

export const wylieModule: ClientModule = {
  slug: WYLIE_SLUG,
  routePrefixes: ["/wylie"],
  nav: [
    {
      label: "Sales Floor",
      items: [
        { label: "Leaderboard", href: "/wylie/leaderboard", icon: Trophy },
        { label: "Training Hub", href: "/wylie/training", icon: GraduationCap, comingSoon: true },
        { label: "CRM & Dialer", href: "/wylie/crm", icon: Phone, comingSoon: true },
        { label: "Onboarding", href: "/wylie/onboarding", icon: Users, comingSoon: true },
      ],
    },
  ],
};
