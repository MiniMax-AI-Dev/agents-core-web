#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

export const CORE_DOCTOR_EXIT_CODES = Object.freeze({
  ok: 0,
  diagnosticFailure: 1,
  usageOrInternalError: 2,
});

const DEFAULT_TARGET = "http://127.0.0.1:8091";
const DEFAULT_TOKEN_FILE = "~/.parsar/agents-api/web-token";
const DEFAULT_PROFILE = "default";
const DEFAULT_TIMEOUT_MS = 3_000;
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 256 * 1024;
const PROFILE_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const CONFIG_KEYS = new Set([
  "AGENTS_API_KEYS_FILE",
  "AGENTS_API_PROXY_TARGET",
  "AGENTS_API_PROXY_TOKEN",
  "AGENTS_API_PROXY_TOKEN_FILE",
]);
const PATH_CONFIG_KEYS = new Set(["AGENTS_API_KEYS_FILE", "AGENTS_API_PROXY_TOKEN_FILE"]);
const SAFE_PATH_EXPANSION_KEYS = new Set(["HOME", "PARSAR_HOME"]);

const HELP = `Agents Core Doctor (read-only)

Usage:
  pnpm core:doctor -- [--parsar <checkout>] [--profile <name>] [--timeout-ms <milliseconds>]

The doctor performs only GET requests. It never creates an Agent, Session, Turn,
or Item, and it never makes a model/provider call. The optional Parsar checkout is
used only to run the upstream daemon status command. No credential value, response
body, daemon output, or private filesystem path is printed.

Exit codes:
  0  Core liveness and an authenticated basic Agents API read succeeded.
     A daemon may still be unobserved and execution/provider readiness is unknown.
  1  An actionable local configuration or Core connectivity/authentication check failed.
  2  Command usage is invalid or the doctor could not complete safely.
`;

class CoreDoctorUsageError extends Error {}

function optionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new CoreDoctorUsageError(`${option} requires a value`);
  }
  return value;
}

export function parseCoreDoctorArgs(argv) {
  let parsarPath;
  let profile = DEFAULT_PROFILE;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let help = false;
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "-h" || argument === "--help") {
      help = true;
      continue;
    }
    if (argument === "--parsar") {
      parsarPath = optionValue(argv, index, argument);
      index += 1;
      continue;
    }
    if (argument.startsWith("--parsar=")) {
      parsarPath = argument.slice("--parsar=".length);
      continue;
    }
    if (argument === "--profile") {
      profile = optionValue(argv, index, argument);
      index += 1;
      continue;
    }
    if (argument.startsWith("--profile=")) {
      profile = argument.slice("--profile=".length);
      continue;
    }
    if (argument === "--timeout-ms") {
      timeoutMs = Number(optionValue(argv, index, argument));
      index += 1;
      continue;
    }
    if (argument.startsWith("--timeout-ms=")) {
      timeoutMs = Number(argument.slice("--timeout-ms=".length));
      continue;
    }
    if (argument.startsWith("-")) {
      throw new CoreDoctorUsageError("unknown option");
    }
    positional.push(argument);
  }

  if (positional.length > 1 || (positional.length === 1 && parsarPath)) {
    throw new CoreDoctorUsageError("provide at most one Parsar checkout");
  }
  if (positional.length === 1) parsarPath = positional[0];
  if (typeof parsarPath === "string" && parsarPath.trim() === "") {
    throw new CoreDoctorUsageError("Parsar checkout cannot be empty");
  }
  if (!PROFILE_PATTERN.test(profile)) {
    throw new CoreDoctorUsageError("invalid daemon profile name");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new CoreDoctorUsageError("timeout must be between 100 and 60000 milliseconds");
  }

  return { help, parsarPath, profile, timeoutMs };
}

function resolveConfiguredPath(configuredPath, homeDir, rootDir) {
  if (configuredPath === "~") return homeDir;
  if (configuredPath.startsWith("~/")) return join(homeDir, configuredPath.slice(2));
  return isAbsolute(configuredPath) ? configuredPath : resolve(rootDir, configuredPath);
}

async function readSmallText(path, maximumBytes = MAX_CONFIG_BYTES) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > maximumBytes) throw new Error("unsafe file");
  return readFile(path, "utf8");
}

function expandDotEnvValue(value, processEnv, runningParsed) {
  const environment = { ...runningParsed, ...processEnv };
  const expressionPattern = /(?<!\\)\${([^{}]+)}|(?<!\\)\$([A-Za-z_][A-Za-z0-9_]*)/g;
  const seen = new Set();
  let result = value;
  let match;
  while ((match = expressionPattern.exec(result)) !== null) {
    seen.add(result);
    const [template, bracedExpression, unbracedExpression] = match;
    const expression = bracedExpression || unbracedExpression;
    const operator = expression.match(/(:\+|\+|:-|-)/)?.[0] ?? null;
    const parts = expression.split(operator);
    const key = parts.shift();
    let fallback;
    let replacement;
    if ([":+", "+"].includes(operator)) {
      fallback = environment[key] ? parts.join(operator) : "";
      replacement = null;
    } else {
      fallback = parts.join(operator);
      replacement = environment[key];
    }
    if (replacement) {
      result = result.replace(template, seen.has(replacement) ? fallback : replacement);
    } else {
      result = result.replace(template, fallback);
    }
    if (result === runningParsed[key]) break;
    expressionPattern.lastIndex = 0;
  }
  return result;
}

function expandConfiguredValue(key, value, env) {
  const expressionPattern = /(?<!\\)\${([^{}]+)}|(?<!\\)\$([A-Za-z_][A-Za-z0-9_]*)/g;
  const referencedKeys = [];
  let match;
  while ((match = expressionPattern.exec(value)) !== null) {
    const expression = match[1] || match[2];
    referencedKeys.push(expression.split(/(:\+|\+|:-|-)/, 1)[0]);
  }
  if (referencedKeys.length === 0) return value.replace(/\\\$/g, "$");
  if (!PATH_CONFIG_KEYS.has(key) || referencedKeys.some((name) => !SAFE_PATH_EXPANSION_KEYS.has(name))) {
    throw new CoreDoctorUsageError("unsafe variable expansion in local Core configuration");
  }
  const safeEnvironment = Object.fromEntries([...SAFE_PATH_EXPANSION_KEYS].flatMap((name) =>
    typeof env[name] === "string" ? [[name, env[name]]] : [],
  ));
  return expandDotEnvValue(value, safeEnvironment, {}).replace(/\\\$/g, "$");
}

export async function loadCoreDoctorConfig({ env, cwd }) {
  const parsed = {};
  const dotenvFiles = [".env", ".env.local", ".env.development", ".env.development.local"];

  for (const name of dotenvFiles) {
    try {
      Object.assign(parsed, parseEnv(await readSmallText(join(cwd, name))));
    } catch (error) {
      if (error?.code !== "ENOENT") throw new CoreDoctorUsageError("local environment file is unreadable or unsafe");
    }
  }

  const loaded = {};
  for (const key of CONFIG_KEYS) {
    if (Object.hasOwn(env, key)) loaded[key] = String(env[key] ?? "");
    else if (Object.hasOwn(parsed, key)) loaded[key] = expandConfiguredValue(key, parsed[key], env);
  }
  return loaded;
}

function parseCoreTarget(value) {
  let target;
  try {
    target = new URL(value.trim());
  } catch {
    throw new CoreDoctorUsageError("Core proxy target is not a valid URL");
  }

  if (
    (target.protocol !== "http:" && target.protocol !== "https:") ||
    !target.hostname ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    (target.pathname !== "" && target.pathname !== "/")
  ) {
    throw new CoreDoctorUsageError("Core proxy target must be a credential-free HTTP(S) origin");
  }

  const hostname = target.hostname.toLowerCase();
  const loopback =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (target.protocol === "http:" && !loopback) {
    throw new CoreDoctorUsageError("remote Core proxy targets must use HTTPS");
  }

  return {
    displayOrigin: loopback ? target.origin : "remote HTTPS origin",
    healthUrl: new URL("/healthz", target.origin).href,
    agentsUrl: new URL("/v1/agents?limit=1", target.origin).href,
  };
}

function createReport() {
  const checks = [];
  return {
    add(level, layer, message) {
      checks.push({ level, layer, message });
    },
    render(exitCode) {
      const lines = ["Agents Core Doctor (read-only)", ""];
      for (const check of checks) lines.push(`[${check.level}] ${check.layer}: ${check.message}`);
      lines.push("");
      if (exitCode === CORE_DOCTOR_EXIT_CODES.ok) {
        lines.push("Result: Core API checks passed; execution readiness remains unknown.");
      } else if (exitCode === CORE_DOCTOR_EXIT_CODES.diagnosticFailure) {
        lines.push("Result: actionable local configuration or Core check failures were found.");
      } else {
        lines.push("Result: the doctor could not complete because invocation or configuration is invalid.");
      }
      return `${lines.join("\n")}\n`;
    },
    checks,
  };
}

function normalizeToken(rawToken) {
  const token = rawToken.trim();
  if (!token || token.length > 64 * 1024 || /\s/.test(token)) return undefined;
  return token;
}

async function inspectPrivateFile(path, label, { platform, report, required = true }) {
  let metadata;
  try {
    metadata = await stat(path);
  } catch (error) {
    if (!required && error?.code === "ENOENT") {
      report.add("UNKNOWN", label, "local file is not available; digest comparison was skipped.");
      return { exitCode: CORE_DOCTOR_EXIT_CODES.ok, value: undefined };
    }
    report.add("FAIL", label, "file is missing or unreadable.");
    return { exitCode: CORE_DOCTOR_EXIT_CODES.diagnosticFailure, value: undefined };
  }
  if (!metadata.isFile() || metadata.size > MAX_CONFIG_BYTES) {
    report.add("FAIL", label, "path is not a bounded regular file.");
    return { exitCode: CORE_DOCTOR_EXIT_CODES.diagnosticFailure, value: undefined };
  }
  if (platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    report.add("FAIL", label, "file is group/world accessible; use owner-only permissions.");
    return { exitCode: CORE_DOCTOR_EXIT_CODES.diagnosticFailure, value: undefined };
  }
  try {
    const value = await readFile(path, "utf8");
    report.add("PASS", label, "file is present with private permissions.");
    return { exitCode: CORE_DOCTOR_EXIT_CODES.ok, value };
  } catch {
    report.add("FAIL", label, "file is missing or unreadable.");
    return { exitCode: CORE_DOCTOR_EXIT_CODES.diagnosticFailure, value: undefined };
  }
}

function digestMatchesBinding(token, keysSource) {
  let bindings;
  try {
    bindings = JSON.parse(keysSource);
  } catch {
    return false;
  }
  if (!Array.isArray(bindings)) return false;
  const digest = createHash("sha256").update(token).digest("hex");
  return bindings.some((binding) =>
    binding &&
    typeof binding === "object" &&
    typeof binding.token_sha256 === "string" &&
    /^[a-fA-F0-9]{64}$/.test(binding.token_sha256) &&
    binding.token_sha256.toLowerCase() === digest,
  );
}

export async function inspectCoreCredentials({ config, cwd, homeDir, platform, report }) {
  const configuredToken = config.AGENTS_API_PROXY_TOKEN?.trim() ?? "";
  const configuredTokenFile = config.AGENTS_API_PROXY_TOKEN_FILE?.trim() ?? "";
  let exitCode = CORE_DOCTOR_EXIT_CODES.ok;
  let token;
  let tokenFile;

  if (configuredToken && configuredTokenFile) {
    report.add("FAIL", "Caller token", "choose only one server-side token source.");
    return { exitCode: CORE_DOCTOR_EXIT_CODES.diagnosticFailure, token: undefined };
  }

  if (configuredToken) {
    token = normalizeToken(configuredToken);
    if (token) report.add("PASS", "Caller token", "server-process token is configured in memory.");
    else {
      report.add("FAIL", "Caller token", "server-process token is empty or malformed.");
      exitCode = CORE_DOCTOR_EXIT_CODES.diagnosticFailure;
    }
  } else {
    tokenFile = resolveConfiguredPath(configuredTokenFile || DEFAULT_TOKEN_FILE, homeDir, cwd);
    const tokenInspection = await inspectPrivateFile(tokenFile, "Caller token", { platform, report });
    exitCode = Math.max(exitCode, tokenInspection.exitCode);
    if (tokenInspection.value !== undefined) {
      token = normalizeToken(tokenInspection.value);
      if (!token) {
        report.add("FAIL", "Caller token", "file does not contain one valid bearer token.");
        exitCode = CORE_DOCTOR_EXIT_CODES.diagnosticFailure;
      }
    }
  }

  const configuredKeysFile = config.AGENTS_API_KEYS_FILE?.trim();
  let keysFile;
  if (configuredKeysFile) keysFile = resolveConfiguredPath(configuredKeysFile, homeDir, cwd);
  else if (tokenFile) keysFile = join(dirname(tokenFile), "keys.json");

  if (!keysFile) {
    report.add("UNKNOWN", "Caller binding", "no local keys file is configured; digest comparison was skipped.");
    return { exitCode, token };
  }

  const keysInspection = await inspectPrivateFile(keysFile, "Caller binding", {
    platform,
    report,
    required: Boolean(configuredKeysFile),
  });
  exitCode = Math.max(exitCode, keysInspection.exitCode);

  if (keysInspection.value === undefined) {
    return { exitCode, token };
  }
  if (!token) {
    report.add("WARN", "Caller binding", "digest comparison skipped because no valid caller token is available.");
  } else if (digestMatchesBinding(token, keysInspection.value)) {
    report.add("PASS", "Caller binding", "caller token digest matches a keys.json binding.");
  } else {
    report.add("FAIL", "Caller binding", "caller token digest does not match any keys.json binding.");
    exitCode = Math.max(exitCode, CORE_DOCTOR_EXIT_CODES.diagnosticFailure);
  }

  return { exitCode, token };
}

async function readJsonResponse(response) {
  if (!response.body) throw new Error("missing body");
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body.cancel();
    throw new Error("response too large");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error("response too large");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function discardResponse(response) {
  await response.body?.cancel().catch(() => {});
}

async function fetchOnce(fetchImpl, url, init, timeoutMs) {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
}

export async function probeCore({ target, token, timeoutMs, fetchImpl, report }) {
  let exitCode = CORE_DOCTOR_EXIT_CODES.ok;
  let reachable = false;

  try {
    const response = await fetchOnce(fetchImpl, target.healthUrl, { method: "GET" }, timeoutMs);
    reachable = true;
    if (response.ok) {
      let health;
      try {
        health = await readJsonResponse(response);
      } catch {
        health = undefined;
      }
      if (health?.status === "ok") report.add("PASS", "Core liveness", "Core health endpoint responded ok.");
      else {
        report.add("FAIL", "Core liveness", "Core health response did not match the expected contract.");
        exitCode = CORE_DOCTOR_EXIT_CODES.diagnosticFailure;
      }
    } else {
      await discardResponse(response);
      report.add("FAIL", "Core liveness", `Core health endpoint returned HTTP ${response.status}.`);
      exitCode = CORE_DOCTOR_EXIT_CODES.diagnosticFailure;
    }
  } catch {
    report.add("FAIL", "Core liveness", "Core is unreachable or the liveness request timed out.");
    exitCode = CORE_DOCTOR_EXIT_CODES.diagnosticFailure;
  }

  if (!token) {
    report.add("WARN", "Core API", "authenticated read skipped because no valid caller token is available.");
    return { exitCode: Math.max(exitCode, CORE_DOCTOR_EXIT_CODES.diagnosticFailure) };
  }
  if (!reachable) {
    report.add("WARN", "Core API", "authenticated read skipped because Core was unreachable.");
    return { exitCode };
  }

  try {
    const response = await fetchOnce(
      fetchImpl,
      target.agentsUrl,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "openai-beta": "agents=v1",
        },
      },
      timeoutMs,
    );

    if (response.ok) {
      let payload;
      try {
        payload = await readJsonResponse(response);
      } catch {
        payload = undefined;
      }
      if (payload?.object === "list" && Array.isArray(payload.data)) {
        report.add("PASS", "Core API", "Core API authenticated; basic Agents read succeeded.");
      } else {
        report.add("FAIL", "Core API", "authenticated response did not match the expected list contract.");
        exitCode = CORE_DOCTOR_EXIT_CODES.diagnosticFailure;
      }
    } else {
      await discardResponse(response);
      if (response.status === 401 || response.status === 403) {
        report.add("FAIL", "Core API", `authentication was rejected (HTTP ${response.status}).`);
      } else if (response.status === 400) {
        report.add("FAIL", "Core API", "Agents protocol headers were rejected (HTTP 400).");
      } else if (response.status === 404 || response.status === 405) {
        report.add("FAIL", "Core API", `basic Agents read is unavailable (HTTP ${response.status}).`);
      } else {
        report.add("FAIL", "Core API", `basic Agents read failed (HTTP ${response.status}).`);
      }
      exitCode = CORE_DOCTOR_EXIT_CODES.diagnosticFailure;
    }
  } catch {
    report.add("FAIL", "Core API", "authenticated read failed or timed out.");
    exitCode = CORE_DOCTOR_EXIT_CODES.diagnosticFailure;
  }

  return { exitCode };
}

function minimalCommandEnvironment(env) {
  const allowed = ["GOCACHE", "GOENV", "GOMODCACHE", "GOPATH", "GOROOT", "HOME", "PARSAR_HOME", "PATH", "TMPDIR"];
  return Object.fromEntries(allowed.flatMap((name) =>
    typeof env[name] === "string" && env[name] !== "" ? [[name, env[name]]] : [],
  ));
}

async function spawnCommand({ command, args, cwd, env, timeoutMs }) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    const stdout = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({
        stdout: Buffer.concat(stdout).toString("utf8"),
        ...result,
      });
    };
    const collect = (chunks) => (chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        child.kill("SIGTERM");
        finish({ code: null, outputLimit: true });
      } else {
        chunks.push(chunk);
      }
    };
    child.stdout.on("data", collect(stdout));
    child.once("error", (error) => finish({ code: null, errorCode: error.code }));
    child.once("close", (code) => finish({ code }));
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ code: null, timedOut: true });
    }, timeoutMs);
  });
}

export function parseDaemonStatus(source) {
  if (/^paired\s*:\s*ERROR\b/im.test(source) || /^background\s*:\s*ERROR\b/im.test(source)) return "unknown";
  const paired = /^paired\s*:\s*yes\s*$/im.test(source);
  const unpaired = /^paired\s*:\s*no legacy profile\b/im.test(source);
  const background = /^background\s*:\s*pidfile present\b/im.test(source);
  const absent = /^background\s*:\s*not started\b/im.test(source);
  if (paired && background) return "paired-background-observed";
  if (paired && absent) return "paired-process-not-observed";
  if (unpaired && (absent || !background)) return "not-observed";
  return "unknown";
}

async function validateParsarCheckout(parsarPath) {
  try {
    const root = resolve(parsarPath);
    const [rootMetadata, moduleMetadata, commandMetadata] = await Promise.all([
      stat(root),
      stat(join(root, "go.mod")),
      stat(join(root, "apps/parsar-daemon/cmd/parsar-daemon/main.go")),
    ]);
    if (!rootMetadata.isDirectory() || !moduleMetadata.isFile() || !commandMetadata.isFile()) return undefined;
    return root;
  } catch {
    return undefined;
  }
}

export async function inspectDaemon({ parsarPath, profile, timeoutMs, env, runCommand, report }) {
  let command;
  let args;
  let cwd;

  if (parsarPath) {
    cwd = await validateParsarCheckout(parsarPath);
    if (!cwd) {
      report.add("FAIL", "Daemon", "the supplied Parsar checkout is invalid or unreadable.");
      return { exitCode: CORE_DOCTOR_EXIT_CODES.usageOrInternalError };
    }
    command = "go";
    args = ["run", "./apps/parsar-daemon/cmd/parsar-daemon", "status", "--profile", profile];
  } else {
    command = "parsar-daemon";
    args = ["status", "--profile", profile];
  }

  const result = await runCommand({
    command,
    args,
    cwd,
    env: minimalCommandEnvironment(env),
    timeoutMs: parsarPath ? Math.max(timeoutMs, 15_000) : timeoutMs,
  });

  if (result.code !== 0 || result.timedOut || result.outputLimit || result.errorCode) {
    report.add("WARN", "Daemon", "daemon profile/process status was not observed.");
    return { exitCode: CORE_DOCTOR_EXIT_CODES.ok };
  }

  const status = parseDaemonStatus(result.stdout);
  if (status === "paired-background-observed") {
    report.add("OBSERVED", "Daemon", "paired profile and pid file reported; process and connection remain unknown.");
  } else if (status === "paired-process-not-observed") {
    report.add("WARN", "Daemon", "profile is paired, but a daemon process was not observed.");
  } else if (status === "not-observed") {
    report.add("WARN", "Daemon", "daemon profile/process was not observed.");
  } else {
    report.add("WARN", "Daemon", "upstream status was inconclusive; daemon connection is unknown.");
  }
  return { exitCode: CORE_DOCTOR_EXIT_CODES.ok };
}

export async function runCoreDoctor({
  argv = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
  homeDir = homedir(),
  platform = process.platform,
  fetchImpl = globalThis.fetch,
  runCommand = spawnCommand,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let options;
  try {
    options = parseCoreDoctorArgs(argv);
  } catch {
    stderr.write("Invalid Core Doctor options. Run `pnpm core:doctor -- --help`.\n");
    return { exitCode: CORE_DOCTOR_EXIT_CODES.usageOrInternalError, checks: [] };
  }
  if (options.help) {
    stdout.write(HELP);
    return { exitCode: CORE_DOCTOR_EXIT_CODES.ok, checks: [] };
  }

  const report = createReport();
  let exitCode = CORE_DOCTOR_EXIT_CODES.ok;
  let config;
  let configLoaded = true;
  try {
    config = await loadCoreDoctorConfig({ env, cwd });
  } catch {
    report.add("FAIL", "Configuration", "local environment configuration is unreadable or unsafe.");
    exitCode = CORE_DOCTOR_EXIT_CODES.diagnosticFailure;
    config = {};
    configLoaded = false;
  }

  let target;
  if (configLoaded) {
    try {
      target = parseCoreTarget(config.AGENTS_API_PROXY_TARGET || DEFAULT_TARGET);
      report.add("PASS", "Configuration", `proxy target is configured (${target.displayOrigin}).`);
    } catch {
      report.add("FAIL", "Configuration", "proxy target must be credential-free HTTPS or a loopback HTTP origin.");
      exitCode = CORE_DOCTOR_EXIT_CODES.diagnosticFailure;
    }
  }

  const credentials = await inspectCoreCredentials({ config, cwd, homeDir, platform, report });
  exitCode = Math.max(exitCode, credentials.exitCode);

  if (target) {
    const core = await probeCore({
      target,
      token: credentials.token,
      timeoutMs: options.timeoutMs,
      fetchImpl,
      report,
    });
    exitCode = Math.max(exitCode, core.exitCode);
  } else {
    report.add("WARN", "Core liveness", "network checks skipped because the proxy target is invalid.");
    report.add("WARN", "Core API", "authenticated read skipped because the proxy target is invalid.");
  }

  const daemon = await inspectDaemon({
    parsarPath: options.parsarPath,
    profile: options.profile,
    timeoutMs: options.timeoutMs,
    env,
    runCommand,
    report,
  });
  exitCode = Math.max(exitCode, daemon.exitCode);
  report.add("UNKNOWN", "Execution", "executor, model, and provider readiness were not verified.");

  stdout.write(report.render(exitCode));
  return { exitCode, checks: report.checks };
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedUrl) {
  runCoreDoctor()
    .then(({ exitCode }) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.stderr.write("Core Doctor could not complete safely.\n");
      process.exitCode = CORE_DOCTOR_EXIT_CODES.usageOrInternalError;
    });
}
