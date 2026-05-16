import test from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// drain-server.mjs lives inline in scripts/provision-vps.sh between
// the `cat > /opt/rawclaw-drain/drain-server.mjs <<'JS'` heredoc
// markers. Extracting it into a standalone module would require a
// larger refactor of the provisioner; for now the unit suite reads
// the script and asserts that the R1 startup-sweep + safety-heartbeat
// symbols are present. If anyone accidentally drops the sweep block
// the suite turns red before deploy.

const VPS_SCRIPT = readFileSync(
  resolve(__dirname, "../../scripts/provision-vps.sh"),
  "utf8",
);

function extractDrainServerJs(): string {
  const start = VPS_SCRIPT.indexOf("/opt/rawclaw-drain/drain-server.mjs <<'JS'");
  assert.ok(start !== -1, "drain-server.mjs heredoc start marker missing");
  const after = VPS_SCRIPT.slice(start);
  const endIdx = after.indexOf("\nJS\n");
  assert.ok(endIdx !== -1, "drain-server.mjs heredoc end marker missing");
  return after.slice(0, endIdx);
}

const DRAIN_JS = extractDrainServerJs();

test("drain-server declares startup sweep + safety heartbeat env knobs", () => {
  assert.match(DRAIN_JS, /DRAIN_STARTUP_SWEEP_MS/);
  assert.match(DRAIN_JS, /DRAIN_SAFETY_SWEEP_MS/);
  assert.match(DRAIN_JS, /SWEEP_COMMANDS\s*=\s*\["rawgrowth-chat",\s*"rawgrowth-triage"\]/);
});

test("drain-server defines a sweep() helper that triggers both surfaces", () => {
  assert.match(
    DRAIN_JS,
    /function sweep\(reason\)\s*{[\s\S]*?for \(const command of SWEEP_COMMANDS\)[\s\S]*?trigger\(command\)/,
    "sweep() must iterate SWEEP_COMMANDS and call trigger()",
  );
});

test("drain-server fires startup sweep once and a safety-heartbeat interval on listen", () => {
  // R1 close: a restart must drain whatever piled up while the server
  // was down. Without setTimeout-startup the next inbound HTTP would be
  // the only kick; without setInterval-safety a silent stretch leaves
  // pending rows stuck until the next external nudge.
  assert.match(
    DRAIN_JS,
    /setTimeout\(\(\) => sweep\("startup"\), STARTUP_SWEEP_DELAY_MS\)\.unref\(\)/,
    "startup sweep must run via setTimeout with .unref()",
  );
  assert.match(
    DRAIN_JS,
    /setInterval\(\(\) => sweep\("safety-heartbeat"\), SAFETY_SWEEP_MS\)\.unref\(\)/,
    "safety heartbeat must run via setInterval with .unref()",
  );
});

test("drain-server keeps the trigger() redrive contract so sweep is reentrant-safe", () => {
  // trigger() must still set slot.redrive when a command is already
  // running. Without that contract a sweep firing on top of an in-flight
  // claim would silently drop the second invocation - exactly the R1
  // failure we are closing.
  assert.match(DRAIN_JS, /slot\.redrive\s*=\s*true/);
  assert.match(DRAIN_JS, /if \(slot\.redrive\) trigger\(command\)/);
});
