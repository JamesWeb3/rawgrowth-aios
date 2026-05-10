import { composioCall } from "@/lib/composio/proxy";

/**
 * Outbound integration call. Pedro removed Nango end-to-end on
 * 2026-05-07 so this dispatches via Composio `executeAction`.
 *
 * Callers (gmail tool, booking calendar) used to pass a raw HTTP
 * {method, endpoint, ...} shape that Nango proxied to the upstream
 * provider. Composio doesn't expose a raw HTTP proxy on the SDK; it
 * runs catalog actions instead (GMAIL_FETCH_MAILS,
 * GOOGLECALENDAR_CREATE_EVENT, ...). The migration shim below takes
 * the legacy ProxyOpts and forwards them as the `input` payload of a
 * Composio action the caller must name explicitly.
 */

export type ProxyOpts = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  endpoint: string;
  params?: Record<string, string | number | string[] | number[]>;
  data?: unknown;
  headers?: Record<string, string>;
};

/**
 * Compose a Composio action call from the (orgId, appKey, action, input)
 * tuple. Inputs are passed straight through; per-action shape lives in
 * Composio's catalog docs.
 *
 * `userId` (PR 1, migration 0063 plumbing) selects the caller's per-user
 * Composio bucket when available, falling back to the org-wide row.
 * Mirrors chatCompleteOAuthFirst's per-user thread.
 */
export async function composioAction<T = unknown>(
  organizationId: string,
  appKey: string,
  action: string,
  input: Record<string, unknown>,
  userId?: string | null,
): Promise<T> {
  return composioCall<T>(organizationId, { appKey, action, input }, userId);
}

/**
 * Legacy alias kept so existing tool code compiles unchanged. New
 * callers should import composioAction directly.
 */
export const nangoCall = composioAction;
