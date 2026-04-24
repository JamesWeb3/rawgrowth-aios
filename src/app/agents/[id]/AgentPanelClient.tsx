"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { TgProvisionModal } from "@/components/tg-provision-modal";

type Agent = {
  id: string;
  name: string;
  title: string;
  role: string | null;
  description: string | null;
  department: string | null;
  runtime: string | null;
  reports_to: string | null;
};

type MemoryEntry = {
  id: string;
  ts: string;
  kind: string;
  actor_type: string | null;
  actor_id: string | null;
  detail: Record<string, unknown> | null;
};

type Task = {
  id: string;
  status: string;
  source: string | null;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  routine_id: string | null;
};

type Telegram = {
  status: string;
  display_name: string | null;
  metadata: Record<string, unknown> | null;
} | null;

type Tab = "overview" | "memory" | "tasks" | "settings";

export function AgentPanelClient({
  agent,
  memory,
  tasks,
  telegram,
}: {
  agent: Agent;
  memory: MemoryEntry[];
  tasks: Task[];
  telegram: Telegram;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [draftDescription, setDraftDescription] = useState(
    agent.description ?? "",
  );
  const [draftRuntime, setDraftRuntime] = useState(agent.runtime ?? "");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [tgOpen, setTgOpen] = useState(false);

  async function savePersona() {
    setSaving(true);
    setSavedFlash(null);
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description: draftDescription,
          runtime: draftRuntime,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Update failed");
      }
      setSavedFlash("Saved");
    } catch (err) {
      setSavedFlash((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-[var(--brand-bg)]">
      <header className="shrink-0 border-b border-[var(--line)] px-6 py-4">
        <p className="text-xs uppercase tracking-widest text-primary">
          {agent.department ?? "Agent"}
        </p>
        <h1 className="mt-1 text-2xl text-[var(--text-strong)]">
          {agent.name}
        </h1>
        <p className="text-sm text-[var(--text-muted)]">{agent.title}</p>
      </header>

      <nav className="shrink-0 border-b border-[var(--line)] px-6">
        <div className="flex gap-6 text-sm">
          {(["overview", "memory", "tasks", "settings"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={
                "py-3 uppercase tracking-widest " +
                (tab === t
                  ? "text-primary border-b-2 border-primary"
                  : "text-[var(--text-muted)] hover:text-[var(--text-strong)]")
              }
            >
              {t}
            </button>
          ))}
        </div>
      </nav>

      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        {tab === "overview" && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <section className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
              <h3 className="text-xs uppercase tracking-widest text-primary">
                Role
              </h3>
              <p className="mt-2 text-sm text-[var(--text-body)]">
                {agent.description ?? "—"}
              </p>
            </section>

            <section className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
              <h3 className="text-xs uppercase tracking-widest text-primary">
                Telegram
              </h3>
              {telegram?.status === "connected" ? (
                <p className="mt-2 text-sm text-[var(--text-body)]">
                  Connected as{" "}
                  <span className="font-mono text-primary">
                    {telegram.display_name}
                  </span>
                </p>
              ) : (
                <p className="mt-2 text-sm text-[var(--text-muted)]">
                  {telegram?.status === "pending_token"
                    ? "Pending. Paste a BotFather token to go live."
                    : "Not configured."}
                </p>
              )}
              <Button
                className="mt-3"
                onClick={() => setTgOpen(true)}
                variant={telegram?.status === "connected" ? "ghost" : "default"}
              >
                {telegram?.status === "connected"
                  ? "Replace token"
                  : "Add to Telegram"}
              </Button>
            </section>

            <section className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
              <h3 className="text-xs uppercase tracking-widest text-primary">
                Runtime
              </h3>
              <p className="mt-2 font-mono text-sm text-[var(--text-body)]">
                {agent.runtime ?? "default"}
              </p>
            </section>

            <section className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
              <h3 className="text-xs uppercase tracking-widest text-primary">
                Recent activity
              </h3>
              <p className="mt-2 text-sm text-[var(--text-body)]">
                {memory.length} memory entries · {tasks.length} routine runs
              </p>
            </section>
          </div>
        )}

        {tab === "memory" && (
          <ul className="space-y-2">
            {memory.length === 0 && (
              <li className="text-sm text-[var(--text-muted)]">
                No memory entries yet.
              </li>
            )}
            {memory.map((m) => (
              <li
                key={m.id}
                className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-3"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[11px] uppercase text-primary">
                    {m.kind}
                  </span>
                  <time className="text-[11px] text-[var(--text-muted)]">
                    {new Date(m.ts).toLocaleString()}
                  </time>
                </div>
                <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-[var(--text-body)]">
                  {JSON.stringify(m.detail, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        )}

        {tab === "tasks" && (
          <ul className="space-y-2">
            {tasks.length === 0 && (
              <li className="text-sm text-[var(--text-muted)]">
                No routine runs assigned to this agent.
              </li>
            )}
            {tasks.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-3"
              >
                <div>
                  <span
                    className={
                      "inline-block rounded px-2 py-0.5 text-[11px] uppercase tracking-widest " +
                      (t.status === "succeeded"
                        ? "bg-[#0f1a0d] text-[#aad08f]"
                        : t.status === "failed"
                          ? "bg-[#1a0b08] text-[#f4b27a]"
                          : "bg-[var(--brand-surface-2)] text-primary")
                    }
                  >
                    {t.status}
                  </span>
                  <span className="ml-3 font-mono text-xs text-[var(--text-muted)]">
                    {t.source ?? "—"}
                  </span>
                </div>
                <time className="text-[11px] text-[var(--text-muted)]">
                  {t.started_at
                    ? new Date(t.started_at).toLocaleString()
                    : "—"}
                </time>
              </li>
            ))}
          </ul>
        )}

        {tab === "settings" && (
          <div className="max-w-2xl space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-widest text-primary">
                System prompt
              </label>
              <textarea
                rows={6}
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface-2)] px-3 py-2 text-sm text-[var(--text-strong)]"
              />
            </div>

            <div>
              <label className="block text-xs uppercase tracking-widest text-primary">
                Model
              </label>
              <select
                value={draftRuntime}
                onChange={(e) => setDraftRuntime(e.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface-2)] px-3 py-2 text-sm text-[var(--text-strong)]"
              >
                <option value="">default</option>
                <option value="claude-opus-4-7">Opus 4.7 (managers)</option>
                <option value="claude-sonnet-4-6">
                  Sonnet 4.6 (sub-agents)
                </option>
                <option value="claude-haiku-4-5-20251001">
                  Haiku 4.5 (high-volume)
                </option>
              </select>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={savePersona} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              {savedFlash && (
                <span className="text-sm text-[var(--text-muted)]">
                  {savedFlash}
                </span>
              )}
            </div>
          </div>
        )}
      </main>

      {tgOpen && (
        <TgProvisionModal
          agentId={agent.id}
          agentName={agent.name}
          agentRole={agent.reports_to ? "sub-agent" : "manager"}
          onClose={() => setTgOpen(false)}
          onConnected={() => {
            setTgOpen(false);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}
