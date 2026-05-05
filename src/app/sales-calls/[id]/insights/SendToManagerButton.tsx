"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  salesCallId: string;
  callTitle: string;
  actions: string[];
};

/**
 * Pushes the suggested follow-ups into a new routine the Sales Manager
 * agent owns. We post to /api/routines (which gates by org + dept ACL)
 * with a `manual` trigger only - the operator runs it when ready. No
 * agent assignment is set here; the Sales Manager will pick it up via
 * the unassigned-routines lane.
 */
export function SendToManagerButton({
  salesCallId,
  callTitle,
  actions,
}: Props) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  if (actions.length === 0) return null;

  const onClick = async () => {
    setState("sending");
    setError(null);
    try {
      const description = [
        `Source: sales call ${callTitle} (${salesCallId})`,
        "",
        "Suggested follow-ups:",
        ...actions.map((a, i) => `${i + 1}. ${a}`),
      ].join("\n");
      const res = await fetch("/api/routines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `Follow up on ${callTitle}`,
          description,
          assigneeAgentId: null,
          triggers: [{ kind: "manual", enabled: true }],
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setState("sent");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "send failed");
    }
  };

  return (
    <div className="flex flex-col gap-2 pt-2">
      <Button
        type="button"
        onClick={onClick}
        disabled={state === "sending" || state === "sent"}
      >
        {state === "sent"
          ? "Sent to Sales Manager"
          : state === "sending"
            ? "Sending..."
            : "Send to Sales Manager"}
      </Button>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
