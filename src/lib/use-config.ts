"use client";

import useSWR from "swr";
import { jsonFetcher } from "./swr";

type Config = { deployMode: "hosted" | "self_hosted" };

/**
 * Fetches the server-side config flags once and caches them forever.
 * Cheap  -  the endpoint returns a few bytes and the response is reused
 * across every consumer via SWR's shared cache.
 */
export function useConfig() {
  const { data } = useSWR<Config>("/api/config", jsonFetcher, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    dedupingInterval: 60_000,
  });
  return {
    deployMode: data?.deployMode ?? "hosted",
    isSelfHosted: data?.deployMode === "self_hosted",
    isHosted: data?.deployMode === "hosted" || !data,
    loaded: !!data,
  };
}
