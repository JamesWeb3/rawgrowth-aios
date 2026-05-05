import { test } from "node:test";
import assert from "node:assert/strict";

import { ROLE_TEMPLATES } from "../../src/lib/agents/role-templates";
import {
  ROLE_TEMPLATE_LABELS,
  getRoleTemplateLabel,
} from "../../src/lib/agents/role-templates-client";

// Guards drift between the client-safe label list and the server-side
// catalog. The agent-sheet quick-hire flow uses the client list to
// short-circuit role lookups without dragging node:fs/promises into the
// browser bundle (Turbopack rejects that import).
test("client label list matches the server catalog keys", () => {
  const serverKeys = Object.keys(ROLE_TEMPLATES).sort();
  const clientLabels = [...ROLE_TEMPLATE_LABELS].sort();
  assert.deepEqual(clientLabels, serverKeys);
});

test("getRoleTemplateLabel is case-insensitive and returns canonical", () => {
  assert.equal(getRoleTemplateLabel("copywriter"), "Copywriter");
  assert.equal(getRoleTemplateLabel("COPYWRITER"), "Copywriter");
  assert.equal(getRoleTemplateLabel("Marketing Manager"), "Marketing Manager");
  assert.equal(getRoleTemplateLabel("not-a-role"), null);
  assert.equal(getRoleTemplateLabel(""), null);
});
