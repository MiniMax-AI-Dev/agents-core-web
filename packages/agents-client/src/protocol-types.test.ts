import { describe, expect, expectTypeOf, it } from "vitest";

import fixture from "./fixtures/parsar-8cc2898c/environment-protocol.json";
import environmentResources from "./fixtures/parsar-0438880a/environment-resources.json";
import type {
  AgentEnvironmentResource,
  AgentEnvironment,
  AgentSessionEnvironmentEvent,
  EnvironmentConnectionAction,
  EnvironmentResourceStatus,
  FunctionCallAction,
  RequiredAction,
  SelfHostedAgentEnvironment,
  UnknownAgentEnvironment,
  UnknownSessionEvent,
  UnknownSessionItem,
  SessionEnvironmentStatus,
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
    ] satisfies SessionEnvironmentStatus[]);
    expect(events[4]?.environment.error).toEqual({
      code: "environment_failed",
      type: "environment_error",
      message: "The Environment could not become available.",
    });
    expectTypeOf<AgentSessionEnvironmentEvent["type"]>().toEqualTypeOf<
      `agent.session.environment.${SessionEnvironmentStatus}`
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

describe("Parsar 0438880a Environment retrieve resource", () => {
  it("models every durable resource status independently from live ready", () => {
    const resources = environmentResources.resources as AgentEnvironmentResource[];
    expect(resources.map((resource) => resource.status)).toEqual([
      "pending",
      "connected",
      "disconnected",
      "expired",
      "failed",
    ] satisfies EnvironmentResourceStatus[]);
    for (const resource of resources) {
      expect(Object.keys(resource).sort()).toEqual([
        "files", "id", "object", "plugins", "skills", "status", "type",
      ]);
      expect(resource.files).toEqual([]);
      expect(resource.plugins).toEqual([]);
      expect(resource.skills).toEqual([]);
    }
    expectTypeOf<EnvironmentResourceStatus>().not.toEqualTypeOf<SessionEnvironmentStatus>();
  });

  it("retains raw malformed and unsupported fixtures as untrusted test inputs", () => {
    expect(environmentResources.unsupported.ready.status).toBe("ready");
    expect(environmentResources.unsupported.unknown_type.type).toBe("openai_hosted");
    expect("skills" in environmentResources.malformed.missing_skills).toBe(false);
  });

  it("pins uppercase UUID lookup to the canonical response identity", () => {
    const retrieval = environmentResources.canonical_retrieve;
    const resource = retrieval.response as AgentEnvironmentResource;

    expect(retrieval.request_id.toLowerCase()).toBe(resource.id);
    expect(resource.object).toBe("agent.environment");
  });
});
