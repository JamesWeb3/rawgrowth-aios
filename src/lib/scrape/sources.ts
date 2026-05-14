import { QUESTIONNAIRE_SECTIONS } from "@/lib/onboarding";
import { runActor } from "@/lib/scrape/apify-client";

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
  // intake columns are JSONB objects; index access is `unknown`, and
  // `unknown ?? null` widens to `{} | null` which is not assignable to
  // Record<string, unknown> | null. Narrow each section to the object
  // shape the *ToUrls helpers expect.
  const social = intake[
    QUESTIONNAIRE_SECTIONS.find((s) => s.id === "socialPresence")!.column
  ] as Record<string, unknown> | null | undefined;
  const competitors = intake[
    QUESTIONNAIRE_SECTIONS.find((s) => s.id === "competitors")!.column
  ] as Record<string, unknown> | null | undefined;
  return [...socialPresenceToUrls(social ?? null), ...competitorsToUrls(competitors ?? null)];
}

/**
 * One ad pulled from Meta Ad Library via apify/facebook-ads-scraper.
 * Shape mirrors the actor's dataset items, with only the fields we
 * persist. The actor returns most-recent first; we tag each row with
 * its position via metrics.recency_rank so the media-buyer agent can
 * sort or filter at query time.
 *
 * Plan §13: triggered when intake captures `facebook_page`. Snapshots
 * land in rgaios_scrape_snapshots tagged kind='ads' (extended in
 * migration 0041).
 */
export type FacebookAd = {
  url: string;
  ad_text: string | null;
  start_date: string | null;
  end_date: string | null;
  platforms: string[];
  page_name: string | null;
  metrics: {
    recency_rank: number;
  };
};

type ApifyFbAdItem = {
  ad_archive_id?: string | number;
  page_name?: string;
  start_date_string?: string;
  end_date_string?: string;
  start_date?: string;
  end_date?: string;
  publisher_platform?: string[] | string;
  snapshot?: {
    body?: { text?: string } | string;
    title?: string;
    cta_text?: string;
  };
  url?: string;
};

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

function asPlatforms(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((p): p is string => typeof p === "string");
  if (typeof v === "string") return v.split(",").map((p) => p.trim()).filter(Boolean);
  return [];
}

/**
 * Pull the most recent active ads for a Facebook page via Apify.
 *
 * Apify actor `apify/facebook-ads-scraper` accepts page URLs as input
 * (https://www.facebook.com/<page>) and returns ad library entries with
 * body text + run dates + platforms. Returns ranked results (Apify's
 * own ordering preserved; recency_rank=0 is most recent).
 *
 * Returns [] when APIFY_API_TOKEN is unset so the worker can skip
 * gracefully without erroring.
 */
export async function facebookAdsForPage(
  pageUrl: string,
  limit = 20,
  orgId?: string,
): Promise<FacebookAd[]> {
  const normalized = pageUrl.startsWith("http")
    ? pageUrl
    : `https://www.facebook.com/${pageUrl.replace(/^@/, "").replace(/^facebook\.com\//, "")}`;

  const items = await runActor<ApifyFbAdItem>(
    "apify/facebook-ads-scraper",
    {
      urls: [{ url: normalized }],
      count: limit,
      "scrapePageAds.activeStatus": "all",
    },
    orgId,
  );
  if (!items) return [];

  return items.slice(0, limit).map<FacebookAd>((item, idx) => {
    const snapBody = item.snapshot?.body;
    const adText =
      typeof snapBody === "string"
        ? snapBody
        : asString(snapBody?.text);
    return {
      url: asString(item.url) ?? `${normalized}#ad-${item.ad_archive_id ?? idx}`,
      ad_text: adText,
      start_date: asString(item.start_date_string) ?? asString(item.start_date),
      end_date: asString(item.end_date_string) ?? asString(item.end_date),
      platforms: asPlatforms(item.publisher_platform),
      page_name: asString(item.page_name),
      metrics: { recency_rank: idx },
    };
  });
}

/**
 * One YouTube video pulled from streamers/youtube-scraper. The actor
 * supports channel URLs + handle / username. We always sort by views
 * (descending) so the copy + ads agents see what actually performed.
 *
 * Plan §8 (Apify YouTube top videos). Triggered when intake captures
 * `youtube` (channel URL or @handle). Skipped when APIFY_API_TOKEN
 * unset; the existing fetch + RSS path stays as the fallback.
 */
export type YouTubeVideo = {
  url: string;
  title: string | null;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  duration_seconds: number | null;
  published_at: string | null;
  channel_name: string | null;
  metrics: {
    view_rank: number;
  };
};

type ApifyYtItem = {
  url?: string;
  title?: string;
  viewCount?: number | string;
  likes?: number | string;
  commentsCount?: number | string;
  duration?: string | number;
  date?: string;
  publishedAt?: string;
  channelName?: string;
  channelUrl?: string;
};

function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number(v.replace(/[,\s]/g, ""));
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
}

function durationToSeconds(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v !== "string") return null;
  const parts = v.split(":").map((p) => Number(p.trim()));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

export async function youtubeTopVideos(
  channel: string,
  limit = 15,
  orgId?: string,
): Promise<YouTubeVideo[]> {
  const normalized = channel.startsWith("http")
    ? channel
    : channel.startsWith("@")
      ? `https://www.youtube.com/${channel}`
      : `https://www.youtube.com/@${channel}`;

  const items = await runActor<ApifyYtItem>(
    "streamers/youtube-scraper",
    {
      startUrls: [{ url: normalized }],
      maxResults: limit * 4,
      sortVideosBy: "POPULAR",
    },
    orgId,
  );
  if (!items) return [];

  const ranked = [...items]
    .map((item) => ({ item, views: asInt(item.viewCount) ?? 0 }))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);

  return ranked.map<YouTubeVideo>(({ item }, idx) => ({
    url: asString(item.url) ?? normalized,
    title: asString(item.title),
    view_count: asInt(item.viewCount),
    like_count: asInt(item.likes),
    comment_count: asInt(item.commentsCount),
    duration_seconds: durationToSeconds(item.duration),
    published_at: asString(item.publishedAt) ?? asString(item.date),
    channel_name: asString(item.channelName),
    metrics: { view_rank: idx },
  }));
}

/**
 * One Instagram post pulled from apify/instagram-profile-scraper.
 * Sort by engagement (likes + comments) so the agent surfaces what
 * actually moved. Public profile data only - no login.
 *
 * Plan §8 (Apify IG top posts). Triggered when intake captures
 * `instagram` (handle or URL). Skipped when APIFY_API_TOKEN unset.
 */
export type InstagramPost = {
  url: string;
  caption: string | null;
  like_count: number | null;
  comment_count: number | null;
  type: string | null;
  posted_at: string | null;
  display_url: string | null;
  metrics: {
    engagement_rank: number;
    engagement_score: number;
  };
};

type ApifyIgItem = {
  url?: string;
  shortCode?: string;
  caption?: string;
  likesCount?: number | string;
  commentsCount?: number | string;
  type?: string;
  timestamp?: string;
  takenAtTimestamp?: number;
  displayUrl?: string;
  videoUrl?: string;
};

export async function instagramTopPosts(
  handle: string,
  limit = 20,
  orgId?: string,
): Promise<InstagramPost[]> {
  const normalized = handle
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
    .replace(/\/$/, "");

  const items = await runActor<ApifyIgItem>(
    "apify/instagram-profile-scraper",
    {
      usernames: [normalized],
      resultsLimit: limit * 4,
    },
    orgId,
  );
  if (!items) return [];

  const ranked = [...items]
    .map((item) => {
      const likes = asInt(item.likesCount) ?? 0;
      const comments = asInt(item.commentsCount) ?? 0;
      return { item, likes, comments, score: likes + comments * 5 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked.map<InstagramPost>(({ item, score }, idx) => {
    const url =
      asString(item.url) ??
      (item.shortCode
        ? `https://www.instagram.com/p/${item.shortCode}/`
        : `https://www.instagram.com/${normalized}/`);
    const postedAt =
      asString(item.timestamp) ??
      (typeof item.takenAtTimestamp === "number"
        ? new Date(item.takenAtTimestamp * 1000).toISOString()
        : null);
    return {
      url,
      caption: asString(item.caption),
      like_count: asInt(item.likesCount),
      comment_count: asInt(item.commentsCount),
      type: asString(item.type),
      posted_at: postedAt,
      display_url: asString(item.displayUrl) ?? asString(item.videoUrl),
      metrics: { engagement_rank: idx, engagement_score: score },
    };
  });
}
