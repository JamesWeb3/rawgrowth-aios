/**
 * Tool loader  -  importing this file triggers every tool module's
 * registerTool() side effects. The MCP route imports this once.
 *
 * Add a new integration? Create a new file next to this one, register
 * your tools at module scope, and add the import here.
 */

import "./knowledge";
import "./agent-knowledge";
import "./agent-invoke";
import "./gmail";
import "./runs";
import "./agents";
import "./routines";
import "./approvals";
import "./telegram";
import "./slack";
import "./skills";
import "./supabase";
import "./company-knowledge";
import "./agent-context";
// import "./shopify";   // re-enable when Shopify access is available
// import "./outlook";   // re-enable when Microsoft Graph access is available
// import "./canva";     // re-enable when Canva developer creds are set up

/**
 * Self-coded tool re-export. /src/lib/mcp/custom-tools.ts holds the
 * Atlas-authored draft -> sandbox -> live-load path. Wiring it here
 * lets /api/mcp-tools/[id]/test push a passing tool into the live
 * registry without import gymnastics. Tools that go 'active' here
 * survive only until the worker restarts; for permanence the file
 * has to be added as a static import next to the others on the next
 * deploy.
 */
export { registerCustomTool } from "../custom-tools";

// Force this module to be treated as having side effects by bundlers:
export const TOOLS_LOADED = true;
