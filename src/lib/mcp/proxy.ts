import { nango } from "@/lib/nango/server";
import { getConnection } from "@/lib/connections/queries";
import { providerConfigKeyFor } from "@/lib/nango/providers";

/**
 * Thin wrapper around nango.proxy() that resolves the current org's
 * connection for a given integration id and forwards the API call.
 *
 * Throws if the integration isn't connected  -  callers should have gated
 * with `requiresIntegration` in the tool definition, but we guard again
 * here for safety.
 */

type ProxyOpts = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  endpoint: string;
  params?: Record<string, string | number | string[] | number[]>;
  data?: unknown;
  headers?: Record<string, string>;
};

export async function nangoCall<T = unknown>(
  organizationId: string,
  integrationId: string,
  opts: ProxyOpts,
): Promise<T> {
  const pck = providerConfigKeyFor(integrationId);
  if (!pck) {
    throw new Error(`No Nango provider mapped for ${integrationId}`);
  }
  const conn = await getConnection(organizationId, pck);
  if (!conn) {
    throw new Error(`${integrationId} isn't connected for this org`);
  }
  const resp = await nango().proxy({
    providerConfigKey: conn.provider_config_key,
    connectionId: conn.nango_connection_id,
    method: opts.method,
    endpoint: opts.endpoint,
    params: opts.params,
    data: opts.data,
    headers: opts.headers,
  });
  return resp.data as T;
}
