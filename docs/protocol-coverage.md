# Protocol coverage

This matrix is a delivery contract for Agents Core Web, not a claim of complete
OpenAI-hosted service compatibility.

## Compatibility baseline

- Parsar Core:
  [`8cc2898c`](https://github.com/MiniMax-AI-Dev/parsar/commit/8cc2898ca42b272cb3771234ee6a0ad0d2e932ba)
- Upstream resource source: `openai-python` 3.13.0 beta Agents resources at
  [`d7c41efe`](https://github.com/openai/openai-python/tree/d7c41efee1b0802b79f3f88a678ef2052b06e9ce/src/openai/resources/beta/agents)
- Required beta header: `OpenAI-Beta: agents=v1`
- Core base: same-origin `/v1` through the Web proxy for stock Parsar Core; a direct
  URL only for a compatible Core or proxy with explicit CORS support

Parsar's pinned inventory contains 42 upstream operations in 15 resource classes;
the referenced Core revision has handlers for 15 operations, and those handlers
still implement partial request/event semantics. Importing an official SDK or
accepting extra fields is not compatibility proof. Unsupported capabilities must
fail explicitly.

Requests use `Authorization: Bearer <execution-principal key>`. Optional
`OpenAI-Organization` and `OpenAI-Project` headers, when present, must exactly match
the Core key binding. Agents Core Web's local proxy owns the bearer server-side.

## Web-used surface

| Resource / behavior | TypeScript client | Initial UI | Notes |
| --- | --- | --- | --- |
| Saved Agents create/list | Yes | Yes | Model, name, instructions; many saved Agents per project |
| Saved Agents retrieve/update/delete | Yes | Yes | Agent details support viewing, editing, and deleting saved Agents |
| Sessions create/list/retrieve | Yes | Yes | UI creates idle `environment:none` Sessions; client types also cover the pinned `self_hosted` request and safe response projection |
| Sessions update/delete | Yes | Later | Metadata/delete UI deferred |
| Session live events | Yes | Yes | Authenticated `fetch` stream, not `EventSource` |
| Input message | Yes | Yes | Opens SSE before submission; each submission uses an idempotency key, but the UI does not persist it across a manual resend |
| Active Turn cancel | Yes | Yes | Submitted as a Session event, not a Turn-create endpoint |
| Turn retrieve/list | Yes | No | Durable diagnostics UI deferred |
| Item list/recovery | Yes | Yes | Authoritative recovery after stream loss |
| Function result/error | Yes | Yes | Initial UI supports text result/error handoff only for `function_call` actions |
| Initial-input creation stream | Later | No | Idle-create flow avoids the early-event race |
| Artifacts/files | Later | No | Required Core resources are not implemented |
| Environment connection action | Yes | Render-only | `environment_connection` is distinct from a function call; Web shows an operator-owned, non-actionable state and sends no result |
| Environment lifecycle events | Yes | No | Client models pending, ready, connected, disconnected, and failed snapshots; current UI does not project a Workspace lifecycle |
| Environment resources | Blocked upstream | No | No public create/list/retrieve Environment resource is implemented at the pinned Core revision |
| Vaults | Later | No | Credentials must never be stored in browser metadata |
| Protocol Subagents / enabled multi-agent | Later | No | Distinct from storing multiple Agent configurations |
| Usage/observability | Response types | No | Missing measurements remain unknown, not zero |

## Runtime boundary

- The Web currently creates only `environment: {"type":"none"}` Sessions.
- Parsar Core at the pinned revision also has a narrow, disabled-by-default Codex
  `self_hosted` profile for empty Session creation followed by constrained idle text
  input. The Web does not expose it, and it does not expand the missing public
  Environment/template/file resource surface.
- The reusable client distinguishes the admitted `self_hosted` request fields
  (`workspace_directory` and optional `capability_directories`) from the safe Session
  response projection (`id`, `remote_url`, `workspace_directory`, and normalized
  `capability_directories`). Unknown Environment variants remain opaque, inspectable
  records and are not eligible creation inputs.
- `required_actions` is a discriminated union. `function_call` carries call, Turn,
  function-name, and argument fields; `environment_connection` carries only
  `environment_id`. The initial Web renders the latter as an operator-owned wait and
  does not expose a Function Result form or claim that the browser can connect it.
- The pinned event contract defines Environment status snapshots for `pending`,
  `ready`, `connected`, `disconnected`, and `failed`, with a nullable structured
  error. At `8cc2898c`, retained public transport observations emit only
  `connected` and `disconnected`; the broader vocabulary is typed for safe receipt,
  not proof that every transition is currently emitted or rendered.
- Known Item and Session-event discriminants remain typed. Unknown variants retain
  their raw fields for inspection, but consumers must treat them as unavailable
  rather than infer a known rendering or action.
- The internal `parsar-daemon` WebSocket and the public `self_hosted` executor
  transport are different protocols. Neither is a generic Environment Provider.
- Docker, E2B, and AWS Bedrock AgentCore Runtime each need an upstream lifecycle and
  capability contract before the Web can advertise them.
- `AGENTS_API_ENGINE` selects `codex` or an operator-enabled `claude_sdk` profile for
  new Sessions. The browser sends a model ID, not an executor selector.
- Core has no standard model-catalog or capability-discovery route in this surface.
  Web model presets are editable suggestions; the first real Turn is authoritative.

Environment creation and management, provider selection, Files, Artifacts, Vault,
hosted runtimes, and Workspace lifecycle controls remain upstream-blocked or out of
scope. This type coverage does not advertise those capabilities.

## Live stream and recovery

`GET /v1/agents/sessions/{session_id}/events` is live-only. The client opens it
before submitting input. A reconnect, including one with `Last-Event-ID`, does not
replay missed work.

Recovery therefore follows this order:

1. reconnect the stream and buffer newly arriving events;
2. retrieve the persisted Session and Items;
3. merge buffered Items by stable Item ID under the current reconciliation policy;
4. inspect durable state before resubmitting an uncertain write.

Turn list/retrieve methods exist in the TypeScript client for diagnostics, but the
current UI does not invoke them during recovery. The client never retries a write
automatically. The current UI restores a failed draft but does not retain its original
idempotency key, so manually pressing Send again can create a distinct write. Same-ID
durable/live terminal precedence and pending-operation key persistence remain M1
hardening work.

HTTP acceptance, `/healthz`, an open SSE connection, and successful Agent creation
do not prove that a daemon, native harness, model ID, or provider credential can
complete a Turn.

## Terminology

- **OpenAI Agents API** is the managed-harness API described in the official
  [Agents guide](https://developers.openai.com/api/docs/guides/agents). Parsar
  implements part of a pinned beta HTTP resource shape with its own runtime.
- **OpenAI Agents SDK** is an application-hosted orchestration SDK. It is not the
  wire protocol between this Web and Core.
- **Responses API** is a lower-level model API and is not this repository's Core
  contract.
- **Parsar daemon protocol** is a private reverse-WebSocket execution transport.
- **Codex app-server protocol** is JSON-RPC 2.0 over stdio/newline-delimited JSON.

Any change to Web-used resources, fields, event variants, defaults, error handling,
or reconnect semantics must update this matrix, typed fixtures, and integration
evidence against an immutable Core revision.
