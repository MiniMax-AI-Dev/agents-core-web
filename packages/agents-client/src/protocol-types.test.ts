import { describe, expect, expectTypeOf, it } from "vitest";

import fixture from "./fixtures/parsar-8cc2898c/environment-protocol.json";
import type {
  AgentEnvironment,
  AgentSessionEnvironmentEvent,
  EnvironmentConnectionAction,
  EnvironmentStatus,
  FunctionCallAction,
  RequiredAction,
  SelfHostedAgentEnvironment,
  UnknownAgentEnvironment,
  UnknownSessionEvent,
  UnknownSessionItem,
} from "./types";

describe("Parsar 8cc2898c Environment protocol types", () => {
  it("models none and the safe self_hosted Session response projection", () => {
    const none = fixture.environments.none as AgentEnvironment;
    const selfHosted = fixture.environments.self_hosted as SelfHostedAgentEnvironment;

    expect(none).toEqual({ type: "none" });
    expect(selfHosted).toEqual({
      type: "self_hosted",
      id: "environment_01",
      remote_url: "https://executor.example.test",
      workspace_directory: "/workspace/project",
      capability_directories: [],
    });
  });

  it("models both required action variants without inventing shared fields", () => {
    const actions = fixture.required_actions as RequiredAction[];
    const functionCall = actions[0] as FunctionCallAction;
    const environmentConnection = actions[1] as EnvironmentConnectionAction;

    expect(functionCall.type).toBe("function_call");
    expect(functionCall.arguments).toEqual({ query: "fixture" });
    expect(environmentConnection).toEqual({
      type: "environment_connection",
      environment_id: "environment_01",
    });
    expect("call_id" in environmentConnection).toBe(false);
  });

  it("covers every pinned Environment event state and the nullable safe error", () => {
    const events = fixture.environment_events as AgentSessionEnvironmentEvent[];

    expect(events.map((event) => event.environment.status)).toEqual([
      "pending",
      "ready",
      "connected",
      "disconnected",
      "failed",
    ] satisfies EnvironmentStatus[]);
    expect(events[4]?.environment.error).toEqual({
      code: "environment_failed",
      type: "environment_error",
      message: "The Environment could not become available.",
    });
    expectTypeOf<AgentSessionEnvironmentEvent["type"]>().toEqualTypeOf<
      `agent.session.environment.${EnvironmentStatus}`
    >();
  });

  it("keeps unknown Environment, Item, and Event payloads inspectable", () => {
    const environment = fixture.environments.unknown as unknown as UnknownAgentEnvironment;
    const item = fixture.unknown_item as unknown as UnknownSessionItem;
    const event = fixture.unknown_event as unknown as UnknownSessionEvent;
    const expired = fixture.unknown_expired_event as unknown as UnknownSessionEvent;

    expect(environment.type).toBe("future_remote");
    expect(environment.contract_marker).toBe("preserved");
    expect(item.type).toBe("computer_use_call");
    expect(item.contract_marker).toBe("preserved");
    expect(event.type).toBe("agent.session.environment.paused");
    expect(event.contract_marker).toBe("preserved");
    expect(expired.type).toBe("agent.session.environment.expired");
    expect(expired.contract_marker).toBe("unsupported_session_event_status");
  });
});
