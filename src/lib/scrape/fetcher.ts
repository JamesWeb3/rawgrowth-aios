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
const MAX_REDIRECTS = 5;

/**
 * SSRF egress filter. The LLM emits arbitrary URLs into `scrape_url`, so any
 * fetch can land on cloud metadata IPs (169.254.169.254 IMDS) or RFC1918
 * neighbours of this VPS (the local Supabase, the drain server, internal
 * admin endpoints). Reject anything pointing at a private / loopback /
 * link-local / cloud-metadata host before we issue the request, and re-check
 * on every redirect hop because the redirect target is attacker-controlled.
 *
 * Conservative on purpose: this only blocks well-known private ranges. Any
 * legit public URL passes through.
 */
function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0" || h === "::" || h === "::1") return true;
  if (h === "127.0.0.1" || /^127\./.test(h)) return true;

  // IPv6 loopback / link-local / unique-local.
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;

  // RFC1918 + link-local + cloud metadata. Match dotted-quad anywhere it
  // looks like an IPv4. We're conservative: only block ranges we KNOW are
  // private. Public IPs (1.1.1.1, 8.8.8.8, etc) pass.
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + IMDS
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b === 100 && Number(m[3]) === 100 && Number(m[4]) === 200) return true; // GCP IMDS
    if (a === 0) return true; // 0.0.0.0/8
  }
  return false;
}

function validateRequestUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`invalid URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`blocked protocol: ${u.protocol}`);
  }
  if (isBlockedHostname(u.hostname)) {
    throw new Error(`blocked hostname (private / loopback / link-local): ${u.hostname}`);
  }
  return u;
}

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
  // Manual redirect loop so we can re-validate every hop's hostname
  // against the SSRF allowlist. `redirect: "follow"` would happily walk
  // a 302 → 169.254.169.254 chain.
  let current = validateRequestUrl(url).toString();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(current, {
        ...init,
        signal: ctrl.signal,
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          ...init.headers,
        },
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return res;
        // Resolve relative redirects against the current URL, then validate.
        const next = new URL(loc, current);
        validateRequestUrl(next.toString());
        current = next.toString();
        continue;
      }
      return res;
    }
    throw new Error(`too many redirects (>${MAX_REDIRECTS})`);
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
