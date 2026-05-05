import { after, NextResponse, type NextRequest } from "next/server";

import { getOrgContext } from "@/lib/auth/admin";
import { tryDecryptSecret } from "@/lib/crypto";
import { chunkText } from "@/lib/knowledge/chunker";
import { embedBatch, toPgVector } from "@/lib/knowledge/embedder";
import { extractInsights } from "@/lib/sales-calls/extract-insights";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * POST /api/sales-calls/fireflies/poll
 *
 * Chris's ask (May 4): "should automatically connect to Fireflies and
 * auto-load into Supabase". This route is the workhorse - it can be
 * triggered by the manual "Sync from Fireflies" button on /sales-calls
 * OR by a cron call (CRON_SECRET bearer skips the org-context check and
 * runs once per org that has a Fireflies connection wired).
 *
 * Per-call flow:
 *   1. Pull recent transcripts from https://api.fireflies.ai/graphql
 *      using the org's stored API key (rgaios_connections,
 *      provider_config_key='fireflies', metadata.api_key encrypted via
 *      `encryptSecret`).
 *   2. For each call, fetch the transcript sentences and join them.
 *   3. Insert into rgaios_sales_calls iff fireflies_id is unseen
 *      (unique index from migration 0056). source='fireflies'.
 *   4. Schedule the existing post-transcribe pipeline in `after()`:
 *      chunk + embed into rgaios_company_chunks, then call
 *      extractInsights(transcript) and persist the structured fields
 *      (analyzed_at, objections, pain_points, buying_signals, insights).
 *
 * Returns `{ ok, scanned, inserted, skipped, errors }`.
 */

export const runtime = "nodejs";
// Each org can have dozens of new calls per poll; keep budget generous
// for the GraphQL fetches + transcript joins. The post-transcript LLM +
// embed work happens in `after()` so it doesn't block the response.
export const maxDuration = 300;

const FIREFLIES_API = "https://api.fireflies.ai/graphql";
const PER_POLL_LIMIT = 25;

type FirefliesTranscriptList = {
  data?: {
    transcripts?: Array<{
      id: string;
      title: string | null;
      date: number | string | null;
      duration: number | null;
      transcript_url: string | null;
    }>;
  };
  errors?: Array<{ message?: string }>;
};

type FirefliesTranscript = {
  data?: {
    transcript?: {
      id: string;
      title: string | null;
      date: number | string | null;
      duration: number | null;
      transcript_url: string | null;
      sentences: Array<{
        index: number | null;
        speaker_name: string | null;
        text: string | null;
      }> | null;
    };
  };
  errors?: Array<{ message?: string }>;
};

type SalesCallInsertRow = {
  organization_id: string;
  source_type: "fireflies";
  source: "fireflies";
  fireflies_id: string;
  source_url: string | null;
  filename: string | null;
  transcript: string;
  duration_sec: number | null;
  status: "ready";
  metadata: Record<string, unknown>;
};

async function fireflies<T>(query: string, apiKey: string): Promise<T> {
  const res = await fetch(FIREFLIES_API, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const payload = (await res.json()) as T & {
    errors?: Array<{ message?: string }>;
  };
  if (!res.ok) {
    const msg = payload.errors?.[0]?.message ?? `fireflies HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (payload.errors && payload.errors.length > 0) {
    throw new Error(payload.errors.map((e) => e.message).join("; "));
  }
  return payload;
}

type Sentence = {
  index: number | null;
  speaker_name: string | null;
  text: string | null;
};

function formatTranscript(sentences: Sentence[] | null | undefined): string {
  if (!Array.isArray(sentences)) return "";
  const lines: string[] = [];
  let prev = "";
  for (const s of sentences) {
    const speaker = (s.speaker_name ?? "").trim();
    const text = (s.text ?? "").trim();
    if (!text) continue;
    if (speaker && speaker !== prev) {
      lines.push(`\n${speaker}: ${text}`);
      prev = speaker;
    } else {
      lines.push(text);
    }
  }
  return lines.join(" ").replace(/\s+\n/g, "\n").trim();
}

function getApiKey(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const raw = metadata["api_key"];
  if (typeof raw !== "string" || !raw) return null;
  return tryDecryptSecret(raw) ?? raw;
}

async function pollOrg(orgId: string): Promise<{
  scanned: number;
  inserted: number;
  skipped: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const db = supabaseAdmin();

  const { data: connRow, error: connErr } = await db
    .from("rgaios_connections")
    .select("metadata, status")
    .eq("organization_id", orgId)
    .eq("provider_config_key", "fireflies")
    .maybeSingle();
  if (connErr) {
    errors.push(`load connection: ${connErr.message}`);
    return { scanned: 0, inserted: 0, skipped: 0, errors };
  }
  if (!connRow) {
    errors.push("no Fireflies connection configured");
    return { scanned: 0, inserted: 0, skipped: 0, errors };
  }
  const apiKey = getApiKey(
    (connRow as { metadata: Record<string, unknown> | null }).metadata,
  );
  if (!apiKey) {
    errors.push("Fireflies api_key missing or unreadable");
    return { scanned: 0, inserted: 0, skipped: 0, errors };
  }

  // Fireflies GraphQL: list recent transcripts. The schema accepts
  // pagination params; we pull a fixed slice each poll, dedupe by id.
  const listQuery = `query { transcripts(limit: ${PER_POLL_LIMIT}) { id title date duration transcript_url } }`;
  let list: FirefliesTranscriptList;
  try {
    list = await fireflies<FirefliesTranscriptList>(listQuery, apiKey);
  } catch (err) {
    errors.push(`list transcripts: ${(err as Error).message}`);
    return { scanned: 0, inserted: 0, skipped: 0, errors };
  }
  const transcripts = list.data?.transcripts ?? [];
  if (transcripts.length === 0) {
    return { scanned: 0, inserted: 0, skipped: 0, errors };
  }

  // Pre-compute the set of fireflies_ids we already have, so we skip the
  // expensive sentences-fetch for known calls.
  const ids = transcripts.map((t) => t.id);
  const { data: existingRows } = await db
    .from("rgaios_sales_calls")
    .select("fireflies_id")
    .eq("organization_id", orgId)
    .in("fireflies_id", ids);
  const existing = new Set(
    ((existingRows ?? []) as Array<{ fireflies_id: string | null }>)
      .map((r) => r.fireflies_id)
      .filter((v): v is string => typeof v === "string"),
  );

  let inserted = 0;
  let skipped = 0;
  const insertedIds: Array<{ id: string; transcript: string }> = [];

  for (const t of transcripts) {
    if (existing.has(t.id)) {
      skipped += 1;
      continue;
    }
    let detail: FirefliesTranscript;
    try {
      const q = `query { transcript(id: "${t.id}") { id title date duration transcript_url sentences { index speaker_name text } } }`;
      detail = await fireflies<FirefliesTranscript>(q, apiKey);
    } catch (err) {
      errors.push(`fetch ${t.id}: ${(err as Error).message}`);
      continue;
    }
    const ff = detail.data?.transcript;
    if (!ff) {
      errors.push(`fetch ${t.id}: empty payload`);
      continue;
    }
    const transcriptText = formatTranscript(ff.sentences);
    if (!transcriptText) {
      errors.push(`fetch ${t.id}: empty transcript`);
      continue;
    }

    const dateIso =
      typeof ff.date === "number"
        ? new Date(ff.date).toISOString()
        : typeof ff.date === "string"
          ? ff.date
          : null;

    const row: SalesCallInsertRow = {
      organization_id: orgId,
      source_type: "fireflies",
      source: "fireflies",
      fireflies_id: ff.id,
      source_url: ff.transcript_url ?? null,
      filename: ff.title ?? null,
      transcript: transcriptText,
      duration_sec:
        typeof ff.duration === "number" ? Math.round(ff.duration) : null,
      status: "ready",
      metadata: {
        fireflies_id: ff.id,
        title: ff.title,
        recorded_at: dateIso,
      },
    };

    const { data: insRow, error: insErr } = await db
      .from("rgaios_sales_calls")
      .insert(row as never)
      .select("id")
      .single();
    if (insErr || !insRow) {
      // Unique-violation on fireflies_id is harmless - another worker
      // claimed it. Anything else is a real error.
      const msg = insErr?.message ?? "insert returned no row";
      if (msg.toLowerCase().includes("duplicate")) {
        skipped += 1;
      } else {
        errors.push(`insert ${ff.id}: ${msg}`);
      }
      continue;
    }
    inserted += 1;
    insertedIds.push({
      id: (insRow as { id: string }).id,
      transcript: transcriptText,
    });
  }

  // Background: chunk+embed into rgaios_company_chunks then run the
  // existing extract-insights LLM step. Mirrors the audio-upload path
  // (src/app/api/onboarding/sales-calls/upload/route.ts) so any
  // dashboard view that reads insights/objections works identically
  // for Fireflies-sourced rows.
  if (insertedIds.length > 0) {
    after(async () => {
      const db2 = supabaseAdmin();
      for (const { id, transcript } of insertedIds) {
        try {
          const chunks = chunkText(transcript);
          if (chunks.length > 0) {
            const embeddings = await embedBatch(chunks.map((c) => c.content));
            const rows = chunks.map((c, i) => ({
              organization_id: orgId,
              source: "sales_call",
              source_id: id,
              chunk_index: c.index,
              content: c.content,
              token_count: Math.round(c.content.length / 4),
              embedding: embeddings[i] ? toPgVector(embeddings[i]) : null,
              metadata: {
                sales_call_id: id,
                source: "sales_call",
                from: "fireflies",
              },
            }));
            for (let i = 0; i < rows.length; i += 500) {
              await db2
                .from("rgaios_company_chunks")
                .insert(rows.slice(i, i + 500));
            }
          }
        } catch (err) {
          console.error(
            "[fireflies/poll] chunk/embed failed:",
            (err as Error).message,
          );
        }
        try {
          const insights = await extractInsights(transcript);
          await db2
            .from("rgaios_sales_calls")
            .update({
              insights,
              objections: insights.objections,
              pain_points: insights.painPoints,
              buying_signals: insights.buyingSignals,
              analyzed_at: new Date().toISOString(),
            } as never)
            .eq("id", id);
        } catch (err) {
          console.error(
            "[fireflies/poll] extract insights failed:",
            (err as Error).message,
          );
        }
      }
    });
  }

  return { scanned: transcripts.length, inserted, skipped, errors };
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const isCron =
    !!cronSecret && auth === `Bearer ${cronSecret}` && cronSecret.length > 0;

  if (isCron) {
    const db = supabaseAdmin();
    // Fan out across every org with a Fireflies connection wired.
    const { data: orgs, error } = await db
      .from("rgaios_connections")
      .select("organization_id")
      .eq("provider_config_key", "fireflies")
      .eq("status", "connected");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const seen = new Set<string>();
    const results: Array<{
      organization_id: string;
      scanned: number;
      inserted: number;
      skipped: number;
      errors: string[];
    }> = [];
    for (const r of (orgs ?? []) as Array<{ organization_id: string }>) {
      if (seen.has(r.organization_id)) continue;
      seen.add(r.organization_id);
      const out = await pollOrg(r.organization_id);
      results.push({ organization_id: r.organization_id, ...out });
    }
    return NextResponse.json({ ok: true, results });
  }

  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const out = await pollOrg(ctx.activeOrgId);
  const ok = out.errors.length === 0;
  return NextResponse.json({ ok, ...out }, { status: ok ? 200 : 207 });
}
