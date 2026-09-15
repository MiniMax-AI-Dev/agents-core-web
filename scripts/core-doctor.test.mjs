import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CORE_DOCTOR_EXIT_CODES,
  parseDaemonStatus,
  runCoreDoctor,
} from "./core-doctor.mjs";

const fixtureRoot = new URL("./fixtures/core-doctor/", import.meta.url);
const fixtureToken = "fixture-bearer";
const fixtureTarget = "https://core.fixture.invalid";

async function fixture(name) {
  return readFile(new URL(name, fixtureRoot), "utf8");
}

function captureStream() {
  let value = "";
  return {
    stream: {
      write(chunk) {
        value += String(chunk);
        return true;
      },
    },
    value: () => value,
  };
}

async function createLocalState(t, { keysFixture = "keys-matched.json", token = fixtureToken } = {}) {
  const root = await mkdtemp(join(tmpdir(), "agents-core-doctor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const homeDir = join(root, "home");
  const stateDir = join(homeDir, ".parsar", "agents-api");
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await writeFile(join(stateDir, "web-token"), token, { mode: 0o600 });
  await writeFile(join(stateDir, "keys.json"), await fixture(keysFixture), { mode: 0o600 });
  await chmod(join(stateDir, "web-token"), 0o600);
  await chmod(join(stateDir, "keys.json"), 0o600);
  return { root, homeDir, stateDir };
}

async function successfulFetchRecorder({ apiStatus = 200, apiBody, healthStatus = 200, healthBody } = {}) {
  const requests = [];
  const agentsBody = apiBody ?? await fixture("agents-list.json");
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    requests.push({
      url: parsed,
      method: init.method,
      headers: new Headers(init.headers),
      redirect: init.redirect,
    });
    if (parsed.pathname === "/healthz") {
      return new Response(healthBody ?? JSON.stringify({ status: "ok" }), {
        status: healthStatus,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(agentsBody, {
      status: apiStatus,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, requests };
}

async function runScenario({
  argv = [],
  env = {},
  cwd,
  homeDir,
  fetchImpl,
  runCommand = async () => ({ code: 0, stdout: await fixture("daemon-status-absent.txt"), stderr: "" }),
} = {}) {
  const stdout = captureStream();
  const stderr = captureStream();
  const result = await runCoreDoctor({
    argv,
    env,
    cwd,
    homeDir,
    platform: "darwin",
    fetchImpl,
    runCommand,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  return { result, stdout: stdout.value(), stderr: stderr.value() };
}

test("documents the read-only command and exit-code contract", async () => {
  const result = await runScenario({
    argv: ["--help"],
    env: {},
    cwd: process.cwd(),
    homeDir: tmpdir(),
    fetchImpl: async () => assert.fail("help must not make a request"),
    runCommand: async () => assert.fail("help must not inspect a daemon"),
  });

  assert.equal(result.result.exitCode, CORE_DOCTOR_EXIT_CODES.ok);
  assert.match(result.stdout, /performs only GET requests/);
  assert.match(result.stdout, /Exit codes:\n  0[\s\S]*\n  1[\s\S]*\n  2/);
  assert.equal(result.stderr, "");
});

test("authenticates a basic GET without leaking the token or daemon output", async (t) => {
  const state = await createLocalState(t);
  const { fetchImpl, requests } = await successfulFetchRecorder();
  const daemonOutput = await fixture("daemon-status-paired.txt");
  let commandCall;
  const result = await runScenario({
    env: {
      AGENTS_API_PROXY_TARGET: fixtureTarget,
      OPENAI_API_KEY: "provider-secret-marker",
      PATH: "/synthetic/bin",
      HOME: state.homeDir,
    },
    cwd: state.root,
    homeDir: state.homeDir,
    fetchImpl,
    runCommand: async (call) => {
      commandCall = call;
      return { code: 0, stdout: daemonOutput, stderr: "runner_credential=fixture-super-secret-token" };
    },
  });

  assert.equal(result.result.exitCode, CORE_DOCTOR_EXIT_CODES.ok);
  assert.match(result.stdout, /Core API authenticated; basic Agents read succeeded/);
  assert.match(result.stdout, /paired profile and pid file reported; process and connection remain unknown/);
  assert.doesNotMatch(result.stdout, /\[PASS\] Daemon/);
  assert.match(result.stdout, /executor, model, and provider readiness were not verified/);
  assert.doesNotMatch(result.stdout, new RegExp(fixtureToken));
  assert.doesNotMatch(result.stdout, /synthetic\/private|synthetic-runtime|synthetic-host/);
  assert.equal(result.stderr, "");
  assert.deepEqual(requests.map(({ method }) => method), ["GET", "GET"]);
  assert.deepEqual(requests.map(({ url }) => `${url.pathname}${url.search}`), ["/healthz", "/v1/agents?limit=1"]);
  assert.equal(requests[0].headers.has("authorization"), false);
  assert.equal(requests[1].headers.get("authorization"), `Bearer ${fixtureToken}`);
  assert.equal(requests[1].headers.get("openai-beta"), "agents=v1");
  assert.equal(requests[1].redirect, "error");
  assert.deepEqual(commandCall.args, ["status", "--profile", "default"]);
  assert.equal(commandCall.env.OPENAI_API_KEY, undefined);
});

test("reports missing conventional credential files and skips the authenticated read", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agents-core-doctor-missing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { fetchImpl, requests } = await successfulFetchRecorder();
  const result = await runScenario({
    env: { AGENTS_API_PROXY_TARGET: fixtureTarget },
    cwd: root,
    homeDir: root,
    fetchImpl,
  });

  assert.equal(result.result.exitCode, CORE_DOCTOR_EXIT_CODES.diagnosticFailure);
  assert.match(result.stdout, /Caller token: file is missing or unreadable/);
  assert.match(result.stdout, /Caller binding: local file is not available; digest comparison was skipped/);
  assert.match(result.stdout, /authenticated read skipped because no valid caller token/);
  assert.equal(requests.length, 1);
});

test("refuses to read a group/world-accessible token file", async (t) => {
  const state = await createLocalState(t);
  await chmod(join(state.stateDir, "web-token"), 0o644);
  const { fetchImpl, requests } = await successfulFetchRecorder();
  const result = await runScenario({
    env: { AGENTS_API_PROXY_TARGET: fixtureTarget },
    cwd: state.root,
    homeDir: state.homeDir,
    fetchImpl,
  });

  assert.equal(result.result.exitCode, CORE_DOCTOR_EXIT_CODES.diagnosticFailure);
  assert.match(result.stdout, /Caller token: file is group\/world accessible/);
  assert.equal(requests.length, 1);
  assert.doesNotMatch(result.stdout, new RegExp(state.stateDir.replaceAll("/", "\\/")));
});

test("fails when an available local keys file has unsafe permissions", async (t) => {
  const state = await createLocalState(t);
  await chmod(join(state.stateDir, "keys.json"), 0o644);
  const { fetchImpl, requests } = await successfulFetchRecorder();
  const result = await runScenario({
    env: { AGENTS_API_PROXY_TARGET: fixtureTarget },
    cwd: state.root,
    homeDir: state.homeDir,
    fetchImpl,
  });

  assert.equal(result.result.exitCode, CORE_DOCTOR_EXIT_CODES.diagnosticFailure);
  assert.match(result.stdout, /Caller binding: file is group\/world accessible/);
  assert.equal(requests.length, 2);
});

test("detects a caller digest mismatch while keeping the GET probe read-only", async (t) => {
  const state = await createLocalState(t, { keysFixture: "keys-mismatch.json" });
  const { fetchImpl, requests } = await successfulFetchRecorder();
  const result = await runScenario({
    env: { AGENTS_API_PROXY_TARGET: fixtureTarget },
    cwd: state.root,
    homeDir: state.homeDir,
    fetchImpl,
  });

  assert.equal(result.result.exitCode, CORE_DOCTOR_EXIT_CODES.diagnosticFailure);
  assert.match(result.stdout, /does not match any keys\.json binding/);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ method }) => method === "GET"));
});

test("allows an in-memory caller token when no local keys file is configured", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agents-core-doctor-inline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { fetchImpl, requests } = await successfulFetchRecorder();
  const result = await runScenario({
    env: {
      AGENTS_API_PROXY_TARGET: fixtureTarget,
      AGENTS_API_PROXY_TOKEN: fixtureToken,
    },
    cwd: root,
    homeDir: root,
    fetchImpl,
  });

  assert.equal(result.result.exitCode, CORE_DOCTOR_EXIT_CODES.ok);
  assert.match(result.stdout, /no local keys file is configured; digest comparison was skipped/);
  assert.match(result.stdout, /Core API authenticated; basic Agents read succeeded/);
  assert.equal(requests.length, 2);
});

test("treats conflicting server-side token sources as an actionable configuration failure", async (t) => {
  const state = await createLocalState(t);
  const { fetchImpl } = await successfulFetchRecorder();
  const result = await runScenario({
    env: {
      AGENTS_API_PROXY_TARGET: fixtureTarget,
      AGENTS_API_PROXY_TOKEN: fixtureToken,
      AGENTS_API_PROXY_TOKEN_FILE: join(state.stateDir, "web-token"),
    },
    cwd: state.root,
    homeDir: state.homeDir,
    fetchImpl,
  });

  assert.equal(result.result.exitCode, CORE_DOCTOR_EXIT_CODES.diagnosticFailure);
  assert.match(result.stdout, /choose only one server-side token source/);
});

test("distinguishes an unreachable Core without retrying", async (t) => {
  const state = await createLocalState(t);
  let calls = 0;
  const result = await runScenario({
    env: { AGENTS_API_PROXY_TARGET: "http://127.0.0.1:1" },
    cwd: state.root,
    homeDir: state.homeDir,
    fetchImpl: async () => {
      calls += 1;
      throw new TypeError("synthetic connection refused");
    },
  });

  assert.equal(result.result.exitCode, CORE_DOCTOR_EXIT_CODES.diagnosticFailure);
  assert.match(result.stdout, /Core is unreachable or the liveness request timed out/);
  assert.match(result.stdout, /authenticated read skipped because Core was unreachable/);
  assert.equal(calls, 1);
});

test("distinguishes a 401 from liveness and discards the response body", async (t) => {
  const state = await createLocalState(t);
  const { fetchImpl } = await successfulFetchRecorder({
    apiStatus: 401,
    apiBody: JSON.stringify({ error: { message: "session-private-marker", code: "invalid_api_key" } }),
  });
  const result = await runScenario({
    env: { AGENTS_API_PROXY_TARGET: fixtureTarget },
    cwd: state.root,
    homeDir: state.homeDir,
    fetchImpl,
  });

  assert.equal(result.result.exitCode, CORE_DOCTOR_EXIT_CODES.diagnosticFailure);
  assert.match(result.stdout, /authentication was rejected \(HTTP 401\)/);
  assert.doesNotMatch(result.stdout, /session-private-marker|invalid_api_key/);
});

test("loads Vite-style proxy dotenv configuration without exposing unrelated values", async (t) => {
  const state = await createLocalState(t);
  const { fetchImpl, requests } = await successfulFetchRecorder();
  await writeFile(join(state.root, ".env"), "AGENTS_API_PROXY_TARGET=https://base.fixture.invalid\n");
  await writeFile(
    join(state.root, ".env.local"),
    [
      "AGENTS_API_PROXY_TARGET='https://dotenv.fixture.invalid' # local override",
      "AGENTS_API_PROXY_TOKEN_FILE=${HOME}/.parsar/agents-api/web-token",
      "AGENTS_API_KEYS_FILE=\"${HOME}/.parsar/agents-api/keys.json\" # quoted path",
      "OPENAI_API_KEY=provider-secret-marker",
    ].join("\n"),
    { mode: 0o600 },
  );
  const result = await runScenario({
    env: { HOME: state.homeDir },
    cwd: state.root,
    homeDir: state.homeDir,
    fetchImpl,
  });

  assert.equal(result.result.exitCode, CORE_DOCTOR_EXIT_CODES.ok);
  assert.equal(requests[0].url.origin, "https://dotenv.fixture.invalid");
  assert.doesNotMatch(result.stdout, /provider-secret-marker/);
});

test("fails closed when a network target tries to expand an unrelated secret", async (t) => {
  const state = await createLocalState(t);
  await writeFile(
    join(state.root, ".env.local"),
    [
      "OPENAI_API_KEY=provider-secret-marker",
      "AGENTS_API_PROXY_TARGET=https://${OPENAI_API_KEY}.invalid",
      "AGENTS_API_PROXY_TOKEN_FILE=${HOME}/.parsar/agents-api/web-token",
    ].join("\n"),
    { mode: 0o600 },
  );
  let requests = 0;
  const result = await runScenario({
    env: { HOME: state.homeDir },
    cwd: state.root,
    homeDir: state.homeDir,
    fetchImpl: async () => {
      requests += 1;
      return new Response(JSON.stringify({ status: "ok" }));
    },
  });

  assert.equal(result.result.exitCode, CORE_DOCTOR_EXIT_CODES.diagnosticFailure);
  assert.equal(requests, 0);
  assert.match(result.stdout, /local environment configuration is unreadable or unsafe/);
  assert.doesNotMatch(result.stdout, /provider-secret-marker|OPENAI_API_KEY/);
});

test("uses an explicit Parsar checkout only for an allowlisted daemon status command", async (t) => {
  const state = await createLocalState(t);
  const parsarPath = join(state.root, "private-parsar-checkout");
  await mkdir(join(parsarPath, "apps", "parsar-daemon", "cmd", "parsar-daemon"), { recursive: true });
  await writeFile(join(parsarPath, "go.mod"), "module fixture.invalid/parsar\n");
  await writeFile(join(parsarPath, "apps", "parsar-daemon", "cmd", "parsar-daemon", "main.go"), "package main\n");
  const { fetchImpl } = await successfulFetchRecorder();
  let commandCall;
  const result = await runScenario({
    argv: ["--parsar", parsarPath, "--profile", "fixture-profile"],
    env: {
      AGENTS_API_PROXY_TARGET: fixtureTarget,
      HOME: state.homeDir,
      PATH: "/synthetic/bin",
      OPENAI_API_KEY: "provider-secret-marker",
    },
    cwd: state.root,
    homeDir: state.homeDir,
    fetchImpl,
    runCommand: async (call) => {
      commandCall = call;
      return { code: 0, stdout: await fixture("daemon-status-absent.txt"), stderr: "" };
    },
  });

  assert.equal(result.result.exitCode, CORE_DOCTOR_EXIT_CODES.ok);
  assert.equal(commandCall.command, "go");
  assert.equal(commandCall.cwd, parsarPath);
  assert.deepEqual(commandCall.args, [
    "run",
    "./apps/parsar-daemon/cmd/parsar-daemon",
    "status",
    "--profile",
    "fixture-profile",
  ]);
  assert.equal(commandCall.env.OPENAI_API_KEY, undefined);
  assert.doesNotMatch(result.stdout, /private-parsar-checkout|fixture-profile/);
});

test("parses only allowlisted daemon state and treats absence as non-fatal", async () => {
  assert.equal(parseDaemonStatus(await fixture("daemon-status-paired.txt")), "paired-background-observed");
  assert.equal(parseDaemonStatus(await fixture("daemon-status-absent.txt")), "not-observed");
  assert.equal(parseDaemonStatus("paired: ERROR — /synthetic/private/error"), "unknown");
});

test("never includes credential, response, URL suffix, provider, or private-path markers", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agents-core-doctor-redaction-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const privateDir = join(root, "synthetic-private-doctor-state");
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  const token = "fixture-super-secret-token";
  const digest = createHash("sha256").update(token).digest("hex");
  const keysPath = join(privateDir, "keys.json");
  await writeFile(keysPath, JSON.stringify([{ token_sha256: digest }]), { mode: 0o600 });
  await chmod(keysPath, 0o600);
  const { fetchImpl } = await successfulFetchRecorder({
    apiBody: JSON.stringify({
      object: "list",
      data: [{ id: "agent_fixture", name: "session-private-marker" }],
      has_more: false,
    }),
  });
  const result = await runScenario({
    env: {
      AGENTS_API_PROXY_TARGET: fixtureTarget,
      AGENTS_API_PROXY_TOKEN: token,
      AGENTS_API_KEYS_FILE: keysPath,
      OPENAI_API_KEY: "provider-secret-marker",
      HOME: root,
      PATH: "/synthetic/bin",
    },
    cwd: root,
    homeDir: root,
    fetchImpl,
    runCommand: async () => ({
      code: 0,
      stdout: await fixture("daemon-status-paired.txt"),
      stderr: "Authorization: Bearer fixture-super-secret-token",
    }),
  });

  assert.equal(result.result.exitCode, CORE_DOCTOR_EXIT_CODES.ok);
  const combined = `${result.stdout}\n${result.stderr}`;
  for (const marker of JSON.parse(await fixture("redaction-corpus.json"))) {
    assert.equal(combined.includes(marker), false, `report leaked marker: ${marker}`);
  }
  assert.equal(combined.includes(keysPath), false);
});

test("rejects credential-bearing target suffixes without reflecting them", async (t) => {
  const state = await createLocalState(t);
  const result = await runScenario({
    env: {
      AGENTS_API_PROXY_TARGET: "https://core.fixture.invalid/?access=query-secret-marker#fragment-secret-marker",
      HOME: state.homeDir,
    },
    cwd: state.root,
    homeDir: state.homeDir,
    fetchImpl: async () => assert.fail("invalid targets must not be requested"),
  });

  assert.equal(result.result.exitCode, CORE_DOCTOR_EXIT_CODES.diagnosticFailure);
  assert.match(result.stdout, /credential-free HTTPS or a loopback HTTP origin/);
  assert.doesNotMatch(result.stdout, /query-secret-marker|fragment-secret-marker/);
});

test("invalid options use exit 2 without reflecting untrusted argv", async () => {
  const result = await runScenario({
    argv: ["--profile", "../../query-secret-marker"],
    env: {},
    cwd: process.cwd(),
    homeDir: tmpdir(),
    fetchImpl: async () => assert.fail("invalid options must not make a request"),
  });

  assert.equal(result.result.exitCode, CORE_DOCTOR_EXIT_CODES.usageOrInternalError);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Invalid Core Doctor options/);
  assert.doesNotMatch(result.stderr, /query-secret-marker/);
});
