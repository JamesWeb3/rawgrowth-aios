/**
 * Public-source scraper. No Playwright browser, no headless chromium  - 
 * for v3 trial scope we stay with vanilla fetch + a browser-shaped
 * User-Agent. That gets us text content from:
 *   - company site roots (HTML)
 *   - LinkedIn public "about" pages (HTML, no auth)
 *   - Instagram oEmbed JSON (official public endpoint)
 *   - YouTube RSS feeds + /@handle/videos HTML
 *
 * Sites that return 401/403/429 (Cloudflare challenge, rate limit,
 * auth wall) are logged with status='blocked' and the dashboard unlock
 * gate keeps running. We never block the client on a failed scrape.
 *
 * Upgrade path: swap this for Playwright when we need render-time JS,
 * cookies, or authenticated sources. Budgeted for post-trial.
 */

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 rawclaw-scraper/1.0";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 512 * 1024; // 512 KB, enough for HTML title + meta + first 10k of text

export type ScrapeResult =
  | {
      ok: true;
      url: string;
      status: number;
      title: string | null;
      content: string;
    }
  | {
      ok: false;
      url: string;
      status: number | null;
      error: string;
      blocked: boolean;
    };

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...init.headers,
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

function clip(text: string, max = 10_000): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  reader.releaseLock();
  return new TextDecoder("utf-8", { fatal: false }).decode(
    Buffer.concat(chunks.map((c) => Buffer.from(c))),
  );
}

export async function fetchSource(url: string): Promise<ScrapeResult> {
  try {
    // Instagram public URL → route through oEmbed (bypasses login wall).
    const instagramMatch = url.match(/https?:\/\/(?:www\.)?instagram\.com\/([^/?#]+)/);
    if (instagramMatch) {
      const oembed = `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(
        `https://www.instagram.com/${instagramMatch[1]}/`,
      )}`;
      const res = await fetchWithTimeout(oembed);
      if (!res.ok) {
        return {
          ok: false,
          url,
          status: res.status,
          error: `oEmbed ${res.status}`,
          blocked: res.status === 401 || res.status === 403,
        };
      }
      const json = (await res.json()) as {
        author_name?: string;
        title?: string;
        html?: string;
      };
      return {
        ok: true,
        url,
        status: res.status,
        title: json.author_name ?? json.title ?? null,
        content: [json.author_name, json.title, json.html ? stripTags(json.html) : ""]
          .filter(Boolean)
          .join("\n"),
      };
    }

    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      return {
        ok: false,
        url,
        status: res.status,
        error: `HTTP ${res.status}`,
        blocked: res.status === 401 || res.status === 403 || res.status === 429,
      };
    }

    const body = await readCapped(res);
    const ct = res.headers.get("content-type") ?? "";

    if (ct.includes("xml") || url.includes("/feeds/videos.xml")) {
      // YouTube RSS: titles live in <entry><title>...</title></entry>.
      const titles = Array.from(body.matchAll(/<title[^>]*>([^<]+)<\/title>/gi)).map(
        (m) => m[1].trim(),
      );
      return {
        ok: true,
        url,
        status: res.status,
        title: titles[0] ?? null,
        content: clip(titles.slice(0, 30).join("\n")),
      };
    }

    return {
      ok: true,
      url,
      status: res.status,
      title: extractTitle(body),
      content: clip(stripTags(body)),
    };
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string };
    const isAbort = e?.name === "AbortError";
    return {
      ok: false,
      url,
      status: null,
      error: isAbort ? "timeout" : (e?.message ?? String(err)),
      blocked: false,
    };
  }
}
