import type { ComponentType } from "react";
import { wylieModule } from "./wylie/nav";

/**
 * Registry of bespoke per-client modules.
 *
 * Every client whose VPS runs Rawclaw can have a corresponding entry here
 * that adds custom sidebar sections, pages, and (optionally) migrations.
 *
 * Lookup is by `org.slug`. When no slug matches, clients see only the
 * shared platform nav. The shared codebase still contains every client's
 * files — gating happens by slug at the sidebar + route layer, not by
 * removing code from the bundle. That's fine at our scale (dozens of
 * clients max); we'd code-split later if it mattered.
 */

export type ClientNavItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  comingSoon?: boolean;
};

export type ClientNavSection = {
  label: string;
  items: ClientNavItem[];
};

export type ClientModule = {
  slug: string;
  nav: ClientNavSection[];
  /**
   * URL path prefixes owned by this client module. Any request whose
   * pathname starts with one of these is only valid when the active org's
   * slug matches this module. Used by `assertClientRoute` to block
   * cross-tenant access attempts.
   */
  routePrefixes: string[];
};

const MODULES: ClientModule[] = [wylieModule];

export function getClientModule(slug: string | null | undefined): ClientModule | null {
  if (!slug) return null;
  return MODULES.find((m) => m.slug === slug) ?? null;
}

/**
 * Given a pathname, return the client module that owns it (if any).
 * Used server-side to block `/wylie/*` from non-wylie orgs.
 */
export function ownerOfPath(pathname: string): ClientModule | null {
  return (
    MODULES.find((m) => m.routePrefixes.some((p) => pathname.startsWith(p))) ??
    null
  );
}
