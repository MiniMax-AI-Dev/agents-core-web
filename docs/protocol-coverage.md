# Protocol coverage

This matrix is a delivery contract for Agents Core Web, not a claim of complete
OpenAI-hosted service compatibility.

## Compatibility baseline

- Parsar Core:
  [`0438880a`](https://github.com/MiniMax-AI-Dev/parsar/commit/0438880ab21aa16d05cb91a4c7f91cc0abc12358)
- Upstream resource source: `openai-python` 3.13.0 beta Agents resources at
  [`d7c41efe`](https://github.com/openai/openai-python/tree/d7c41efee1b0802b79f3f88a678ef2052b06e9ce/src/openai/resources/beta/agents)
- Required beta header: `OpenAI-Beta: agents=v1`
- Core base: same-origin `/v1` through the Web proxy for stock Parsar Core; a direct
  URL only for a compatible Core or proxy with explicit CORS support

Parsar's pinned inventory contains 42 upstream operations in 15 resource classes;
the referenced Core revision has handlers for 20 operations, and those handlers
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
| Input message | Yes | Yes | Opens SSE before submission; uncertain failures retain the in-memory payload/key for an explicit unchanged manual retry only |
| Active Turn cancel | Yes | Yes | Submitted as a Session event, not a Turn-create endpoint |
| Turn retrieve/list | Yes | No | Durable diagnostics UI deferred |
| Item list/recovery | Yes | Yes | Authoritative recovery after stream loss |
| Parsar `apply_patch` Item presentation | Existing function Item fields | Yes, read-only | Parsar extension recognized only for the pinned `changes[].{path,kind,diff}` shape; not an OpenAI standard Item type |
| Function result/error | Yes | Yes | Initial UI supports text result/error handoff only for `function_call` actions |
| Initial-input creation stream | Later | No | Idle-create flow avoids the early-event race |
| Artifacts/files | Later | No | Required Core resources are not implemented |
| Environment connection action | Yes | Render-only | `environment_connection` is distinct from a function call; Web shows an operator-owned, non-actionable state and sends no result |
| Environment lifecycle events | Yes | Read-only | UI projects pinned pending, ready, connected, disconnected, and failed live snapshots; unknown/malformed status events clear prior live claims and render as unavailable |
| Environment retrieve | Yes | Yes, read-only | For a valid `self_hosted` Session Environment ID, reads the exact public resource fields and durable status; no create/list/update/delete support |
| Vaults | Later | No | Credentials must never be stored in browser metadata |
| Protocol Subagents / enabled multi-agent | Later | No | Distinct from storing multiple Agent configurations |
| Usage/observability | Response types | No | Missing measurements remain unknown, not zero |

## Runtime boundary

- The Web currently creates only `environment: {"type":"none"}` Sessions.
- Parsar Core at the pinned revision has a narrow `self_hosted` profile for empty
  Session creation followed by constrained idle text input. The Web does not create
  that profile, but it safely renders selected Sessions that already carry one. This
  does not expand the missing Environment create/list/update/delete, template, or
  file-operation surface.
- The reusable client distinguishes the admitted `self_hosted` request fields
  (`workspace_directory` and optional `capability_directories`) from the safe Session
  response projection (`id`, `remote_url`, `workspace_directory`, and normalized
  `capability_directories`). Unknown Environment variants remain opaque, inspectable
  records and are not eligible creation inputs.
- `required_actions` is a discriminated union. `function_call` carries call, Turn,
  function-name, and argument fields; `environment_connection` carries only
  `environment_id`. The initial Web renders the latter as an operator-owned wait and
  does not expose a Function Result form or claim that the browser can connect it.
- Environment resource status and Session Environment event status are distinct
  contracts. The durable resource accepts `pending`, `connected`, `disconnected`,
  `expired`, and `failed`. Live events accept `pending`, `ready`, `connected`,
  `disconnected`, and `failed`, with a nullable structured error. `expired` is
  therefore durable-only and `ready` is live-only; neither vocabulary is widened by
  an unchecked cast. Unknown or malformed values clear any older live claim.
- Once a current Session read supplies a valid `self_hosted` Environment ID, the
  client issues one authenticated, abortable
  `GET /agents/environments/{encoded_environment_id}`. It strictly accepts exactly
  `id`, `object`, `type`, `status`, `files`, `plugins`, and `skills`, with the matching
  ID, `agent.environment` object, `self_hosted` type, a supported durable status, and
  array-valued installation metadata. It never writes or retries this read.
- Empty `files`, `plugins`, and `skills` arrays mean only that Core reports no
  API-managed installations. They are not the host filesystem, Workspace contents,
  launcher capabilities, or executor inventory, and the Web does not expose them as
  browsing UI.
- The durable `self_hosted` Session Environment projection has no connection-status
  or error field, so the separate Environment resource read is the only durable
  status source used by the UI. The UI renders the Session's ID, sanitized HTTP(S)
  remote URL,
  `workspace_directory`, and `capability_directories` as read-only data. It removes
  URL userinfo, query, and fragment, renders even safe HTTP(S) executor URLs as
  non-clickable text, never displays non-HTTP(S) or malformed values, and never
  turns directory strings into `file://` or browser/executor access.
  Missing fields fail closed as unavailable. A matching `environment_connection`
  action is labeled as durable Core-required work, never as proof of pending or
  available execution.
- Environment failures render generic copy only; raw error code, type, and message
  fields are hidden because they can contain arbitrary credentials, Vault IDs,
  paths, or private URLs. Unknown and incomplete required actions block
  the composer rather than selecting a guessed form. A valid
  `environment_connection` notice remains separate from any simultaneous
  `function_call` result form and has no result submission control.
- Workspace means the execution directory within this Environment. It is not a
  top-level workspaces API, file browser, editor, or artifact capability. The UI
  links to the immutable pinned Core and caller-started launcher setup documentation;
  it does not connect to daemon/executor transports or mutate Environments.
- Known Item and Session-event discriminants remain typed. Unknown variants retain
  their raw fields for inspection, but consumers must treat them as unavailable
  rather than infer a known rendering or action.
- Parsar maps a Codex `fileChange` observation to a `function_call` named
  `apply_patch`. The Web enables its read-only diff presentation only when arguments
  are an object containing a non-empty `changes` array and every change has a string
  `path`, a string `diff`, and a `kind` object whose `type` is `add`, `update`, or
  `delete` (with an optional string or null `move_path`). Empty, malformed, string,
  missing-field, extra-field, and alternate same-name payloads retain the generic
  JSON function rendering. This is a Parsar extension, not an OpenAI standard Item
  type, and it grants no browser access to apply, edit, approve, reject, revert, or
  read files from an executor Workspace.
- The internal `parsar-daemon` WebSocket and the public `self_hosted` executor
  transport are different protocols. Neither is a generic Environment Provider.
- Docker, E2B, and AWS Bedrock AgentCore Runtime each need an upstream lifecycle and
  capability contract before the Web can advertise them.
- `AGENTS_API_ENGINE` selects `codex` or an operator-enabled `claude_sdk` profile for
  new Sessions. The browser sends a model ID, not an executor selector.
- Core has no standard model-catalog or capability-discovery route in this surface.
  Web model presets are editable suggestions; the first real Turn is authoritative.

Environment creation and management beyond the narrow read, provider selection,
Files, Plugins, Skills, Artifacts, Vault, hosted runtimes, and Workspace lifecycle
controls remain unsupported by this Web or out of scope. Parsar's additional pinned
handlers are not Web-supported merely because they exist upstream.

## Live stream and recovery

`GET /v1/agents/sessions/{session_id}/events` is live-only. The client opens it
before submitting input. A reconnect, including one with `Last-Event-ID`, does not
replay missed work.

Every accepted replacement stream follows this order:

1. reconnect the stream and buffer newly arriving events;
2. retrieve the persisted Session and Items;
3. after the current Session supplies a valid `self_hosted` ID, retrieve its durable
   Environment resource;
4. apply the durable Session, Items, and Environment snapshot, then merge buffered
   Items and apply newer buffered Environment events;
5. inspect durable state before resubmitting an uncertain write.

At replacement-stream acceptance the Web clears the previous live Environment
observation before the durable reads. Supported Environment events arriving during
those reads are buffered and applied afterward, so a newer live state wins over the
earlier durable snapshot. A late stream callback or read is fenced by Core
generation, Session ID, Environment ID, Session and Environment request revisions,
stream epoch, event revisions, selection, and abort signal. A missing, unauthorized,
failed, or malformed Environment response clears stale connection claims and renders
status as unavailable without blocking Session, Items, or conversation use. The UI
never infers connected from health, stream state, Agent/model metadata, installation
arrays, or absence of an action.

For a same-ID Item, `completed`, `failed`, or `incomplete` beats `in_progress`
regardless of whether the terminal value came from the durable read or the live
buffer. Otherwise, the later live projection wins while durable ordering remains
authoritative. Duplicate, out-of-order, unknown, and no-op events do not stop later
events. A Session or Core switch aborts its fetch-based stream and durable reads;
generation checks also isolate any late result that could not be cancelled.

Terminal Session (`idle`, `requires_action`, `failed`), Turn (`completed`, `failed`,
`cancelled`), and live Environment (`ready`, `connected`, `disconnected`, `failed`)
events schedule a coalesced durable Session/Items/Environment refresh. They do not
restart the stream. Turn list/retrieve methods exist for diagnostics, but the current
UI does not invoke them during recovery.

The client never retries a write automatically. For an input message that fails with
a network/response-loss error, HTTP 5xx, or transient 408/409/425/429, the Web keeps
the original payload and idempotency key in memory. Only a later user-initiated Send
of the byte-for-byte unchanged payload reuses that key. Editing the payload, changing
Session/Core, a successful response, or a permanent 4xx starts a new operation with a
new key. This state is intentionally not stored in browser persistence, and the UI
cannot prove whether an uncertain request was accepted until durable Core state
reconciles.

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
