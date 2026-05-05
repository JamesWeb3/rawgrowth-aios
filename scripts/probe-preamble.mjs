import "dotenv/config";
import { buildAgentChatPreamble } from "@/lib/agent/preamble";
const orgId = "257ca705-f607-4c78-a251-63cc5bbaa5a7";
const atlasId = "459afa7f-f416-4266-a597-504905773d6b";
const p = await buildAgentChatPreamble({
  orgId, agentId: atlasId, orgName: "Chris West Demo",
  queryText: "what's marketing working on",
});
console.log("=== preamble length:", p.length);
console.log("=== blocks present:");
const blocks = [
  ["Persona", /Role:|Persona:/],
  ["Org place", /Your place in the org/],
  ["Open insights", /Open anomalies you're accountable/],
  ["Pending tasks", /Your pending tasks/],
  ["Cross-dept activity", /Recent agent activity across the WHOLE org/],
  ["Atlas commander", /YOU ARE ATLAS/],
  ["Memory PINNED", /\[PINNED/],
  ["Memory RECENT", /\[RECENT/],
  ["Shared memory", /Shared org memory|SHARED/],
  ["Brand profile", /Brand profile for/],
  ["Per-agent RAG", /Relevant context retrieved/],
  ["Company corpus", /Company-wide context/],
  ["Council perspectives", /Council perspectives|consultCouncil/],
  ["TASK directive", /TASK CREATION/],
  ["Shared memory directive", /shared_memory.*importance/],
  ["Agent management", /AGENT MANAGEMENT/],
  ["Data ask directive", /DATA-ASK|<need scope/],
];
for (const [name, re] of blocks) {
  console.log(`  ${re.test(p) ? "✓" : "✗"} ${name}`);
}
console.log("\n=== first 800 chars ===");
console.log(p.slice(0, 800));
