import * as fs from "node:fs";
import * as path from "node:path";
import { registerTool, text, textError } from "../registry";

/**
 * Read-only access to a per-org sandboxed workspace directory.
 *
 * Hard guarantees:
 *   - Path is resolved against the org-scoped root, then re-checked
 *     with startsWith(orgDir + path.sep) to block ../ traversal.
 *   - 256KB ceiling on file size.
 *   - Null-byte heuristic rejects binary payloads so the model isn't
 *     served garbage that wastes tokens.
 *   - No write / delete / list APIs are exposed.
 */

const MAX_BYTES = 262144;

registerTool({
  name: "workspace_file_read",
  description:
    "Read a single file from this org's sandboxed workspace directory. READ-ONLY. Path must be relative; absolute paths and traversal (..) are rejected.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Relative path inside the org workspace (e.g. \"docs/brand-guide.md\").",
      },
    },
    required: ["path"],
  },
  handler: async (args, ctx) => {
    const rel = String(args.path ?? "").trim();
    if (!rel) return textError("path is required");

    const WORKSPACE_ROOT =
      process.env.WORKSPACE_ROOT ?? "/var/lib/rawclaw/workspaces";
    const orgDir = path.join(WORKSPACE_ROOT, ctx.organizationId);
    const requested = path.resolve(orgDir, rel);

    if (!requested.startsWith(orgDir + path.sep)) {
      return textError("path escapes workspace");
    }

    if (!fs.existsSync(requested)) {
      return textError("file not found");
    }

    const stat = fs.statSync(requested);
    if (stat.size > MAX_BYTES) {
      return textError("file too large (256KB max)");
    }

    const buf = fs.readFileSync(requested);
    if (buf.includes(0x00)) {
      return textError("binary file not supported");
    }

    return text(buf.toString("utf-8"));
  },
});
