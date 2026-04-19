# MVP Setup — Live MCP via Nango

End-to-end setup for the current MVP: **per-tenant MCP server exposing live Gmail + Drive tools through Nango → queried from Claude Desktop using the client's Claude subscription**.

No RAG. No pre-indexed data. No sync workers. Integration tools run **live against provider APIs** every time they're called.

---

## Architecture at a glance

```
Claude Desktop ──▶ https://<your>.vercel.app/api/mcp  ──▶  Nango proxy  ──▶  Gmail / Drive / etc.
                       (bearer auth)                    (OAuth tokens)         (live API)
```

What lives in our Postgres: OAuth connection references, agents, routines, approvals, audit log. **No integration content is cached.** Every `search_drive` / `draft_email` call hits the provider live.

---

## Prerequisites

1. **Vercel account** — deploy the Next.js app.
2. **Neon Postgres** — provision via Vercel Marketplace. Schema is control-plane only (~10 tables).
3. **[Nango](https://www.nango.dev) account** — free tier is fine for MVP. Sign up, create a workspace.
4. **Google Cloud OAuth app** — you already have this (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`). We'll register it inside Nango instead of using it directly.

---

## 1. Set up Nango

1. Go to [app.nango.dev](https://app.nango.dev) and create an account.
2. **Integrations → New integration** → choose **Google Mail**. In the config:
   - Paste your `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
   - Scopes: `https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose`
   - (Optional) Add `gmail.send` if you want direct send without a draft step
3. **Integrations → New integration** → choose **Google Drive**. Same credentials, scopes: `https://www.googleapis.com/auth/drive.readonly` plus `drive.file` if you want to create docs.
4. **Environment Settings → Keys** — copy your **Secret Key** and **Public Key**.
5. In your Google Cloud OAuth client, add Nango's redirect URI to **Authorized redirect URIs**: `https://api.nango.dev/oauth/callback`.

---

## 2. Env vars

Local `.env` at repo root:

```
# Neon (pulled via `vercel env pull`)
DATABASE_URL="postgres://..."

# Nango
NANGO_SECRET_KEY="..."
NANGO_PUBLIC_KEY="..."

# MCP auth (generate: openssl rand -hex 32)
MCP_BEARER_TOKEN="..."
```

The old bespoke Google env vars (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`) are **no longer used at runtime** — Nango holds them now. You can remove them from the app's env, but keep them in the Google Cloud Console.

On Vercel, add the same four keys under **Settings → Environment Variables**, then redeploy.

---

## 3. Provision the Postgres schema

The schema shrinks dramatically now that integration content isn't stored:

```
connections (per-tenant OAuth/API-key refs, linked to Nango connection ids)
agents, agent_api_keys
routines, routine_triggers, routine_runs
approvals
audit_log
```

No more `bronze_drive_files`, `drive_files`, `drive_file_chunks`, `drive_files_fts`. Those tables are being dropped.

Apply with:

```
npx vercel env pull .env.local   # fetches DATABASE_URL
npm run db:push                   # syncs Drizzle schema + runs init.sql
```

---

## 4. Connect Google through Nango

Clients connect via Nango's hosted OAuth flow. In the integrations UI, clicking **Connect** on Google Drive / Gmail:

1. Calls Nango's [Connect UI](https://docs.nango.dev/integrate/guides/authorize-an-api) with the `providerConfigKey` (e.g. `google-drive`, `google-mail`) and a `connectionId` = our `company_id`.
2. Nango handles the OAuth dance — user is redirected to Google, approves scopes, lands back.
3. Nango stores the refresh + access tokens on its end.
4. We store a lightweight row in `connections` linking `company_id` → Nango's `connection_id`.

From this point on, every API call our MCP server makes for this company uses Nango's proxy with that `connection_id`. We never touch tokens directly.

---

## 5. Define MCP tools that proxy through Nango

Each tool is a ~10-line file. Example:

```ts
// src/lib/tools/gmail-search.ts
import { nango } from '@/lib/nango';

export async function gmail_search({
  companyId,
  query,
  limit = 10,
}: { companyId: string; query: string; limit?: number }) {
  const resp = await nango.proxy({
    providerConfigKey: 'google-mail',
    connectionId: companyId,
    method: 'GET',
    endpoint: '/gmail/v1/users/me/messages',
    params: { q: query, maxResults: limit },
  });
  return resp.data.messages ?? [];
}
```

Write tool example:

```ts
// src/lib/tools/gmail-draft.ts
export async function gmail_draft({
  companyId,
  to,
  subject,
  body,
}: { companyId: string; to: string; subject: string; body: string }) {
  const raw = Buffer.from(
    [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain', '', body].join('\r\n'),
  ).toString('base64url');

  const resp = await nango.proxy({
    providerConfigKey: 'google-mail',
    connectionId: companyId,
    method: 'POST',
    endpoint: '/gmail/v1/users/me/drafts',
    data: { message: { raw } },
  });

  return { draftId: resp.data.id };
}
```

The MCP endpoint at `/api/mcp` routes `tools/call` JSON-RPC requests to these functions. Every tool:

- Reads `companyId` from the MCP bearer token (which maps to a company record).
- Checks the agent's write policy for this tool (if a write).
- If the policy says *requires approval*, inserts into `approvals` and returns `"Awaiting approval"` instead of executing.
- Logs the call in `audit_log`.

---

## 6. Deploy to Vercel

```
git push
```

Vercel builds and deploys. `DATABASE_URL` and `NANGO_SECRET_KEY` are already set. Your MCP endpoint is live at `https://<project>.vercel.app/api/mcp`.

Sanity-check it in a browser — the GET should return a JSON banner like:

```json
{ "server": "rawgrowth-aios", "version": "0.2.0", "transport": "streamable-http" }
```

---

## 7. Connect Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rawgrowth-aios": {
      "url": "https://<project>.vercel.app/api/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_BEARER_TOKEN>"
      }
    }
  }
}
```

Fully quit Claude Desktop (Cmd+Q) and reopen. Settings → Developer should show `rawgrowth-aios` as a remote server.

---

## 8. Try it

In a new Claude Desktop chat, with Google connected:

- *"Using rawgrowth-aios, search my Gmail for anything from Acme Corp this week."* → calls `gmail_search` → Nango proxies → Gmail API returns → Claude summarises.
- *"Draft an email to sarah@acme.com saying we're delayed by 2 days."* → calls `gmail_draft` → lands as a Gmail draft → user reviews and sends in Gmail.
- *"List the 10 files in my Drive I modified most recently."* → calls `drive_list_recent` live.

Every query consumes **your Claude subscription's tokens**, not Anthropic API credits. That's the point of the architecture.

---

## Tools in this MVP

| Tool | Kind | Calls |
| --- | --- | --- |
| `gmail_search` | read | `GET /gmail/v1/users/me/messages` |
| `gmail_get_thread` | read | `GET /gmail/v1/users/me/threads/{id}` |
| `gmail_draft` | write (unapproved) | `POST /gmail/v1/users/me/drafts` |
| `gmail_send` | write (approval-gated) | `POST /gmail/v1/users/me/drafts/{id}/send` |
| `drive_search` | read | `GET /drive/v3/files?q=...&fullText=...` |
| `drive_get_file` | read | `GET /drive/v3/files/{id}` + export |
| `drive_list_recent` | read | `GET /drive/v3/files?orderBy=modifiedTime` |

Adding a new integration → adding a new provider in Nango + ~5 tool files. No schema changes, no sync worker.

---

## Enterprise install path (for $10K/mo clients)

For Google Workspace customers who don't want per-user consent screens:

1. Client's IT admin creates a service account in their Google Cloud.
2. Grants it **domain-wide delegation** with the scopes we need.
3. Shares the service account's JSON key with us.
4. We configure Nango with service-account auth for that connection.
5. Our MCP server can now call any API on behalf of any user on their domain — no CASA verification needed, no consent screens, no 100-user cap.

Takes 10 minutes in the Workspace admin console. The standard install path for enterprise AI vendors (Gong, Vidyard, Ramp all work this way).

---

## What's NOT in this MVP

Explicit deferrals — all solvable later without architectural changes:

- **Single bearer token for MCP.** Per-tenant tokens (so Claude Desktop config varies per client) come next.
- **Autonomous agent runtime.** Right now agents are UI-only. The Claude Agent SDK integration that actually makes routines run on schedule is next.
- **Approvals UI wiring.** The table exists; the `/approvals` page scaffolds exist; the write-policy enforcement in MCP tools is still a TODO.
- **Audit log UI.** Events are logged; no dashboard yet.
- **Rate-limit handling beyond Nango's defaults.** Nango backs off on 429s, but for high-volume routines we'll want a queue.

---

## What got deleted in this pivot

If you're cross-referencing old docs or git history:

- `src/lib/db/sqlite.ts` — SQLite is gone, Postgres is the sole store.
- `src/lib/google/drive.ts` — the RAG sync logic is deprecated. Live-tool equivalents live in `src/lib/tools/`.
- `bronze_drive_files`, `drive_files`, `drive_file_chunks`, `drive_files_fts` — schema dropped.
- `scripts/drive-sync.ts` — no longer needed, sync is an obsolete concept.
- Bespoke Google OAuth routes — replaced by Nango's hosted flow.

The orchestration layer (agents, routines, approvals, UI, MCP route) is unchanged.
