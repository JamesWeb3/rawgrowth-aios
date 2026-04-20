"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { CONNECTORS, getConnector } from "@/lib/connectors";
import type { WritePolicy } from "@/components/agents/tools-picker";

/**
 * Connector picker shown in self-hosted mode. Purely informational —
 * storing a connector here doesn't grant OAuth or mint tokens. It tells
 * the operator which tools the agent is expected to use, and renders
 * logos on the agent card so the org chart reads at a glance.
 *
 * The actual auth + tool calls happen in the client's Claude Code via
 * Anthropic's native connectors (or community MCP servers for the rest).
 */
export function ConnectorsPicker({
  value,
  onChange,
}: {
  value: WritePolicy;
  onChange: (v: WritePolicy) => void;
}) {
  const [adding, setAdding] = useState(false);
  const selectedIds = Object.keys(value);
  const availableToAdd = CONNECTORS.filter((c) => !(c.id in value));

  function add(id: string) {
    onChange({ ...value, [id]: "direct" });
  }
  function remove(id: string) {
    const next: WritePolicy = { ...value };
    delete next[id];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        Tools this agent uses. Shown as logos on the agent card. Auth
        happens in your Claude connector settings — not here.
      </p>

      {selectedIds.length === 0 && !adding ? (
        <p className="text-[11.5px] italic text-muted-foreground">
          No connectors yet.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {selectedIds.map((id) => {
            const c = getConnector(id);
            if (!c) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[12px] font-medium text-foreground"
              >
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border"
                  style={{ backgroundColor: `${c.brand}1a` }}
                >
                  <c.Icon
                    className="size-3"
                    style={{ color: c.brand === "#FFFFFF" ? "#fff" : c.brand }}
                  />
                </span>
                <span>{c.label}</span>
                <button
                  type="button"
                  onClick={() => remove(id)}
                  className="-mr-1 rounded text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={`Remove ${c.label}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {adding && availableToAdd.length > 0 && (
        <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-card/40 p-2 sm:grid-cols-3">
          {availableToAdd.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                add(c.id);
                if (availableToAdd.length === 1) setAdding(false);
              }}
              className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-3 py-2 text-left text-[12px] font-medium text-muted-foreground hover:border-primary/30 hover:text-foreground"
            >
              <div
                className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border"
                style={{ backgroundColor: `${c.brand}1a` }}
              >
                <c.Icon
                  className="size-3.5"
                  style={{ color: c.brand === "#FFFFFF" ? "#fff" : c.brand }}
                />
              </div>
              <span className="truncate">{c.label}</span>
            </button>
          ))}
        </div>
      )}

      {availableToAdd.length > 0 && (
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <Plus className="size-3" />
          {adding ? "Done" : "Add connector"}
        </button>
      )}
    </div>
  );
}
