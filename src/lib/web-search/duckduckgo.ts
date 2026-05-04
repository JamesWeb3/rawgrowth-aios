/**
 * DuckDuckGo HTML scrape - free, no API key, no rate limit auth.
 * Used by the insights generator to give agents current market
 * context when reasoning about metric anomalies.
 *
 * NOT for high-volume use. DDG occasionally returns CAPTCHA pages
 * if hit too frequently from one IP; we treat that as "no results"
 * and let the agent reply without the web context. Best-effort.
 */

const DDG_HTML_URL = "https://html.duckduckgo.com/html/";

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

/**
 * Search DDG for the query, return up to k results.
 * Returns [] on any failure (network, CAPTCHA, parse error).
 */
export async function searchWeb(
  query: string,
  k = 5,
): Promise<SearchResult[]> {
  if (!query.trim()) return [];

  let html: string;
  try {
    const res = await fetch(DDG_HTML_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        // Plain UA so DDG's bot heuristic is less aggressive
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
      body: new URLSearchParams({ q: query, kl: "us-en" }).toString(),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }

  // Parse the result blocks via regex - DDG's HTML structure has been
  // stable for years on the /html/ endpoint:
  //   <a class="result__a" href="...">title</a>
  //   <a class="result__snippet">snippet text</a>
  const results: SearchResult[] = [];
  const blockRe =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const rawUrl = m[1];
    // DDG wraps URLs in /l/?uddg=<encoded>
    const decoded = rawUrl.match(/uddg=([^&]+)/);
    const url = decoded
      ? decodeURIComponent(decoded[1])
      : rawUrl.startsWith("//")
        ? `https:${rawUrl}`
        : rawUrl;
    const stripTags = (s: string) =>
      s
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
    const title = stripTags(m[2]);
    const snippet = stripTags(m[3]);
    if (title && url) {
      results.push({ title, url, snippet });
      if (results.length >= k) break;
    }
  }
  return results;
}

/**
 * Format results as a markdown block to inject into an agent's
 * preamble or user message.
 */
export function formatSearchBlock(
  query: string,
  results: SearchResult[],
): string {
  if (results.length === 0) return "";
  const items = results
    .map((r, i) => `${i + 1}. **${r.title}** ${r.url}\n   ${r.snippet}`)
    .join("\n");
  return `Web search context for "${query}" (DuckDuckGo, top ${results.length}):\n${items}`;
}
