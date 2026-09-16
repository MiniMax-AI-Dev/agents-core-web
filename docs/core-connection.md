# Connecting Agents Core Web to Agent Core

> Snapshot baseline: Parsar
> [`0438880ab21aa16d05cb91a4c7f91cc0abc12358`](https://github.com/MiniMax-AI-Dev/parsar/tree/0438880ab21aa16d05cb91a4c7f91cc0abc12358).
> This guide describes that exact upstream snapshot. Re-check the pinned
> [standalone service guide](https://github.com/MiniMax-AI-Dev/parsar/blob/0438880ab21aa16d05cb91a4c7f91cc0abc12358/services/agents-api/README.md),
> [contract coverage](https://github.com/MiniMax-AI-Dev/parsar/blob/0438880ab21aa16d05cb91a4c7f91cc0abc12358/contracts/agents-api/README.md),
> and [Environment contract](https://github.com/MiniMax-AI-Dev/parsar/blob/0438880ab21aa16d05cb91a4c7f91cc0abc12358/contracts/agents-api/environments.md)
> before upgrading.

Agents Core Web does not implement, copy, or embed Agent Core. It connects to the
independently deployable `services/agents-api` in the Parsar repository, or to another
Core implementing the same tested HTTP/SSE subset.

The standalone Core does not require the Parsar product server, product frontend,
product database, product users, or product organizations. Its tenant, organization,
project, and subject IDs are execution-service identities explicitly assigned by the
operator.

## What must run

```mermaid
flowchart LR
  browser["Browser"]
  proxy["Agents Core Web<br/>same-origin proxy / future BFF"]
  core["Standalone Agents API Core"]
  postgres[("Dedicated PostgreSQL")]
  daemon["parsar-daemon"]
  harness["Codex app-server<br/>or Claude Agent SDK"]
  provider["Model provider / MCP / tools"]

  browser -->|"same-origin /v1"| proxy
  proxy -->|"HTTP JSON + SSE stream<br/>Bearer + agents=v1"| core
  core <--> postgres
  daemon -->|"opens private reverse WebSocket"| core
  core -->|"bidirectional dispatch/events after connect"| daemon
  daemon --> harness --> provider
```

The protocols are intentionally different:

- Browser/Web to Core uses HTTP JSON plus authenticated `text/event-stream`.
- Public Core requests require `Authorization: Bearer ...` and
  `OpenAI-Beta: agents=v1`.
- Core to `parsar-daemon` uses a private Parsar reverse-WebSocket protocol and a
  separate device credential.
- `parsar-daemon` drives Codex with `codex app-server --stdio`, JSON-RPC 2.0 over
  newline-delimited JSON. Claude uses a separate packaged SDK bridge.
- Model/provider and tool credentials stay on the daemon/harness host.

The OpenAI Agents API, OpenAI Agents SDK, and Responses API are related but distinct.
Agents Core Web calls the pinned Agents HTTP resource shape; it does not embed an Agents
SDK loop or call the Responses API as its Core transport.

## Two startup modes

| Mode | Configuration | Result |
| --- | --- | --- |
| Full local chat | PostgreSQL, caller principal, Core with `AGENTS_API_DAEMON_WS_URL`, same-tenant device, connected daemon, native engine/provider setup | Agent CRUD, Sessions, Turns, Items, SSE, and supported execution |
| HTTP-only | PostgreSQL and caller principal; omit `AGENTS_API_DAEMON_WS_URL` | Agent CRUD and idle Session/history operations; input returns `503 execution_unavailable` |

Creating an Agent persists configuration only. It does not prove that a daemon, model,
or provider credential can execute it.

## Prerequisites

For the source-based local path below, install:

- Parsar at the snapshot above or another explicitly reviewed revision;
- Go matching upstream `go.mod` (`1.25.13` at this snapshot);
- Docker with Compose, or another dedicated PostgreSQL 16 installation;
- `openssl` and `uuidgen`;
- Node.js 22.12+ and pnpm 10.30.3 for Agents Core Web;
- a supported native harness on the daemon host, configured for its model provider.

Keep every listener on loopback in local development. Remote deployment requires TLS,
an authenticated reverse proxy/BFF, and an operator-reviewed secret/runtime design.

The current `environment: {"type":"none"}` path is not a Docker or E2B sandbox. The
daemon and native harness run with the authority of their operating-system user and
may invoke tools.

## 1. Start a dedicated PostgreSQL database

Run from the Parsar checkout. This reuses only its Postgres Compose service and uses a
separate project, account, database, volume namespace, and host port:

```bash
cd /path/to/parsar

PARSAR_PG_USER=agents_api \
PARSAR_PG_PASSWORD=agents_api_local \
PARSAR_PG_DB=agents_api \
PARSAR_POSTGRES_PORT=15433 \
docker compose \
  --project-name parsar-agents-api \
  --file docker-compose.dev.yml \
  up -d postgres
```

Verify that the container is ready:

```bash
PARSAR_PG_USER=agents_api \
PARSAR_PG_PASSWORD=agents_api_local \
PARSAR_PG_DB=agents_api \
PARSAR_POSTGRES_PORT=15433 \
docker compose \
  --project-name parsar-agents-api \
  --file docker-compose.dev.yml \
  exec -T postgres pg_isready -U agents_api -d agents_api
```

Never point the standalone Agents API migrator at the Parsar product database. A
Compose volume initialized previously with different credentials will retain its old
database settings; inspect it rather than deleting or recreating it blindly.

## 2. Create a caller principal and bearer

Agent Core does **not** automatically generate its caller bearer. The operator creates
the plaintext value, stores it only with the authorized caller, and stores its SHA-256
digest in Core's `keys.json`.

The current six-field binding is:

```json
[{
  "tenant_id": "<canonical nonzero UUID>",
  "organization_id": "<operator-assigned organization ID>",
  "project_id": "<operator-assigned project ID>",
  "subject_kind": "service_account",
  "subject_id": "<stable service-account ID>",
  "token_sha256": "<SHA-256 hex digest of the plaintext bearer>"
}]
```

`subject_kind` must be `service_account` or `user`. Only `tenant_id` must be a
canonical nonzero UUID. The other IDs must be nonempty with no surrounding whitespace
and should remain stable when a caller key is rotated.

This fresh-install block refuses to overwrite any existing credential file and does
not print the bearer:

```bash
(
  set -euo pipefail
  set -o noclobber
  umask 077

  agent_core_state="$HOME/.parsar/agents-api"
  mkdir -p "$agent_core_state"
  chmod 700 "$agent_core_state"

  for agent_core_file in web-token tenant-id keys.json; do
    if [ -e "$agent_core_state/$agent_core_file" ]; then
      printf 'Refusing to overwrite %s\n' "$agent_core_state/$agent_core_file" >&2
      exit 1
    fi
  done

  agent_core_tenant="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  agent_core_token="$(openssl rand -hex 32)"
  printf '%s' "$agent_core_token" > "$agent_core_state/web-token"
  printf '%s\n' "$agent_core_tenant" > "$agent_core_state/tenant-id"
  agent_core_digest="$(openssl dgst -sha256 "$agent_core_state/web-token" | awk '{print $NF}')"

  printf '[{\n  "tenant_id": "%s",\n  "organization_id": "local",\n  "project_id": "agents-core-web",\n  "subject_kind": "service_account",\n  "subject_id": "agents-core-web-local",\n  "token_sha256": "%s"\n}]\n' \
    "$agent_core_tenant" "$agent_core_digest" > "$agent_core_state/keys.json"

  chmod 600 \
    "$agent_core_state/keys.json" \
    "$agent_core_state/web-token" \
    "$agent_core_state/tenant-id"
)
```

The digest is calculated over the exact bearer without a newline. `keys.json` contains
execution-principal metadata plus only the digest; the separate `web-token` file is
the plaintext caller credential used by the local Web proxy.

These principal fields do not associate the key with Parsar product accounts or grant
product-user permissions. Optional `OpenAI-Organization` and `OpenAI-Project` request
headers, when supplied, must exactly match this binding.

## 3. Apply standalone Core migrations

Run from the Parsar checkout:

```bash
AGENTS_API_DATABASE_URL='postgres://agents_api:agents_api_local@127.0.0.1:15433/agents_api?sslmode=disable' \
  go run ./services/agents-api/cmd/migrate
```

The standalone service owns its database account, embedded migrations, and
`agents_api_schema_version`. Run its migrations before a reviewed Core upgrade.

You may alternatively run `make build-agents-api` and use the generated server,
migrator, and device binaries under `${PARSAR_HOME:-$HOME/.parsar}/build/agents-api`.

## 4. Start Core with the execution worker enabled

Keep the process in the foreground initially:

```bash
cd /path/to/parsar

env \
  -u AGENTS_API_EXECUTOR_URL \
  -u AGENTS_API_EXECUTOR_KEYS_FILE \
  -u AGENTS_API_HARNESS_KEYS_FILE \
  AGENTS_API_DATABASE_URL='postgres://agents_api:agents_api_local@127.0.0.1:15433/agents_api?sslmode=disable' \
  AGENTS_API_KEYS_FILE="$HOME/.parsar/agents-api/keys.json" \
  AGENTS_API_ADDR='127.0.0.1:8091' \
  AGENTS_API_ENGINE='codex' \
  AGENTS_API_DAEMON_WS_URL='ws://127.0.0.1:8091/api/v1/agent-daemon/ws' \
  go run ./services/agents-api/cmd/server
```

The public API base is `http://127.0.0.1:8091/v1`. The daemon WebSocket URL is
private infrastructure and must not be entered into the Web connection form.

`AGENTS_API_ENGINE` defaults to `codex` and selects the native profile for new
Sessions; it is not a model ID. Set it to `claude_sdk` only after preparing the
upstream packaged SDK runtime. Existing Sessions retain their stored engine.

Setting `AGENTS_API_DAEMON_WS_URL` creates both the private gateway and the execution
worker. Omitting it is the explicit HTTP-only mode described below.

## 5. Provision a same-tenant execution device

A device belongs to one execution tenant. Provision it using the `tenant_id` from the
same caller binding used by Web.

The device command generates a separate credential once. PostgreSQL stores its digest;
the plaintext exists only in the daemon profile. This block refuses to overwrite an
existing profile:

```bash
(
  set -euo pipefail
  umask 077

  cd /path/to/parsar

  agent_core_state="$HOME/.parsar/agents-api"
  daemon_profile='agents-api-local'
  daemon_root="${PARSAR_HOME:-$HOME/.parsar}/parsar-daemon"
  daemon_profile_dir="$daemon_root/$daemon_profile"

  mkdir -p "$daemon_root"
  if ! mkdir -m 700 "$daemon_profile_dir"; then
    printf 'Refusing to reuse daemon profile directory: %s\n' \
      "$daemon_profile_dir" >&2
    exit 1
  fi

  daemon_auth_tmp="$(mktemp "$daemon_profile_dir/auth.json.XXXXXX")"
  trap 'rm -f "$daemon_auth_tmp"' EXIT

  AGENTS_API_DATABASE_URL='postgres://agents_api:agents_api_local@127.0.0.1:15433/agents_api?sslmode=disable' \
    go run ./services/agents-api/cmd/device \
      --tenant "$(tr -d '\r\n' < "$agent_core_state/tenant-id")" \
      --name 'Agents Core Web local executor' \
      --url 'http://127.0.0.1:8091' \
      > "$daemon_auth_tmp"

  chmod 600 "$daemon_auth_tmp"
  mv "$daemon_auth_tmp" "$daemon_profile_dir/auth.json"
  trap - EXIT
)
```

The `--url` value is the path-free HTTP(S) Core origin. The generated profile stores
the daemon endpoint beneath `/api/v1`.

Caller keys and daemon credentials are not interchangeable. If a profile exists,
create a different profile and device rather than overwriting it. Revocation uses the
stored device `runtime_id` with the upstream `cmd/device --revoke` flow.

## 6. Start `parsar-daemon`

The default engine needs a working `codex` binary and native provider setup visible to
the daemon process. When Codex is not on `PATH`, set
`PARSAR_CODEX_BIN=/absolute/path/to/codex`. Do not print or copy provider credentials
into Core keys, Web settings, Session metadata, or Git.

Run the daemon in the foreground first:

```bash
cd /path/to/parsar

go run ./apps/parsar-daemon/cmd/parsar-daemon \
  connect --profile agents-api-local
```

Expected connection evidence includes successful native preflight, `bootstrap ok`,
and `ws connected`. The connection itself makes no model call. The first completed
Turn is the authoritative model/provider check.

If the harness executable or provider variables are configured only in a login shell,
load that environment and start the daemon in the same invocation. Never load a secret
in one process and assume another process inherited it.

### Codex managed-home credential caveat

For every Agent Session, Parsar supplies `AgentStateKey=agents-api-<session-id>`. The
daemon creates a matching managed `CODEX_HOME` beneath
`${PARSAR_HOME:-$HOME/.parsar}/parsar-daemon/agent-sessions/` and uses it for the
Codex child process. Consequently, a login stored only in the operator's default
`~/.codex/auth.json` is **not** inherited automatically.

Prefer a provider credential that the daemon process can inherit, or a reviewed
Core/daemon credential-provisioning mechanism. Do not print the value. If the only
available login is the default file, this no-overwrite copy can be used **only for a
controlled local smoke test**, after the idle Session exists and before its first
input:

```bash
(
  set -euo pipefail
  set -o noclobber
  umask 077

  session_id='<Session UUID shown by Agents Core Web>'
  if [[ ! "$session_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    printf 'Invalid Session UUID\n' >&2
    exit 1
  fi

  codex_home="${PARSAR_HOME:-$HOME/.parsar}/parsar-daemon/agent-sessions/agents-api-$session_id"
  mkdir -p "$codex_home"
  chmod 700 "$codex_home"
  cat "$HOME/.codex/auth.json" > "$codex_home/auth.json"
  chmod 600 "$codex_home/auth.json"
)
```

Use the same `PARSAR_HOME` as the daemon. This is not a Vault, provider, or production
credential design; the copied file is readable by the same operating-system account
and persists in that Session's managed state.

After foreground verification, the upstream CLI also supports background `connect -b`
plus `status`, `logs`, and `stop`. Redact paths and provider diagnostics before sharing
logs.

## 7. Start Agents Core Web

From this repository:

```bash
pnpm install
pnpm dev
```

The conventional local path needs no browser-visible secret:

- Core target defaults to `http://127.0.0.1:8091`;
- Vite reads `~/.parsar/agents-api/web-token` at server startup;
- browser JavaScript calls same-origin `/v1`;
- the Vite proxy injects the bearer upstream.

In the connection dialog, keep the base URL at `/v1` and leave the token field empty
when **Server-managed Core key active** appears.

The pinned stock Parsar Core does not install CORS middleware, so a browser at the
Web development origin cannot call `http://127.0.0.1:8091/v1` directly. Keep the
same-origin `/v1` proxy for Parsar Core. A direct base URL and manual bearer are only
for another compatible Core or proxy that explicitly allows the Web origin, methods,
and headers. That fallback stores the token in the current tab's `sessionStorage`,
where that tab's JavaScript and developer tools can read it; closing the tab clears
it. Never use this fallback as a production credential design.

For a different target or file, create the ignored `.env.local`:

```dotenv
AGENTS_API_PROXY_TARGET=http://127.0.0.1:8091
AGENTS_API_PROXY_TOKEN_FILE=/absolute/private/path/to/web-token
```

`AGENTS_API_PROXY_TOKEN` is a server-process alternative; never set it together with
the file option. Never use `VITE_*` for a credential because Vite embeds those values
in public browser JavaScript. Restart Vite after changing proxy configuration.

## HTTP-only mode

For UI work that intentionally needs no model execution, start Core without the
gateway variable:

```bash
env \
  -u AGENTS_API_DAEMON_WS_URL \
  -u AGENTS_API_EXECUTOR_URL \
  -u AGENTS_API_EXECUTOR_KEYS_FILE \
  -u AGENTS_API_HARNESS_KEYS_FILE \
  AGENTS_API_DATABASE_URL='postgres://agents_api:agents_api_local@127.0.0.1:15433/agents_api?sslmode=disable' \
  AGENTS_API_KEYS_FILE="$HOME/.parsar/agents-api/keys.json" \
  AGENTS_API_ADDR='127.0.0.1:8091' \
  AGENTS_API_ENGINE='codex' \
  go run ./services/agents-api/cmd/server
```

Agent CRUD and idle Session/history operations work. Chat input intentionally returns:

```json
{
  "error": {
    "message": "Execution is not enabled on this service.",
    "type": "server_error",
    "code": "execution_unavailable",
    "param": null
  }
}
```

This exact response occurs before the event body is admitted, so after an intentional
HTTP-only start it is safe to enable execution and submit the message. A timeout or
disconnected write is different. The client never retries automatically. The current
UI retains the original payload and idempotency key in memory only for an explicit,
byte-for-byte unchanged manual resend; editing the payload creates a new operation.
Refresh the durable Session, Items, and Turn timeline, and use Core logs when the
public resources are insufficient before deciding whether another submission is safe.

## Credential ownership

| Credential or identity | Created by | Stored by | Purpose |
| --- | --- | --- | --- |
| Caller bearer | Operator | Plaintext `web-token`; digest in Core `keys.json` | Authenticate Web or another Agents API caller |
| Six-field principal binding | Operator | Core configuration and immutable project-scope records | Bind a caller to execution tenant/project/subject identity |
| Daemon device credential | `cmd/device` | Plaintext daemon `auth.json`; digest in PostgreSQL | Authenticate one same-tenant execution device |
| PostgreSQL credential | Operator | Private deployment configuration | Access the dedicated execution database |
| Model/provider credential | Provider/native engine operator | Executor host only | Authorize native model/tool access |
| Product login/session | Parsar product | Parsar product services | Not accepted by standalone Agent Core |

Prefer a server-side proxy/BFF for the caller bearer. Never put these secrets in
`VITE_*`, browser bundles, `localStorage` or other persistent browser storage,
Agent/Session metadata, URLs, logs, Git, Issues, screenshots, or `.agents/`. The only
documented browser-storage exception is the current-tab `sessionStorage` fallback for
a CORS-enabled compatible Core; it is for development, not production.

## Verification

### Core liveness

```bash
curl --fail --silent --show-error http://127.0.0.1:8091/healthz
```

Expected:

```json
{"status":"ok"}
```

`/healthz` proves process liveness only. It does not prove database continuity, daemon
connectivity, model availability, or provider authentication.

### Authenticated API access

This sends the bearer through curl's stdin configuration instead of printing it:

```bash
agent_core_token="$(tr -d '\r\n' < "$HOME/.parsar/agents-api/web-token")"

{
  printf 'header = "Authorization: Bearer %s"\n' "$agent_core_token"
  printf 'header = "OpenAI-Beta: agents=v1"\n'
} | curl \
  --fail-with-body \
  --silent \
  --show-error \
  --config - \
  'http://127.0.0.1:8091/v1/agents?limit=1'

unset agent_core_token
```

Do not enable shell tracing while handling secrets.

### Read-only self-hosted Environment status

At this pinned revision, an existing `self_hosted` Session exposes an Environment ID.
Agents Core Web first retrieves the current Session and then makes one authenticated
`GET /v1/agents/environments/{environment_id}`. The response is accepted only when it
contains exactly `id`, `object`, `type`, `status`, `files`, `plugins`, and `skills`
with the expected ID, `agent.environment` / `self_hosted` discriminants, a supported
durable status, and arrays for installation metadata.

Durable status is `pending`, `connected`, `disconnected`, `expired`, or `failed`.
`ready` exists only in Session Environment SSE events. An empty installation array
means no API-managed installations; it is not proof of an empty Workspace or host.
A 401, 404, 5xx, network error, or malformed response makes only Environment status
unavailable; Session history and chat remain usable, and the Web performs no write or
automatic retry. This read does not prove executor, native runtime, model, or provider
readiness.

### End-to-end chat

In Agents Core Web:

1. Confirm `/v1` and **Server-managed Core key active**.
2. Create an Agent using a model known to the selected native runtime.
3. Create an `environment:none` Session and send one text message.
4. Confirm the events POST returns `204` and live lifecycle/output events arrive.
5. Confirm Items contain the user and assistant messages, then confirm the Turn
   timeline shows the terminal Turn snapshot, server wall-clock timestamps, and
   reported Usage. The timeline may also advance from an exact live lifecycle event;
   reload or use the corresponding authenticated API read for independent durable
   proof.
6. Reload and confirm the completed state is recovered from resource reads.

A completed Turn plus durable Item readback is execution evidence. Successful Agent
creation, `/healthz`, HTTP `204`, or `ws connected` alone is not.

## Troubleshooting

### `401 invalid_api_key`

Check that:

- Web reads the plaintext token whose digest is in the intended `keys.json`;
- the digest was calculated without a newline;
- Core's `AGENTS_API_KEYS_FILE` and Web's token-file setting refer to the same setup;
- the token file is mode `0600` or stricter;
- Core and Vite were restarted after rotation;
- optional organization/project headers are absent or exactly match;
- only one `Authorization` header is sent.

Core does not hot-reload its key file.

### Core rejects `keys.json`

Legacy entries with only `tenant_id` and `token_sha256` are invalid at the pinned
revision. Verify all six fields, a lowercase canonical nonzero tenant UUID, nonempty
trimmed IDs, `user` or `service_account`, a valid unique digest, and a non-conflicting
tenant ↔ organization/project mapping.

Startup validates project mappings atomically. A conflict aborts startup rather than
partially accepting the new configuration.

### `400 invalid_beta_header`

Every `/v1` Agents request must include exactly:

```http
OpenAI-Beta: agents=v1
```

The TypeScript client supplies it automatically.

### `503 execution_unavailable`

The exact message `Execution is not enabled on this service.` means Core was created
without an execution worker. Restart Core with:

```bash
AGENTS_API_DAEMON_WS_URL='ws://127.0.0.1:8091/api/v1/agent-daemon/ws'
```

Confirm that the URL ends exactly in `/api/v1/agent-daemon/ws`, then start a separately
provisioned same-tenant daemon. A different 503 can indicate execution-lease loss;
inspect Core logs and avoid blind resubmission.

### Turn stays queued or no output arrives

Check:

- a same-tenant device is connected with the intended profile and `PARSAR_HOME`;
- daemon logs contain `ws connected` and advertise the selected engine;
- Core and daemon protocol capabilities match;
- the native executable exists in the daemon process environment;
- only one worker owns the dedicated execution database;
- the device was not revoked;
- the model ID and provider credentials are valid on the harness host.

The engine is fixed when the Session is created. Core selects and stores the device
binding on first dispatch; subsequent Turns stay on that device. It does not silently
move an already bound Session to another host.

### Agent saves, but its model fails

Core stores the model string and exposes no live model catalog in the Web-used
surface. Web presets are suggestions only. Verify the native engine, provider access,
model ID, endpoint, and requested options on the executor host.

Changing a saved Agent does not rewrite existing Session snapshots, and changing
`AGENTS_API_ENGINE` affects only new Sessions. Create a new Session after correcting
those settings.

### SSE disconnects

SSE is live-only and does not replay missed history, including with `Last-Event-ID`.
The current UI reconnects for future events, buffers them, then retrieves Session and
Items and, for a current valid `self_hosted` ID, the durable Environment. It also
starts an independent all-pages Turn read so a slow Turn endpoint cannot delay
conversation recovery. It applies the Session/Items/Environment snapshot before newer
buffered events, merges Items by stable Item ID, and reconciles the eventual Turn list
with newer exact lifecycle snapshots. Late reads/events are fenced across Core,
Session, Environment, request/event revision, stream epoch, selection, and abort
boundaries.
Inspect durable state before resending an input whose acceptance is uncertain.

## Stop safely

For a normal local shutdown:

1. stop Web from sending new input;
2. allow active Turns to finish where practical;
3. stop a foreground daemon with `Ctrl-C`, or use its profile-aware `stop` command;
4. stop Core with `Ctrl-C`/`SIGINT`;
5. stop PostgreSQL without deleting its volume:

```bash
cd /path/to/parsar

docker compose \
  --project-name parsar-agents-api \
  --file docker-compose.dev.yml \
  stop postgres
```

Do not run `down -v` or delete `keys.json`, `web-token`, `tenant-id`, daemon
`auth.json`, or the database volume as part of a routine stop. Process shutdown fences
future writes but cannot prove that an already-issued native command or external side
effect stopped.

## Upgrade and rotation

Before changing the Parsar revision:

1. pin and record the exact upstream commit;
2. read its standalone guide, contract coverage, migration notes, and daemon
   compatibility notes;
3. stop new submissions and drain active work;
4. back up the dedicated execution database;
5. apply the standalone migrations and follow any explicit data-upgrade procedure;
6. start only the reviewed Core/daemon combination;
7. verify liveness, authentication, same-tenant connection, durable reads, and one
   explicitly authorized execution.

For a legacy two-field `keys.json`, preserve the token and tenant only when their
provenance is known. Add explicit stable organization, project, subject kind, and
subject ID fields. Never infer them from Session metadata or Parsar product tables.

When rotating a caller bearer, preserve the principal IDs, generate a new value,
replace both its digest and private Web token file, then restart Core and Web.

A replacement device serves new or not-yet-bound Sessions; connecting it does not
move existing bindings. Keep the old device available for Sessions already bound to
it, or explicitly retire those Sessions before revoking the old `runtime_id`.
Overwriting or deleting `auth.json` alone does not revoke the database credential.

Existing Sessions retain their engine, effective Agent configuration, and established
device binding across restarts. An upgrade or device rotation must not silently
reinterpret or move them.
