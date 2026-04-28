import { QUESTIONNAIRE_SECTIONS } from "@/lib/onboarding";

/**
 * Build the list of URLs to scrape for a given organization, from the
 * brand intake already filled in during onboarding. Public-source-only
 * to stay inside anti-bot limits:
 *   - Instagram  -> oEmbed endpoint (no login wall)
 *   - LinkedIn   -> /company/<handle>/about (public page)
 *   - YouTube    -> RSS feed (no auth)
 *   - X/Twitter  -> SKIPPED (auth required post-2023)
 *   - Website    -> root HTML
 *
 * Competitors are whatever the client listed in section 9 (competitors).
 * We clip to the first three to keep the scrape bounded.
 */

export type ScrapeSource = {
  kind: "social" | "competitor" | "site";
  url: string;
};

function stringOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

function socialPresenceToUrls(presence: Record<string, unknown> | null): ScrapeSource[] {
  if (!presence) return [];
  const urls: ScrapeSource[] = [];

  const ig = stringOrNull(presence.instagram);
  if (ig) {
    const handle = ig.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "");
    urls.push({
      kind: "social",
      url: `https://www.instagram.com/${handle.replace(/\/$/, "")}/`,
    });
  }

  const li = stringOrNull(presence.linkedin);
  if (li) {
    const handle = li.replace(/^https?:\/\/(www\.)?linkedin\.com\//, "").replace(/\/$/, "");
    const isCompany = handle.startsWith("company/") || presence.linkedin_type === "company";
    urls.push({
      kind: "social",
      url: isCompany
        ? `https://www.linkedin.com/${handle}/about/`
        : `https://www.linkedin.com/in/${handle.replace(/^in\//, "")}/`,
    });
  }

  const yt = stringOrNull(presence.youtube);
  if (yt) {
    // Feed URL shape depends on whether we have a channel ID or @handle.
    const handle = yt.replace(/^https?:\/\/(www\.)?youtube\.com\//, "").replace(/\/$/, "");
    if (handle.startsWith("channel/")) {
      urls.push({
        kind: "social",
        url: `https://www.youtube.com/feeds/videos.xml?channel_id=${handle.slice("channel/".length)}`,
      });
    } else if (handle.startsWith("@")) {
      urls.push({
        kind: "social",
        url: `https://www.youtube.com/${handle}/videos`,
      });
    }
  }

  const site = stringOrNull(presence.website);
  if (site) {
    urls.push({ kind: "site", url: site.startsWith("http") ? site : `https://${site}` });
  }

  return urls;
}

function competitorsToUrls(competitors: Record<string, unknown> | null): ScrapeSource[] {
  if (!competitors) return [];
  const list = Array.isArray(competitors.competitor_list)
    ? competitors.competitor_list
    : typeof competitors.competitor_list === "string"
      ? competitors.competitor_list.split(/[,\n]/)
      : [];

  return list
    .slice(0, 3)
    .map((raw: string) => stringOrNull(raw))
    .filter((v: string | null): v is string => !!v)
    .map<ScrapeSource>((c) => ({
      kind: "competitor",
      url: c.startsWith("http") ? c : `https://${c.replace(/^www\./, "")}`,
    }));
}

export function buildScrapeSources(
  intake: Record<string, unknown>,
): ScrapeSource[] {
  const social = intake[
    QUESTIONNAIRE_SECTIONS.find((s) => s.id === "socialPresence")!.column
  ];
  const competitors = intake[
    QUESTIONNAIRE_SECTIONS.find((s) => s.id === "competitors")!.column
  ];
  return [...socialPresenceToUrls(social ?? null), ...competitorsToUrls(competitors ?? null)];
}
