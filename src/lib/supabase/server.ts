import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Server-side Supabase client, keyed with the SERVICE_ROLE secret so it
 * bypasses RLS. Use ONLY from Next.js route handlers / server actions —
 * never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
 *
 * When NextAuth + RLS land, we'll add a per-request client that issues
 * queries with the user's JWT instead of the service role.
 */

let _client: SupabaseClient<Database> | null = null;

export function supabaseAdmin(): SupabaseClient<Database> {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase env missing: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  _client = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
