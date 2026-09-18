import { describe, expect, it } from "vitest";

import {
  normalizeSessionEnvironmentInput,
  sessionEnvironmentInput,
  validateWorkspaceDirectory,
} from "./session-environment";

describe("Session environment input", () => {
  it("builds the exact environment:none request without Workspace fields", () => {
    expect(sessionEnvironmentInput("none", "/ignored")).toEqual({
      input: { type: "none" },
      error: null,
    });
  });

  it("builds the supported self-hosted request with explicitly empty capabilities", () => {
    expect(sessionEnvironmentInput("self_hosted", "/workspace/project with spaces")).toEqual({
      input: {
        type: "self_hosted",
        workspace_directory: "/workspace/project with spaces",
        capability_directories: [],
      },
      error: null,
    });
  });

  it("builds the exact managed default, enabled, and disabled requests", () => {
    expect(sessionEnvironmentInput("openai_hosted", "", "default")).toEqual({
      input: { type: "openai_hosted" },
      error: null,
    });
    expect(sessionEnvironmentInput("openai_hosted", "", "enabled")).toEqual({
      input: { type: "openai_hosted", network: { access: "enabled" } },
      error: null,
    });
    expect(sessionEnvironmentInput("openai_hosted", "", "disabled")).toEqual({
      input: { type: "openai_hosted", network: { access: "disabled" } },
      error: null,
    });
  });

  it("revalidates the finite Environment union and rejects forged hosted fields", () => {
    expect(normalizeSessionEnvironmentInput({ type: "openai_hosted" }).input).toEqual({ type: "openai_hosted" });
    expect(normalizeSessionEnvironmentInput({ type: "openai_hosted", network: { access: "disabled" } }).input)
      .toEqual({ type: "openai_hosted", network: { access: "disabled" } });
    for (const forged of [
      { type: "openai_hosted", network: null },
      { type: "openai_hosted", network: { access: "restricted" } },
      { type: "openai_hosted", network: { access: "enabled", allowed_domains: [] } },
      { type: "openai_hosted", template_id: "template" },
      { type: "self_hosted", workspace_directory: "/workspace", capability_directories: [], extra: true },
      { type: "none", network: { access: "disabled" } },
    ]) expect(normalizeSessionEnvironmentInput(forged).input).toBeNull();
  });

  it("rejects unknown Environment discriminators instead of rewriting them", () => {
    expect(sessionEnvironmentInput("future_environment", "/workspace")).toEqual({
      input: null,
      error: "The selected Environment type is unsupported.",
    });
  });

  it.each([
    "",
    "workspace",
    "./workspace",
    "~/workspace",
    " /workspace",
  ])("rejects a non-absolute Workspace directory: %j", (value) => {
    expect(validateWorkspaceDirectory(value)).toContain("absolute POSIX path");
    expect(sessionEnvironmentInput("self_hosted", value).input).toBeNull();
  });

  it.each([
    "/workspace\0secret",
    "/workspace\rsecret",
    "/workspace\nsecret",
    String.raw`/workspace\secret`,
  ])("rejects an unsafe Workspace directory: %j", (value) => {
    expect(validateWorkspaceDirectory(value)).toContain("cannot contain");
    expect(sessionEnvironmentInput("self_hosted", value).input).toBeNull();
  });

  it.each(["/", "/workspace", "//executor/workspace", "/workspace/../project"])(
    "accepts an absolute POSIX Workspace directory: %j",
    (value) => expect(validateWorkspaceDirectory(value)).toBeNull(),
  );
});
