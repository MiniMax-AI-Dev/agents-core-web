import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AgentSession } from "@agents-core-web/agents-client";

import type { ScopedEnvironmentObservation } from "../sessions/environment/environment-state";
import { EnvironmentsView, observedEnvironments } from "./EnvironmentsView";

const selfHosted: AgentSession = {
  id: "session-1",
  object: "agent.session",
  agent: {
    id: "agent-1",
    model: "provider/model",
    name: "Builder",
    instructions: null,
    multi_agent: { enabled: false, max_concurrent_subagents: null },
    reasoning: {},
    service_tier: "auto",
    text: { format: { type: "text" }, verbosity: "medium" },
    tools: [],
  },
  environment: {
    type: "self_hosted",
    id: "environment-1",
    remote_url: "https://executor.example/connect?private=hidden",
    workspace_directory: "/workspace/project",
    capability_directories: [],
  },
  status: "idle",
  error: null,
  metadata: {},
  required_actions: [],
  vault_ids: [],
  usage: null,
  created_at: 1,
  last_active_at: 1,
};

const expiredObservation: ScopedEnvironmentObservation = {
  sessionId: selfHosted.id,
  streamEpoch: 1,
  observation: {
    source: "durable",
    environmentId: "environment-1",
    environmentType: "self_hosted",
    status: "expired",
    resource: {
      id: "environment-1",
      object: "agent.environment",
      type: "self_hosted",
      status: "expired",
      files: [],
      plugins: [],
      skills: [],
    },
  },
};

describe("Environments overview", () => {
  it("derives only self-hosted projections and keeps the matching observation", () => {
    const none = { ...selfHosted, id: "session-none", environment: { type: "none" as const } };
    const observed = observedEnvironments(
      [none, selfHosted],
      new Map([[selfHosted.id, expiredObservation]]),
    );

    expect(observed).toHaveLength(1);
    expect(observed[0]?.environment.id).toBe("environment-1");
    expect(observed[0]?.observation?.status).toBe("expired");
  });

  it("ignores malformed and future Environment projections instead of crashing", () => {
    const malformed = {
      ...selfHosted,
      id: "session-malformed",
      environment: null,
    } as unknown as AgentSession;
    const future = {
      ...selfHosted,
      id: "session-future",
      environment: { type: "future_hosted", id: "environment-future" },
    } as unknown as AgentSession;

    expect(observedEnvironments([malformed, future], new Map())).toEqual([]);
    expect(() => renderToStaticMarkup(
      <EnvironmentsView
        sessions={[malformed, future]}
        observations={new Map()}
        onOpenSession={() => undefined}
      />,
    )).not.toThrow();
  });

  it("renders explicit catalog, template, key, and readiness boundaries", () => {
    const html = renderToStaticMarkup(
      <EnvironmentsView
        sessions={[selfHosted]}
        observations={new Map([[selfHosted.id, expiredObservation]])}
        onOpenSession={() => undefined}
      />,
    );

    expect(html).toContain("Not an exhaustive Environment catalog");
    expect(html).toContain("Environment templates");
    expect(html).toContain("Environment keys");
    expect(html).toContain("No secret is created, stored, or displayed here");
    expect(html).toContain("Environment expired");
    expect(html).toContain("does not prove executor, runtime, model, or provider readiness");
    expect(html).not.toContain("private=hidden");
  });
});
