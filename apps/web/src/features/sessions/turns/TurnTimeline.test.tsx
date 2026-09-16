import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AgentTurn, SessionItem } from "@agents-core-web/agents-client";

import { formatTurnElapsed, TurnTimeline } from "./TurnTimeline";

function turn(id: string, status: AgentTurn["status"], overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    id,
    agent_id: "agent-1",
    session_id: "session-1",
    object: "agent.session.turn",
    status,
    created_at: 1_700_000_000,
    started_at: null,
    completed_at: null,
    error: null,
    usage: null,
    ...overrides,
  };
}

function render(turns: AgentTurn[], options: {
  items?: SessionItem[];
  loadState?: "idle" | "loading" | "ready" | "failed";
  sessionUsage?: AgentTurn["usage"];
  error?: string;
} = {}) {
  return renderToStaticMarkup(
    <TurnTimeline
      turns={turns}
      items={options.items ?? []}
      sessionUsage={options.sessionUsage ?? null}
      loadState={options.loadState ?? "ready"}
      error={options.error}
      nowSeconds={1_700_000_125}
    />,
  );
}

describe("Turn timeline presentation", () => {
  it("presents all six statuses with accessible labels", () => {
    const html = render([
      turn("queued", "queued"),
      turn("progress", "in_progress", { started_at: 1_700_000_000 }),
      turn("waiting", "waiting", { started_at: 1_700_000_100 }),
      turn("completed", "completed", { started_at: 1_700_000_000, completed_at: 1_700_000_062 }),
      turn("failed", "failed"),
      turn("cancelled", "cancelled"),
    ]);

    for (const label of ["Queued", "In progress", "Waiting", "Completed", "Failed", "Cancelled"]) {
      expect(html).toContain(`Turn status: ${label}`);
    }
    expect(html).toContain("Running · 2m 05s");
    expect(html).toContain("Running · 25s");
    expect(html).toContain("1m 02s");
  });

  it("uses only valid server timestamps and never converts missing values to zero", () => {
    expect(formatTurnElapsed(10, 10)).toBe("0s");
    expect(formatTurnElapsed(10, 9)).toBe("Unknown");
    expect(formatTurnElapsed(null, 20)).toBe("Unknown");
    const html = render([turn("missing", "completed", { started_at: null, completed_at: null })]);
    expect(html.match(/Unknown/g)?.length).toBeGreaterThanOrEqual(8);
    expect(html).not.toContain("1970-01-01");
  });

  it("separates Session aggregate from per-Turn usage and keeps partial values unknown", () => {
    const html = render([
      turn("measured", "completed", { usage: {
        input_tokens: 10,
        output_tokens: 4,
        total_tokens: 14,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens_details: { reasoning_tokens: 2 },
      } }),
      turn("partial", "completed", { usage: { input_tokens: 7 } as AgentTurn["usage"] }),
    ], { sessionUsage: {
      input_tokens: 17,
      output_tokens: 4,
      total_tokens: 21,
      input_tokens_details: { cached_tokens: 3 },
      output_tokens_details: { reasoning_tokens: 2 },
    } });

    expect(html).toContain("Session aggregate usage");
    expect(html.match(/<strong>Turn usage<\/strong>/g)).toHaveLength(2);
    expect(html).toContain("Unknown");
  });

  it("associates Items by turn_id while errors retain the conversation evidence", () => {
    const items: SessionItem[] = [
      { id: "one", turn_id: "failed", type: "message", status: "completed", role: "user", content: [] },
      { id: "two", turn_id: "failed", type: "command_execution", status: "failed" },
      { id: "orphan", turn_id: "not-loaded", type: "message", status: "completed", role: "assistant", content: [] },
    ];
    const html = render([
      turn("failed", "failed", { error: { code: "internal_error", message: "Safe durable failure" } }),
    ], { items });

    expect(html).toContain("2 linked Items");
    expect(html).toContain("Safe durable failure");
    expect(html).toContain("Conversation Items remain visible below.");
    expect(html).toContain("1 Item is not associated with an observed Turn yet.");
  });

  it("distinguishes loading, empty, and failed durable state", () => {
    expect(render([], { loadState: "loading" })).toContain("Loading every Turn page");
    expect(render([turn("live", "in_progress")], { loadState: "loading" })).toContain("Loading complete Turn history; live observations may already appear.");
    expect(render([], { loadState: "ready" })).toContain("No Turns reported yet.");
    const failed = render([turn("stale", "completed")], { loadState: "failed", error: "read unavailable" });
    expect(failed).toContain("Couldn’t load Turn history");
    expect(failed).toContain("read unavailable");
    expect(failed).toContain("last observed Turn timeline remains visible");
  });
});
