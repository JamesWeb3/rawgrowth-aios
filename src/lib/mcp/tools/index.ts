/**
 * Tool loader — importing this file triggers every tool module's
 * registerTool() side effects. The MCP route imports this once.
 *
 * Add a new integration? Create a new file next to this one, register
 * your tools at module scope, and add the import here.
 */

import "./knowledge";
import "./gmail";
import "./runs";
import "./agents";
import "./routines";
import "./approvals";
import "./telegram";
// import "./shopify";   // re-enable when Shopify access is available
// import "./outlook";   // re-enable when Microsoft Graph access is available
// import "./canva";     // re-enable when Canva developer creds are set up

// Force this module to be treated as having side effects by bundlers:
export const TOOLS_LOADED = true;
