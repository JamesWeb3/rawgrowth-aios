import { Nango } from "@nangohq/node";

/**
 * Singleton Nango server SDK instance.
 * Reads NANGO_SECRET_KEY; optionally NANGO_HOST if using self-hosted.
 *
 * Use only from server-side (route handlers, server actions). Never bundle
 * into the client.
 */

let _nango: Nango | null = null;

export function nango(): Nango {
  if (_nango) return _nango;
  const secretKey = process.env.NANGO_SECRET_KEY;
  if (!secretKey) {
    throw new Error("NANGO_SECRET_KEY not set");
  }
  _nango = new Nango({
    secretKey,
    // If self-hosting, set NANGO_HOST in .env. Otherwise defaults to Nango Cloud.
    host: process.env.NANGO_HOST,
  });
  return _nango;
}
