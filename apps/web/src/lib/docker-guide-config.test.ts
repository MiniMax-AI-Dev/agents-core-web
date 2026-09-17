import { describe, expect, it } from "vitest";

import { loadLocalDockerGuideProfile } from "./docker-guide-config";

const valid = {
  AGENTS_CORE_WEB_DOCKER_GUIDE: "1",
  AGENTS_CORE_WEB_DOCKER_IMAGE: "agents-core-web-executor:2b34ea46-codex-0.153.4",
  AGENTS_CORE_WEB_DOCKER_API_CONTAINER: "agents-core-web-api",
  AGENTS_CORE_WEB_DOCKER_USER: "501:20",
  AGENTS_CORE_WEB_DOCKER_CREDENTIALS_HOME_PATH: ".parsar/agents-api-web-smoke/executor-key.json",
  AGENTS_CORE_WEB_DOCKER_RUNTIME_HOME_PATH: ".parsar/agents-api-web-smoke/executors",
};

describe("local Docker guide configuration", () => {
  it("is disabled unless the operator opts in exactly", () => {
    expect(loadLocalDockerGuideProfile({})).toBeNull();
    expect(loadLocalDockerGuideProfile({ ...valid, AGENTS_CORE_WEB_DOCKER_GUIDE: "true" })).toBeNull();
  });

  it("accepts a complete non-secret local profile", () => {
    expect(loadLocalDockerGuideProfile(valid)).toEqual({
      image: valid.AGENTS_CORE_WEB_DOCKER_IMAGE,
      apiContainer: valid.AGENTS_CORE_WEB_DOCKER_API_CONTAINER,
      user: valid.AGENTS_CORE_WEB_DOCKER_USER,
      credentialsHomePath: valid.AGENTS_CORE_WEB_DOCKER_CREDENTIALS_HOME_PATH,
      runtimeHomePath: valid.AGENTS_CORE_WEB_DOCKER_RUNTIME_HOME_PATH,
    });
  });

  it("fails closed for partial or command-bearing values", () => {
    expect(() => loadLocalDockerGuideProfile({
      ...valid,
      AGENTS_CORE_WEB_DOCKER_IMAGE: "image; docker rm -f victim",
    })).toThrow("safe Docker image reference");
    expect(() => loadLocalDockerGuideProfile({
      ...valid,
      AGENTS_CORE_WEB_DOCKER_CREDENTIALS_HOME_PATH: "../executor-key.json",
    })).toThrow("safe HOME-relative path");
    expect(() => loadLocalDockerGuideProfile({
      ...valid,
      AGENTS_CORE_WEB_DOCKER_USER: "0:0",
    })).toThrow("numeric non-root");

    const partial: Record<string, string> = { ...valid };
    delete partial.AGENTS_CORE_WEB_DOCKER_RUNTIME_HOME_PATH;
    expect(() => loadLocalDockerGuideProfile(partial)).toThrow("AGENTS_CORE_WEB_DOCKER_RUNTIME_HOME_PATH is required");
  });
});
