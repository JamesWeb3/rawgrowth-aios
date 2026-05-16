import test from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// P0-7 R02 close: code-enforce the one-org-per-VPS boundary. Migration
// 0014 dropped the DB trigger that used to guard cross-tenant inserts.
// Until this fix the drain server would happily spawn /chat | /triage
// | /run regardless of which tenant's row was about to be claimed.
//
// drain-server.mjs lives inline in scripts/provision-vps.sh between a
// `cat > /opt/rawclaw-drain/drain-server.mjs <<'JS'` heredoc. We read
// the script and pin the new VPS_ORG_ID symbols + the refusal flow so
// nobody removes the gate without turning this spec red.

const VPS_SCRIPT = readFileSync(
  resolve(__dirname, "../../scripts/provision-vps.sh"),
  "utf8",
);

function extractDrainJs(): string {
  const start = VPS_SCRIPT.indexOf("/opt/rawclaw-drain/drain-server.mjs <<'JS'");
  assert.ok(start !== -1, "drain-server.mjs heredoc start marker missing");
  const after = VPS_SCRIPT.slice(start);
  const endIdx = after.indexOf("\nJS\n");
  assert.ok(endIdx !== -1, "drain-server.mjs heredoc end marker missing");
  return after.slice(0, endIdx);
}

const DRAIN_JS = extractDrainJs();

test("drain-server reads VPS_ORG_ID at boot + warns on unset", () => {
  assert.match(
    DRAIN_JS,
    /const VPS_ORG_ID = \(process\.env\.VPS_ORG_ID \?\? ""\)\.trim\(\)/,
    "VPS_ORG_ID must be read + trimmed at module load",
  );
  // Loud startup log when the env var is missing so the operator
  // sees the failure mode immediately instead of debugging a silent
  // 503 from /chat at 3am.
  assert.match(
    DRAIN_JS,
    /VPS_ORG_ID env var is missing/,
    "missing VPS_ORG_ID must log a clear startup warning",
  );
});

test("drain-server refuses /chat /triage /run when VPS_ORG_ID is unset", () => {
  // refuseUnscoped() returns 503 + a clear body so callers can tell
  // the spawn was rejected (vs a routing 404). All three POST paths
  // must guard on VPS_ORG_ID - leaving even one ungated would re-
  // open R02.
  assert.match(
    DRAIN_JS,
    /function refuseUnscoped\(res, label\)[\s\S]*?writeHead\(503/,
    "refuseUnscoped must return 503 with a clear refusal body",
  );
  // Two guards: one shared by /chat + /triage (they branch into the
  // same trigger() call), one for /run. Three would mean somebody
  // forked the /chat path - fine, but assert >= 2 to keep both
  // surfaces covered without pinning the shape.
  const guards = DRAIN_JS.match(/if \(!VPS_ORG_ID\) {\s*\n\s*refuseUnscoped/g) ?? [];
  assert.ok(
    guards.length >= 2,
    `expected >=2 VPS_ORG_ID guards (one shared by /chat+/triage, one for /run), got ${guards.length}`,
  );
});

test("drain-server stamps VPS_ORG_ID into the spawned child env", () => {
  // childEnv() rebuilds the env explicitly so a tampered sub-env
  // cannot drift VPS_ORG_ID below the assertion downstream slash
  // commands run. The spawn calls must pass env: childEnv().
  assert.match(
    DRAIN_JS,
    /function childEnv\(\)[\s\S]*?return { \.\.\.process\.env, VPS_ORG_ID }/,
    "childEnv() must shallow-clone process.env + re-stamp VPS_ORG_ID",
  );
  const triggerSpawn = DRAIN_JS.indexOf("function trigger(");
  const triggerEnd = DRAIN_JS.indexOf("function spawnWithPrompt(");
  const triggerBlock = DRAIN_JS.slice(triggerSpawn, triggerEnd);
  assert.match(
    triggerBlock,
    /env: childEnv\(\)/,
    "trigger() must pass env: childEnv() to spawn",
  );
  const promptStart = DRAIN_JS.indexOf("function spawnWithPrompt(");
  const promptEnd = DRAIN_JS.indexOf("function readBody(");
  const promptBlock = DRAIN_JS.slice(promptStart, promptEnd);
  assert.match(
    promptBlock,
    /env: childEnv\(\)/,
    "spawnWithPrompt() must pass env: childEnv() to spawn",
  );
});

test("provision-vps.sh ships /etc/default/rawclaw-drain placeholder + EnvironmentFile wiring", () => {
  // Without the EnvironmentFile entry the systemd unit can't pick up
  // VPS_ORG_ID. The `-` prefix keeps the unit bootable during the
  // first-boot window before the file is populated; the drain
  // refuses spawns until VPS_ORG_ID arrives so the boundary still
  // holds.
  assert.match(VPS_SCRIPT, /cat > \/etc\/default\/rawclaw-drain <<'ENVFILE'/);
  assert.match(VPS_SCRIPT, /^VPS_ORG_ID=$/m);
  assert.match(VPS_SCRIPT, /EnvironmentFile=-\/etc\/default\/rawclaw-drain/);
});

test("drain-server log lines tag the spawn with the active org id", () => {
  // Every exit log carries org=<id|UNSET> so a tail of the log lets
  // an operator confirm spawns are scoped to the right tenant.
  assert.match(DRAIN_JS, /drain\[\$\{command\}\] exit=\$\{code\}[^\n]*org=\$\{VPS_ORG_ID \|\| "UNSET"\}/);
  assert.match(DRAIN_JS, /drain\[run\] exit=\$\{code\}[^\n]*org=\$\{VPS_ORG_ID \|\| "UNSET"\}/);
});
