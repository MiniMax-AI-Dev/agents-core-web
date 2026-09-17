import { describe, expect, it } from "vitest";

import type { LocalDockerGuideProfile } from "../../../lib/docker-guide-config";
import { buildLauncherCommand, buildLocalDockerCommand } from "./environment-launcher";

const environmentId = "0f745b0d-b545-49cd-8d7e-4c31c80dc564";
const dockerProfile: LocalDockerGuideProfile = {
  image: "agents-core-web-executor:2b34ea46-codex-0.153.4",
  apiContainer: "agents-core-web-api",
  user: "501:20",
  credentialsHomePath: ".parsar/agents-api-web-smoke/executor-key.json",
  runtimeHomePath: ".parsar/agents-api-web-smoke/executors",
};

describe("Environment launcher commands", () => {
  it("builds the native launcher only from the strict supported projection", () => {
    const valid = (remoteUrl: string, id = environmentId) => (
      buildLauncherCommand(id, remoteUrl, "/executor/workspace", [])
    );
    const command = valid("https://executor.example.test");
    expect(command).toContain(`REMOTE_URL='https://executor.example.test'`);
    expect(command).toContain(`ENVIRONMENT_ID='${environmentId}'`);
    expect(command).toContain('agents-api-codex-executor \\\n  --remote "$REMOTE_URL"');
    expect(command).toContain('--credentials "$HOME/.parsar/executor-key.json"');
    expect(command).not.toContain("token");

    expect(valid("http://127.0.0.1:8091/")).not.toBeNull();
    expect(valid("http://executor.example.test")).toBeNull();
    expect(valid("https://user:secret@executor.example.test")).toBeNull();
    expect(valid("https://executor.example.test/path")).toBeNull();
    expect(valid("https://executor.example.test?token=secret")).toBeNull();
    expect(valid("https://executor.example.test", environmentId.toUpperCase())).toBeNull();
    expect(valid("https://executor.example.test", "00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(buildLauncherCommand(environmentId, "https://executor.example.test", null, [])).toBeNull();
    expect(buildLauncherCommand(environmentId, "https://executor.example.test", "relative", [])).toBeNull();
    expect(buildLauncherCommand(environmentId, "https://executor.example.test", "/workspace", null)).toBeNull();
    expect(buildLauncherCommand(environmentId, "https://executor.example.test", "/workspace", ["/capability"])).toBeNull();
  });

  it("builds a ready-to-copy local Docker command for a loopback Core", () => {
    const command = buildLocalDockerCommand(
      environmentId,
      "http://127.0.0.1:8091",
      "/good",
      [],
      dockerProfile,
    );
    expect(command).toContain("docker run --detach");
    expect(command).toContain(`ENVIRONMENT_ID='${environmentId}'`);
    expect(command).toContain("WORKSPACE_DIRECTORY='/good'");
    expect(command).toContain("HOST_WORKSPACE_DIRECTORY=\"${HOST_WORKSPACE_DIRECTORY:-$PWD}\"");
    expect(command).toContain('--network "container:$API_CONTAINER"');
    expect(command).toContain('--workdir "$WORKSPACE_DIRECTORY"');
    expect(command).toContain('src=$HOST_WORKSPACE_DIRECTORY,dst=$WORKSPACE_DIRECTORY');
    expect(command).toContain("agents-core-web-executor-$ENVIRONMENT_ID");
    expect(command).toContain(".parsar/agents-api-web-smoke/executor-key.json");
    expect(command).not.toContain("executor_token");
    expect(command).not.toContain("Authorization");
    expect(command).not.toContain("--rm");
    expect(command).not.toContain("--privileged");
  });

  it("keeps the Docker recipe local, opt-in, and fail-closed", () => {
    expect(buildLocalDockerCommand(environmentId, "http://127.0.0.1:8091", "/good", [], null)).toBeNull();
    expect(buildLocalDockerCommand(environmentId, "https://executor.example.test", "/good", [], dockerProfile)).toBeNull();
    expect(buildLocalDockerCommand(environmentId, "http://127.0.0.1:8091", "/bad,path", [], dockerProfile)).toBeNull();
    expect(buildLocalDockerCommand(environmentId, "http://127.0.0.1:8091", "/bad:path", [], dockerProfile)).toBeNull();
    expect(buildLocalDockerCommand(environmentId, "http://127.0.0.1:8091", "/good", ["/capability"], dockerProfile)).toBeNull();
    expect(buildLocalDockerCommand(environmentId, "http://127.0.0.1:8091", "/good", [], {
      ...dockerProfile,
      image: "executor; touch /tmp/pwned",
    })).toBeNull();
    expect(buildLocalDockerCommand(environmentId, "http://127.0.0.1:8091", "/good", [], {
      ...dockerProfile,
      credentialsHomePath: "../executor-key.json",
    })).toBeNull();
  });
});
