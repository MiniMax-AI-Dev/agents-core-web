# Agents Core Web

**English** | [简体中文](README.zh-CN.md)

[Agents Core Web](https://github.com/MiniMax-AI-Dev/agents-core-web) is an open-source
web console and TypeScript client for the standalone
[Parsar Agents API Core](https://github.com/MiniMax-AI-Dev/parsar/tree/main/services/agents-api).
It provides reusable Agent management, durable Session conversations, live progress,
saved Items, cancellation, and function-result handoff without copying the Core into
this repository.

The Web can also connect to another Core that implements the same HTTP resources and
SSE behavior used by this client. “Compatible” means the tested subset documented in
[protocol coverage](docs/protocol-coverage.md), not full compatibility with OpenAI's
hosted Agents API.

> Current baseline: this documentation was checked against Parsar
> [`8cc2898c`](https://github.com/MiniMax-AI-Dev/parsar/commit/8cc2898ca42b272cb3771234ee6a0ad0d2e932ba)
> and its pinned `openai-python` 3.13.0 beta Agents resources. Parsar `main` and the
> upstream beta API can change; re-run the compatibility checks before upgrading.

## Relationship to Parsar

| Repository / component | Responsibility | Required for local Web chat? |
| --- | --- | --- |
| **Agents Core Web — this repository** | React/Vite UI, `@agents-core-web/agents-client`, same-origin development proxy | Yes |
| **Parsar `services/agents-api`** | Authentication, Agent/Session/Turn/Item persistence, SSE, admission, scheduling | Yes |
| **Parsar `parsar-daemon`** | Same-tenant execution device and native harness bridge | Yes for message execution; no for Agent CRUD or idle Sessions |
| **Codex app-server or Claude Agent SDK** | Native agent execution and provider/tool access on the daemon host | Yes for real Turns |
| **Parsar product stack** | Product Web, organizations, teams, members, billing | No; it is a separate product boundary |

Agents Core Web develops only the first row. Agent Core, daemon, and native adapters stay
in [MiniMax-AI-Dev/parsar](https://github.com/MiniMax-AI-Dev/parsar); fixes to those
components should be contributed upstream instead of vendored here.

## Architecture

```mermaid
flowchart LR
  user["User"]

  subgraph webrepo["agents-core-web · this repository"]
    ui["React + Vite UI"]
    client["@agents-core-web/agents-client"]
    edge["Development proxy<br/>Production reverse proxy / BFF"]
    ui --> client --> edge
  end

  subgraph parsarrepo["MiniMax-AI-Dev/parsar · upstream"]
    core["services/agents-api<br/>standalone Agent Core"]
    db[("Dedicated PostgreSQL")]
    gateway["Internal daemon gateway"]
    daemon["parsar-daemon"]
    harness["Codex app-server<br/>or Claude Agent SDK"]

    core <--> db
    core <--> gateway
    gateway <-->|"authenticated reverse WebSocket"| daemon
    daemon --> harness
  end

  compatible["Another Core implementing<br/>the Web-used API subset"]
  provider["Model provider / MCP / tools"]
  user --> ui
  edge -->|"HTTP JSON + SSE stream<br/>Bearer + OpenAI-Beta: agents=v1"| core
  client -. "direct CORS URL<br/>tab-scoped bearer" .-> compatible
  harness --> provider
```

The browser never talks to `parsar-daemon`. The daemon WebSocket is an internal
Parsar transport, not an Agents API URL and not something to enter in the Web
connection dialog. The pinned stock Core does not install browser CORS middleware,
so its supported local path is the same-origin `/v1` proxy. A direct URL is only for
another compatible Core that explicitly enables CORS. See
[the detailed architecture](docs/architecture.md).

## Local quickstart with working chat

This path starts the complete local chain. Starting only PostgreSQL and the HTTP Core
is enough to create Agents and idle Sessions, but message submission then returns
`503 execution_unavailable` by design.

Requirements:

- Node.js 22.12+ and pnpm 10.30.3 for this repository;
- Go 1.25.13 and Docker with Compose for the current Parsar checkout;
- `openssl` and `uuidgen` for the local caller credential example;
- a supported native harness on the daemon host, authenticated for its model provider.

The commands below assume separate checkouts of this repository and Parsar. They use
a dedicated local PostgreSQL database rather than the Parsar product database.

### 1. Start dedicated PostgreSQL

Run from the Parsar repository:

```bash
cd /path/to/parsar

PARSAR_PG_USER=agents_api \
PARSAR_PG_PASSWORD=agents_api_local \
PARSAR_PG_DB=agents_api \
PARSAR_POSTGRES_PORT=15433 \
docker compose \
  --project-name parsar-agents-api \
  --file docker-compose.dev.yml \
  up -d --wait postgres
```

### 2. Create the caller principal and bearer files

Core does **not** generate this API bearer automatically. The operator creates one
plaintext bearer for the caller and stores only its SHA-256 digest in the Core key
binding. Current Core requires all six binding fields:

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

`organization_id`, `project_id`, and the subject are explicit execution-service IDs;
they are not looked up from a Parsar product account. `subject_kind` is either
`service_account` or `user`. `keys.json` contains principal metadata plus the bearer
digest; the separate `web-token` file contains the plaintext value used by Web's
local server-side proxy.

### 3. Migrate and start Agent Core with execution enabled

Run migrations once, then keep the server in the foreground:

```bash
cd /path/to/parsar

AGENTS_API_DATABASE_URL='postgres://agents_api:agents_api_local@127.0.0.1:15433/agents_api?sslmode=disable' \
  go run ./services/agents-api/cmd/migrate

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

`AGENTS_API_ENGINE` chooses the native profile for **new Sessions**; it is independent
of the model ID entered when an Agent is created. Omit `AGENTS_API_DAEMON_WS_URL` only
for an intentional API-only setup with no Turn execution.

### 4. Register and connect a same-tenant daemon

In another terminal, from the Parsar repository, first ensure the selected harness is
installed and configured on this host. The default engine needs a working `codex`
binary; set `PARSAR_CODEX_BIN=/absolute/path/to/codex` when it is not on `PATH`.

Create a new daemon profile without overwriting an existing credential:

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
    printf 'Refusing to reuse daemon profile directory: %s\n' "$daemon_profile_dir" >&2
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

  exec go run ./apps/parsar-daemon/cmd/parsar-daemon \
    connect --profile "$daemon_profile"
)
```

The daemon should report `bootstrap ok` and `ws connected`. Its `auth.json` is a
separate device credential generated by `cmd/device`; it cannot replace the Web API
bearer. Model/provider credentials are a third concern and remain on the daemon or
harness host. A connection alone makes no model call; the first real Turn is the
authoritative execution check.

For Codex, the daemon assigns every Session a managed `CODEX_HOME` under its own
state root. A file-backed login in the operator's normal `~/.codex/auth.json` is
therefore not inherited automatically. Prefer a model/provider credential inherited
by the daemon process or a reviewed credential-provisioning path. Copying a login
file into one Session's managed home is only a controlled local smoke-test workaround,
not a production Vault or provider integration.

### 5. Start Agents Core Web

From this repository:

```bash
pnpm install
pnpm dev
```

The development server proxies same-origin `/v1` requests to
`http://127.0.0.1:8091` and automatically reads the conventional private bearer file
at `~/.parsar/agents-api/web-token`. Open the printed loopback URL, create or select
an Agent, create a Session, and send a message.

Keep `/v1` for stock Parsar Core. Its pinned server has no CORS middleware. Enter a
direct base URL only for another compatible Core that deliberately allows the Web
origin, methods, and headers; that manual fallback keeps its bearer only in the
current tab's `sessionStorage`.

For different paths or targets, copy `.env.example` to `.env.local` and set:

```bash
AGENTS_API_PROXY_TARGET=http://127.0.0.1:8091
AGENTS_API_PROXY_TOKEN_FILE=~/.parsar/agents-api/web-token
```

Use `AGENTS_API_PROXY_TOKEN` only as a server-process alternative and do not set it
together with the file option. Never use a `VITE_*` variable for a secret: Vite
embeds those values into browser JavaScript.

The full setup, API-only variant, validation commands, rotation, shutdown, and
troubleshooting are in [Connecting Agent Core](docs/core-connection.md).

## Agents, models, and multi-agent

- A saved **Agent** is reusable configuration: model, name, instructions, tools, and
  supported options. One project can save many Agents.
- A **Session** is a durable conversation. Each input creates or steers a **Turn**;
  **Items** are the durable messages, function calls, and outputs used for recovery.
- A model ID is a string passed to the selected execution engine. Core currently has
  no model-catalog endpoint, so Web suggestions are editable hints, not discovery or
  proof that a daemon can run a model.
- “Many saved Agents” is not the same as protocol **multi-agent/Subagents**. The
  latter remains outside the current Web UI and supported execution subset.

Public model suggestions can be changed in `.env.local`:

```bash
VITE_AGENT_MODEL_PRESETS=gpt-5.6-sol,gpt-5.6-terra,provider/custom-model
VITE_AGENT_DEFAULT_MODEL=gpt-5.6-sol
```

These values may contain model identifiers only, never provider credentials. Restart
the development server or rebuild Web after changing them.

## Communication and protocol boundaries

| Boundary | Protocol | Authentication | Meaning |
| --- | --- | --- | --- |
| Browser → local proxy / production BFF | Same-origin `/v1` HTTP | Web user/session policy; local proxy keeps the Core bearer server-side | Web deployment boundary |
| Proxy / BFF → Core | HTTP JSON plus authenticated SSE streaming under `/v1/agents/**` | `Authorization: Bearer …` and `OpenAI-Beta: agents=v1` | Fixed beta Agents API subset |
| Core ↔ `parsar-daemon` | Parsar internal reverse WebSocket with JSON envelopes | Separate device credential in daemon `auth.json` | Scheduling and execution transport, not OpenAI Agents API |
| Daemon ↔ Codex | `codex app-server --stdio`, JSON-RPC 2.0 over newline-delimited JSON | Native configuration on daemon host | Codex harness adapter |
| Daemon ↔ Claude | Claude Agent SDK bridge | Native configuration on daemon host | Alternative harness adapter |
| Harness → provider / MCP / tools | Provider-native protocols | Provider credentials on execution host | Never exposed to Web |

OpenAI's [Agents guide](https://developers.openai.com/api/docs/guides/agents)
distinguishes three concepts: Agents API runs a managed Codex harness; Agents SDK
runs an agent loop inside an application; Responses API is a lower-level model API.
They are not interchangeable protocols. Parsar Core implements part of the pinned
Agents API HTTP resource shape with its own storage and execution runtime; this Web
does not use the Agents SDK as its Core transport.

SSE is live-only. Web opens the stream before submitting input, but reconnecting does
not replay missed events, even with `Last-Event-ID`. The current UI reconnects and
buffers new events, then reads the durable Session and Items and reconciles them by
Item ID. Turn list/retrieve methods exist in the TypeScript client for diagnostics,
but the UI does not yet read them during recovery.

The client does not automatically retry an uncertain write. The current UI also does
not retain one generated idempotency key across a manual resend, so inspect durable
state before sending the input again. Cross-retry key persistence and reconciliation
race hardening are tracked in M1.

## Credentials and trust boundaries

| Credential | Held by | Purpose |
| --- | --- | --- |
| `web-token` plaintext bearer | Vite server, reverse proxy, or future BFF | Authenticate HTTP calls to one execution principal |
| `keys.json` binding | Agent Core | Bind bearer digest to tenant, organization, project, and subject IDs |
| daemon `auth.json` | `parsar-daemon` host | Authenticate one execution device to the same tenant |
| model/provider credential | Native harness host | Authenticate Codex/Claude/model/tool access |

None of these files is a Parsar product login or Web organization session, and the
credentials are not interchangeable. Prefer the server-side proxy. Do not put a
credential in Git, Session metadata, `localStorage` or other persistent browser
storage, `VITE_*`, snapshots, or logs. The manual direct-Core fallback is limited to
a CORS-enabled compatible Core and the current tab's `sessionStorage`; it is not a
production credential design. Production must terminate TLS and use an authenticated
reverse proxy/BFF instead of exposing the development proxy.

## Troubleshooting

| Symptom | Meaning / action |
| --- | --- |
| `401 invalid_api_key` | The plaintext bearer does not match a current `keys.json` digest, or optional organization/project headers conflict. Regenerate or rotate the binding and restart Core. |
| Core rejects `keys.json` at startup | Update old two-field bindings to all six current principal fields; use a canonical nonzero tenant UUID and `user` or `service_account`. |
| `503 execution_unavailable` on `POST .../events` | The exact “Execution is not enabled” message means Core started without the gateway/worker. Set `AGENTS_API_DAEMON_WS_URL`, restart Core, and connect a same-tenant daemon. A different 503 can indicate lease loss; inspect Core logs before retrying. |
| `/healthz` is OK but chat fails | Health proves HTTP liveness only. Check Core worker logs, daemon `ws connected`, harness preflight, model ID, and provider credentials. |
| Agent saves but its model fails | Saved configuration is not runtime capability discovery. Use an ID supported by the selected daemon/harness configuration. |
| Output disappeared after reconnect | SSE does not replay. Let the current UI recover persisted Session and Items; client Turn reads are available for diagnostics. Inspect durable state rather than retrying the input blindly. |

## Interface design

The UI follows Parsar's existing **The Issue Ledger** visual system instead of
inventing a new one. Semantic colors, system typography, navigation, ledger rows,
conversation thread, controls, and brand treatment are adapted from upstream
`apps/web`. Product features outside this repository's Agents API scope are not
copied.

## Repository shape

```text
apps/web/                 React + Vite product shell
packages/agents-client/  Typed Agents API client and SSE decoder
docs/                     architecture, Core connection, coverage, roadmap, iteration
scripts/                  local issue-intake and private workspace bootstrap
.github/                  checks and the public issue-intake gate
AGENTS.md                 tracked public contributor and Agent policy
.agents/                  ignored private prompts and run state; never commit
```

## Scope and non-goals

Included now:

- reusable Agent creation and listing;
- idle Session creation, live event subscription, message input, cancellation;
- durable Item recovery after reconnect and function result/error handoff;
- a typed adapter over HTTP JSON and fetch-based SSE;
- an isolated, Git-ignored workspace for issue-driven iteration.

Deliberately excluded:

- organizations, members, billing, marketplaces, and other Parsar product logic;
- reimplementation or vendoring of Agent Core, `parsar-daemon`, Codex, or Claude;
- treating the manual tab-scoped Core token fallback as a production credential
  design, or exposing daemon/provider credentials to the browser;
- assuming Docker, E2B, and AWS Bedrock AgentCore Runtime are interchangeable.
  Web exposes a runtime option only after a connected Core publishes and proves a
  compatible lifecycle contract.

## Issue-driven iteration pilot

The public Agent task issue form creates a candidate, not execution authority. A
maintainer must triage it and add `agent-ready`. The public workflow validates the
bounded fields and uploads a short-lived JSON task artifact without evaluating issue
text as code or shell input.

Run `pnpm agent:workspace` on a trusted runner to create the ignored local prompt and
state directory. The tracked root `AGENTS.md` is the public baseline automatically
used for repository work. The runner must additionally and explicitly load the
private `.agents/AGENTS.md` and `.agents/issue-agent.md` overlays; Git ignores them
and they are not automatic repository-root instructions. A fresh clone receives
placeholders that the operator fills locally; the committed bootstrap intentionally
does not contain the private prompt. Prompts, credentials, plans, and run state stay
operator-owned. There is no privileged bot, auto-merge, release, or deployment path
in this foundation.
See [the self-iteration contract](docs/self-iteration.md).

## Quality gate

```bash
pnpm check
```

The project is MIT licensed. Contributions must preserve the ownership and protocol
boundaries in [the architecture](docs/architecture.md) and update
[protocol coverage](docs/protocol-coverage.md) when behavior changes.
