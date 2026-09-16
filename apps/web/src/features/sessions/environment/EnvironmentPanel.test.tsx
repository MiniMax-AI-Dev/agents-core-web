import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  AgentEnvironment,
  AgentEnvironmentResource,
  EnvironmentResourceStatus,
  SessionEnvironmentStatus,
} from "@agents-core-web/agents-client";

import { EnvironmentPanel, sanitizeRemoteUrl } from "./EnvironmentPanel";
import type { EnvironmentObservation, LiveEnvironmentObservation } from "./environment-state";

const selfHosted: AgentEnvironment = {
  type: "self_hosted",
  id: "environment_01",
  remote_url: "https://user:password@executor.example.test/root?token=private#fragment",
  workspace_directory: "/workspace/<script>alert(1)</script>/project",
  capability_directories: ["/capabilities/one", `/capabilities/${"long/".repeat(80)}`],
};
const canonicalEnvironmentUuid = "0f745b0d-b545-49cd-8d7e-4c31c80dc564";

function observation(status: SessionEnvironmentStatus): LiveEnvironmentObservation {
  return {
    source: "live",
    environmentId: "environment_01",
    environmentType: "self_hosted",
    status,
    error: status === "failed" ? {
      code: "environment_failed",
      type: "environment_error",
      message: `Failed at https://user:pass@executor.example/private?token=secret#credential <script>alert(1)</script> Authorization: Bearer auth-secret X-API-Key: header-secret {"api_key":"sk-secret"} executor_key: executor-secret caller_key: caller-secret vault_id: vault-secret ${"x".repeat(400)}`,
    } : null,
    eventId: `event_${status}`,
  };
}

function durableObservation(
  status: EnvironmentResourceStatus,
  environmentId = "environment_01",
): EnvironmentObservation {
  const resource: AgentEnvironmentResource = {
    id: environmentId,
    object: "agent.environment",
    type: "self_hosted",
    status,
    files: [],
    plugins: [],
    skills: [],
  };
  return {
    source: "durable",
    environmentId,
    environmentType: "self_hosted",
    status,
    resource,
  };
}

function render(environment: AgentEnvironment, live: EnvironmentObservation | null = null) {
  return renderToStaticMarkup(
    <EnvironmentPanel environment={environment} observation={live} connectionActions={[]} />,
  );
}

describe("EnvironmentPanel", () => {
  it("renders environment:none as Core-owned with no Workspace", () => {
    const html = render({ type: "none" });
    expect(html).toContain("Core-owned");
    expect(html).toContain("No Workspace");
    expect(html).not.toContain("file://");
  });

  it("renders a canonical durable UUID for an uppercase Session Environment identity", () => {
    const environment = { ...selfHosted, id: canonicalEnvironmentUuid.toUpperCase() };
    const html = render(environment, durableObservation("connected", canonicalEnvironmentUuid));
    expect(html).toContain("Connected");
    expect(html).toContain("Status comes from the durable Environment resource");
    expect(html).not.toContain("Durable Environment status is unavailable");
  });

  it("sanitizes http(s) remote URLs and rejects other or malformed schemes", () => {
    expect(sanitizeRemoteUrl(selfHosted.remote_url)).toEqual({
      href: "https://executor.example.test/root",
      label: "https://executor.example.test/root",
    });
    expect(sanitizeRemoteUrl("http://127.0.0.1:8091/?key=private#fragment")).toEqual({
      href: "http://127.0.0.1:8091/",
      label: "http://127.0.0.1:8091/",
    });
    expect(sanitizeRemoteUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeRemoteUrl("file:///workspace/private")).toBeNull();
    expect(sanitizeRemoteUrl("not a url")).toBeNull();

    const html = render(selfHosted, observation("connected"));
    expect(html).toContain("https://executor.example.test/root");
    expect(html).not.toContain('href="https://executor.example.test/root"');
    expect(html).not.toContain("user:password");
    expect(html).not.toContain("token=private");
    expect(html).not.toContain("fragment");
    expect(html).not.toContain("file://");
  });

  it.each(["pending", "ready", "connected", "disconnected", "failed"] as SessionEnvironmentStatus[])(
    "renders the pinned %s live observation without executor inference",
    (status) => {
      const html = render(selfHosted, observation(status));
      expect(html).toContain(status.charAt(0).toUpperCase() + status.slice(1));
      expect(html).toContain("last supported live event observed");
      expect(html).toContain("does not prove executor");
    },
  );

  it.each(["pending", "connected", "disconnected", "expired", "failed"] as EnvironmentResourceStatus[])(
    "renders durable %s after reload without treating inventory as host capability",
    (status) => {
      const html = render(selfHosted, durableObservation(status));
      expect(html).toContain(status.charAt(0).toUpperCase() + status.slice(1));
      expect(html).toContain("Status comes from the durable Environment resource");
      expect(html).toContain("no API-managed files, plugins, or skills");
      expect(html).toContain("not host or Workspace inventory");
      expect(html).toContain("does not prove executor");
      if (status === "expired") {
        expect(html).toContain("Environment expired");
        expect(html).toContain("does not retry or recreate it");
      }
    },
  );

  it("renders a failed durable read as unavailable while leaving Workspace context visible", () => {
    const html = render(selfHosted, {
      source: "unavailable",
      environmentId: "environment_01",
      environmentType: "self_hosted",
      status: null,
    });
    expect(html).toContain("Unavailable");
    expect(html).toContain("conversation remains usable");
    expect(html).toContain("/workspace/&lt;script&gt;alert(1)&lt;/script&gt;/project");
    expect(html).not.toContain("Connected");
    expect(html).not.toContain("Ready");
  });

  it("shows directories only as escaped text and redacts unsafe error content", () => {
    const html = render(selfHosted, observation("failed"));
    expect(html).toContain("/workspace/&lt;script&gt;alert(1)&lt;/script&gt;/project");
    expect(html).toContain("/capabilities/long/");
    expect(html).not.toContain('href="/workspace/');
    expect(html).not.toContain("user:pass");
    expect(html).not.toContain("token=secret");
    expect(html).not.toContain("hidden-value");
    expect(html).not.toContain("auth-secret");
    expect(html).not.toContain("header-secret");
    expect(html).not.toContain("query-secret");
    expect(html).not.toContain("token-secret");
    expect(html).not.toContain("sk-secret");
    expect(html).not.toContain("executor-secret");
    expect(html).not.toContain("caller-secret");
    expect(html).not.toContain("vault-secret");
    expect(html).not.toContain("https://executor.example/private");
    expect(html).toContain("Raw error fields are hidden");
  });

  it("never renders arbitrary Environment error code or type fields", () => {
    const malicious = observation("failed");
    malicious.error = {
      code: "sk-proj-secret-value",
      type: "executor-secret",
      message: "vault_id: private-vault",
    };
    const html = render(selfHosted, malicious);
    expect(html).not.toContain("sk-proj-secret-value");
    expect(html).not.toContain("executor-secret");
    expect(html).not.toContain("private-vault");
    expect(html).toContain("Raw error fields are hidden");
  });

  it("fails closed for unknown types, missing fields, and unsafe URLs", () => {
    const unknown = render({ type: "future_remote", status: "expired", workspace_directory: "/secret" } as unknown as AgentEnvironment);
    expect(unknown).toContain("Environment unavailable");
    expect(unknown).toContain("Unknown type");
    expect(unknown).not.toContain("/secret");

    const missing = render({ type: "self_hosted" } as AgentEnvironment);
    expect(missing).toContain("ID unavailable");
    expect(missing).toContain("unsafe or malformed URL");
    expect(missing).toContain("Workspace directory");
    expect(missing).toContain("Unavailable");

    const unsafe = render({ ...selfHosted, remote_url: "data:text/html,<script>alert(1)</script>" });
    expect(unsafe).toContain("unsafe or malformed URL");
    expect(unsafe).not.toContain("data:text/html");

    const missingEnvironment = render(null as unknown as AgentEnvironment);
    expect(missingEnvironment).toContain("Environment unavailable");
    expect(missingEnvironment).toContain("Unknown type");
  });

  it("uses a durable environment_connection action without claiming connection", () => {
    const html = renderToStaticMarkup(
      <EnvironmentPanel
        environment={selfHosted}
        observation={null}
        connectionActions={[{ type: "environment_connection", environment_id: "environment_01" }]}
      />,
    );
    expect(html).toContain("Connection required");
    expect(html).toContain("No executor availability is inferred");

    const uuidHtml = renderToStaticMarkup(
      <EnvironmentPanel
        environment={{ ...selfHosted, id: canonicalEnvironmentUuid.toUpperCase() }}
        observation={null}
        connectionActions={[{ type: "environment_connection", environment_id: canonicalEnvironmentUuid }]}
      />,
    );
    expect(uuidHtml).toContain("Connection required");
  });
});
