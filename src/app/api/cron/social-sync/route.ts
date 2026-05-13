import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ingestCompanyChunk } from "@/lib/knowledge/company-corpus";
import { composioCall } from "@/lib/composio/proxy";
import { requireCronAuth } from "@/lib/cron/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any |the |your )?(prior|previous|above) (instructions|rules|prompt)/gi,
  /disregard (all |any |the )?(prior|previous|above) (instructions|rules)/gi,
  /system\s*[:=]\s*/gi,
  /<\s*\/?\s*(system|assistant|user|tool|function)[^>]*>/gi,
  /\|im_(start|end|sep)\|/gi,
  /<\|.*?\|>/g,
];

function sanitize(value: unknown, maxLen = 600): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f​-‏﻿]/g, "");
  s = s.replace(/[\n\r\t]+/g, " ");
  for (const pat of INJECTION_PATTERNS) s = s.replace(pat, "[redacted]");
  return s.trim().slice(0, maxLen);
}

type ProviderHandler = {
  configKey: string;
  composioApp: string;
  action: string;
  source: string;
  parse: (
    body: unknown,
  ) => Array<{ id: string; text: string; metadata: Record<string, unknown> }>;
};

const PROVIDERS: ProviderHandler[] = [
  {
    configKey: "composio:instagram",
    composioApp: "instagram",
    // TODO: confirm Composio v3 action slug for Instagram recent posts.
    action: "INSTAGRAM_LIST_RECENT_POSTS",
    source: "instagram",
    parse: (body) => {
      const items =
        ((body as { items?: unknown[] }).items ??
          (body as { data?: unknown[] }).data ??
          []) as Array<Record<string, unknown>>;
      return items.map((p) => {
        const id = String(p.id ?? p.shortcode ?? p.permalink ?? Math.random());
        const caption = sanitize(p.caption ?? p.text ?? "", 800);
        const likes = sanitize(p.like_count ?? p.likes ?? "-", 20);
        const ts = sanitize(p.timestamp ?? p.created_time ?? "", 40);
        return {
          id,
          text: `Instagram post ${id}\nCaption: ${caption}\nLikes: ${likes} | Posted: ${ts}`,
          metadata: { provider: "instagram", post_id: id },
        };
      });
    },
  },
  {
    configKey: "composio:youtube",
    composioApp: "youtube",
    // TODO: confirm Composio v3 action slug for YouTube channel videos.
    action: "YOUTUBE_LIST_CHANNEL_VIDEOS",
    source: "youtube",
    parse: (body) => {
      const items = ((body as { items?: unknown[] }).items ?? []) as Array<
        Record<string, unknown>
      >;
      return items.map((v) => {
        const id = String(
          (v.id as { videoId?: string })?.videoId ?? v.id ?? Math.random(),
        );
        const snippet = (v.snippet ?? {}) as Record<string, unknown>;
        const title = sanitize(snippet.title, 200);
        const desc = sanitize(snippet.description, 600);
        const ts = sanitize(snippet.publishedAt, 40);
        return {
          id,
          text: `YouTube video ${id}\nTitle: ${title}\nDescription: ${desc}\nPublished: ${ts}`,
          metadata: { provider: "youtube", video_id: id },
        };
      });
    },
  },
  {
    configKey: "composio:facebook-pages",
    composioApp: "facebook",
    // TODO: confirm Composio v3 action slug for Facebook page posts.
    action: "FACEBOOK_LIST_PAGE_POSTS",
    source: "facebook",
    parse: (body) => {
      const items = ((body as { data?: unknown[] }).data ?? []) as Array<
        Record<string, unknown>
      >;
      return items.map((p) => {
        const id = String(p.id ?? Math.random());
        const message = sanitize(p.message ?? p.story ?? "", 800);
        const ts = sanitize(p.created_time, 40);
        return {
          id,
          text: `Facebook page post ${id}\nMessage: ${message}\nPosted: ${ts}`,
          metadata: { provider: "facebook", post_id: id },
        };
      });
    },
  },
];

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const configKeys = PROVIDERS.map((p) => p.configKey);

  const { data: conns, error } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("organization_id, provider_config_key")
    .in("provider_config_key", configKeys)
    .eq("status", "connected");

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message.slice(0, 200) },
      { status: 500 },
    );
  }

  type Conn = { organization_id: string; provider_config_key: string };
  const rows = (conns ?? []) as Conn[];
  const results: Array<{
    org: string;
    provider: string;
    synced: number;
    error?: string;
  }> = [];

  for (const c of rows) {
    const handler = PROVIDERS.find((p) => p.configKey === c.provider_config_key);
    if (!handler) continue;

    try {
      const body = await composioCall(c.organization_id, {
        appKey: handler.composioApp,
        action: handler.action,
        input: {},
      });
      const items = handler.parse(body);
      let synced = 0;
      for (const item of items) {
        await ingestCompanyChunk({
          orgId: c.organization_id,
          source: handler.source,
          sourceId: `${handler.source}-${item.id}`,
          text: item.text,
          metadata: item.metadata,
        });
        synced++;
      }
      results.push({
        org: c.organization_id,
        provider: handler.source,
        synced,
      });
    } catch (err) {
      results.push({
        org: c.organization_id,
        provider: handler.source,
        synced: 0,
        error: (err as Error).message.slice(0, 200),
      });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
