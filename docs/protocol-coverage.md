# Protocol coverage

This matrix is a delivery contract for Agents Core Web, not a claim of complete
OpenAI-hosted service compatibility.

## Compatibility baseline

- Current Parsar Core compatibility audit:
  [`d91ba48a`](https://github.com/MiniMax-AI-Dev/parsar/commit/d91ba48ac6c49cfdf6f08d7687b9be76ba6d53ee).
  This immutable revision re-confirms the Web-used Agent admission, chat, and
  Environment boundaries. `OpenAI-Beta: agents=v1` plus the `/v1/agents/**`
  resources and Session events endpoint are the versioned Web/Core contract. Core
  exposes no additional public execution-readiness, capability, or build-version
  resource; Web does not require one before using the documented chat events. It
  exposes Environment retrieve plus Session-bound `self_hosted` data, but no public
  Environment list, template, file-management, or browser-facing key route.
- Upstream resource source: `openai-python` 3.13.0 beta Agents resources at
  [`d7c41efe`](https://github.com/openai/openai-python/tree/d7c41efee1b0802b79f3f88a678ef2052b06e9ce/src/openai/resources/beta/agents)
- Required beta header: `OpenAI-Beta: agents=v1`
- Core base: same-origin `/v1` through the Web proxy for stock Parsar Core; a direct
  URL only for a compatible Core or proxy with explicit CORS support

Parsar implements a partial subset of the pinned upstream resource inventory, and
its handlers still implement partial request/event semantics. Importing an official
SDK or accepting extra fields is not compatibility proof. Unsupported capabilities
must fail explicitly.

Requests use `Authorization: Bearer <execution-principal key>`. Optional
`OpenAI-Organization` and `OpenAI-Project` headers, when present, must exactly match
the Core key binding. Agents Core Web's local proxy owns the bearer server-side.

## Web-used surface

| Resource / behavior | TypeScript client | Initial UI | Notes |
| --- | --- | --- | --- |
| Saved Agents create/list | Yes | Yes | Dedicated setup covers model, name, instructions, bounded metadata, and the Session-safe text/medium/implicit-reasoning/auto-tier profile; the broader Saved Agent contract is not execution proof |
| Saved Agents retrieve/update/delete | Yes | Yes | Agent details support viewing, editing, and deleting saved Agents |
| Sessions create/list/retrieve | Yes | Yes | UI creates idle `environment:none` Sessions; client types also cover the pinned `self_hosted` request and safe response projection |
| Sessions update/delete | Yes | Yes | Title/string metadata editing and one-Session confirmed deletion; no bulk or Workspace deletion |
| Session live events | Yes | Yes | Authenticated `fetch` stream, not `EventSource` |
| Input message / steering | Yes | Yes | Opens SSE before submitting `agent.session.input.message`; only HTTP 204 is durable admission, while Core errors or an unexpected 2xx remain visible and uncertain failures retain the in-memory payload/key for an explicit unchanged manual retry only |
| Active Turn cancel | Yes | Yes | Submitted as a Session event, not a Turn-create endpoint |
| Turn list | Yes | Yes, read-only | Selected Sessions load every page in ascending creation order; no Turn mutation UI |
| Turn retrieve | Yes | No | Reusable client diagnostic method; timeline recovery uses the all-pages list |
| Item list/recovery | Yes | Yes | Authoritative recovery after stream loss |
| Parsar `apply_patch` Item presentation | Existing function Item fields | Yes, read-only | Parsar extension recognized only for the pinned `changes[].{path,kind,diff}` shape; not an OpenAI standard Item type |
| Function result/error | Yes | Yes | Supports text `agent.session.input.tool_result` success/error handoff for exact `function_call` actions |
| Initial-input creation stream | Later | No | Idle-create flow avoids the early-event race |
| Artifacts/files | Later | No | Required Core resources are not implemented |
| Environment connection action | Yes | Render-only | `environment_connection` is distinct from a function call; Web shows an operator-owned, non-actionable state and sends no result |
| Environment lifecycle events | Yes | Read-only | UI projects pinned pending, ready, connected, disconnected, and failed live snapshots; unknown/malformed status events clear prior live claims and render as unavailable |
| Environment retrieve | Yes | Yes, read-only | For a valid `self_hosted` Session Environment ID, reads the exact public resource fields and durable status; no create/list/update/delete support |
| Environment overview | No public list API | No top-level UI | Web does not turn loaded Session projections into a catalog; a selected Session may still show its exact Environment data |
| Environment templates | No | Hidden | No navigation or Create entry is shown without a Core contract |
| Environment keys | No public browser API | Hidden | Operator-issued executor credentials never enter browser state, request previews, navigation, or Create actions |
| Vaults | Later | No | Credentials must never be stored in browser metadata |
| Protocol Subagents / enabled multi-agent | Later | No | Distinct from storing multiple Agent configurations |
| Usage/observability | Response types | Yes, scoped | Session aggregate and per-Turn token Usage are labelled separately; unavailable measurements remain unknown, not zero |

## Runtime boundary

- The Web currently creates only `environment: {"type":"none"}` Sessions.
- Message, active-Turn steering, cancel, and function-result/error writes use the
  current `agents=v1` Session events contract. Web does not add a separate private
  runtime-readiness gate. Only exact HTTP 204 denotes durable event admission;
  every other status, including another 2xx, fails closed. HTTP acceptance, health,
  Agent creation, and an open SSE stream still do not prove that execution will
  complete; subsequent durable Session, Turn, and Item state is authoritative.
- Product navigation and the global Create menu do not widen the protocol. Agent
  and idle Session creation call the existing client methods. The top-level
  Environments destination and Environment template/key entries are absent because
  Core exposes no corresponding list or management APIs.
- The Agent setup request preview is derived entirely from editable Agent fields and
  the sanitized Core base URL. Its authorization header always contains the literal
  `${AGENTS_CORE_API_KEY}` placeholder; it never reads or renders the connection's
  server-managed or current-tab bearer.
- Saved Agent persistence and Session execution are separate contracts. Parsar
  `d91ba48a` can store explicit reasoning, non-`auto` service tiers, and JSON-schema
  text formats, but rejects each of them before creating a Session. Enabled
  multi-agent configuration, saved-only tool types, deferred/invalid/duplicate
  function or MCP identities, and MCP credentials without attached Vaults are
  rejected at the same boundary. The Web never attaches Vaults in this flow, so it
  treats a saved MCP `credential_id` as a deterministic blocker. The Web therefore
  omits reasoning for new Agents, uses `service_tier:auto`, ordinary text, and
  medium verbosity, and blocks every Session-start entry point for a loaded Agent
  with a deterministic admission conflict. Existing saved-only values remain
  inspectable; fields exposed for editing are never silently rewritten.
- Saved Agent names are limited to 128 Unicode characters. Agent metadata is limited
  to 16 string pairs, 64 Unicode characters per key, and 512 per value; the Web
  enforces those limits before a write.
- Parsar Core at the audited revision supports Session-bound `self_hosted` data and
  its documented event inputs. This Web does not create or connect that profile; it
  safely renders selected Sessions that already carry one. That read-only projection
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
  `GET /agents/environments/{encoded_environment_id}`. It accepts only HTTP 200 and
  strictly projects exactly `id`, `object`, `type`, `status`, `files`, `plugins`, and
  `skills`, with the matching ID, `agent.environment` object, `self_hosted` type, a
  supported durable status, and array-valued installation metadata. UUID comparison
  permits an uppercase request to match Core's lowercase canonical response, and the
  projected resource retains that canonical response ID. It never writes or retries
  this read.
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
  Web model presets are editable suggestions. Known reasoning, tier, format,
  multi-agent, executable-tool-shape, and unattached-credential incompatibilities
  are authoritative at Session creation; a real Turn remains necessary to prove
  model/provider execution and conditional Codex `low`/`high` verbosity support.
  Web never sends a paid Turn merely as a capability probe. Claude SDK accepts
  medium verbosity only.

Environment creation and management beyond the narrow read, provider selection,
Files, Plugins, Skills, Artifacts, Vault, hosted runtimes, and Workspace lifecycle
controls remain unsupported by this Web or out of scope. Parsar's additional pinned
handlers are not Web-supported merely because they exist upstream.

## Session metadata and deletion

- The Session action surface retrieves the latest durable Session when it opens and
  again immediately before an update. Every action read must return a complete
  canonical Session with the exact requested ID; a wrong-ID or malformed HTTP 200
  response leaves the current view/draft unchanged and cannot authorize a write or
  unlock an uncertain deletion retry. Runtime validation covers the Agent snapshot,
  known Environment shapes, required-action variants, Usage counters, metadata, and
  timestamps while preserving a structurally safe unknown Environment type as
  unavailable. `metadata.title` supplies the optional display
  title; the remaining arbitrary metadata values must be strings. The Web enforces
  Parsar's pinned limit of 16 pairs, 64 Unicode characters per key, and 512 per value,
  and explicitly warns that metadata must never contain credentials or secrets.
- `POST /agents/sessions/{session_id}` replaces the complete metadata map. To avoid
  silently erasing concurrent additions, the Web computes the user's changes from
  the form baseline, applies only non-conflicting changes to the latest retrieved map,
  and stops before POST when the same key diverged. The latest unrelated pairs are
  rebased into the preserved draft before a later explicit retry. A confirmed response
  must be a complete matching Session whose metadata exactly equals the submitted map;
  only that metadata is merged into the live UI so an overlapping SSE status or Usage
  snapshot is not regressed.
- Update and delete have no idempotency key and are sent at most once per explicit
  action. A missing Session or deterministic lifecycle conflict remains visible with
  its draft. A 5xx, timeout, response loss, malformed success, or network failure is
  treated as an unknown write result: the current Web view remains in place and no
  write is retried automatically. After an unknown delete, the Web performs exactly
  one read-only Session retrieval: 404 confirms removal, a canonical Session confirms
  it is still present and unlocks a later explicitly confirmed delete, and another
  failed read keeps deletion locked as unknown until the dialog is reopened and a
  durable retrieval succeeds. A 409 is supported for a compatible Core; pinned Parsar
  permits active Session metadata updates and does not make 409 the expected
  active-Session path.
- `DELETE /agents/sessions/{session_id}` removes a row only after the exact canonical
  `{id, object:"agent.session.deleted", deleted:true}` confirmation. Deleting the
  selected Session immediately aborts/fences its fetch stream and pending
  Session/Item/Turn/Environment reads, clears its local Items, Turns, required actions,
  Environment observation, send failure, and draft, then selects the next item at the
  deleted position or the previous item at the end. Deleting an inactive Session does
  not change the selected ID, stream epoch, composer, or current conversation state.
- Parsar deletion is a public server lifecycle operation. It hides the durable public
  Session/Items/Turns, closes its stream, cancels queued work, and requests asynchronous
  cancellation of active work. It does not prove immediate native executor quiescence,
  physical SQL/native-history erasure, or deletion of executor Workspace files.

## Live stream and recovery

`GET /v1/agents/sessions/{session_id}/events` is live-only. The client opens it
before submitting input. A reconnect, including one with `Last-Event-ID`, does not
replay missed work.

Every accepted replacement stream follows this order:

1. reconnect the stream and buffer newly arriving events;
2. retrieve the persisted Session and every page of Items while independently
   starting the all-pages Turn read;
3. after the current Session supplies a valid `self_hosted` ID, retrieve its durable
   Environment resource;
4. apply the durable Session, Items, and Environment snapshot without making a slow
   or unavailable Turn endpoint block conversation recovery, then release buffered
   events;
5. when the independent Turn read settles, apply it only if its Core, request, and
   selected Session are still current, merging any newer live Turn snapshot by event
   revision;
6. inspect durable state before resubmitting an uncertain write.

At replacement-stream acceptance the Web clears the previous live Environment
observation before the durable reads. Supported Environment events arriving during
those reads are buffered and applied afterward, so a newer live state wins over the
earlier durable snapshot. A late stream callback or read is fenced by Core
generation, Session ID, Environment ID, Session and Environment request revisions,
Turn and Item event revisions, stream epoch, selection, and abort signal. A missing, unauthorized,
failed, or malformed Environment response clears stale connection claims and renders
status as unavailable without blocking Session, Items, or conversation use. The UI
never infers connected from health, stream state, Agent/model metadata, installation
arrays, or absence of an action.

For a same-ID Turn, a `completed`, `failed`, or `cancelled` snapshot does not
regress to a later-arriving non-terminal snapshot. Durable creation order remains
authoritative while a newer live snapshot can advance the same Turn. For a same-ID
Item, `completed`, `failed`, or `incomplete` beats `in_progress`
regardless of whether the terminal value came from the durable read or the live
buffer. Otherwise, the later live projection wins while durable ordering remains
authoritative. Duplicate, out-of-order, unknown, and no-op events do not stop later
events. A Session or Core switch aborts its fetch-based stream and durable reads;
generation checks also isolate any late result that could not be cancelled.

Terminal Session (`idle`, `requires_action`, `failed`), Turn (`completed`, `failed`,
`cancelled`), and live Environment (`ready`, `connected`, `disconnected`, `failed`)
events schedule a coalesced durable Session/Turns/Items/Environment refresh. They do
not restart the stream. The Turn read shares the refresh's abort signal and request
fence but settles independently, so a slow or failed Turn endpoint cannot delay
durable conversation Items or buffered Item events. A Turn-list failure is isolated
to its timeline: the last observed Turns remain visible, and a successful Session/Items
read keeps the existing conversation usable.

## Turn observability boundary

- The selected Session loads `GET /agents/sessions/{session_id}/turns` with
  `limit=100&order=asc`, follows `has_more` using the last returned Turn ID when the
  optional list cursors are absent, and rejects a repeated/cyclic cursor or a Turn
  scoped to another Session. Reads are abortable and never retried automatically.
- The timeline presents observed Core snapshots for `queued`, `in_progress`,
  `waiting`, `completed`, `failed`, and `cancelled`. Its all-pages read supplies the
  authoritative creation order, while a newer exact lifecycle SSE snapshot may
  advance a Turn before that read settles. Live projection is limited to exact
  `created→queued`, `in_progress→in_progress`, `waiting→waiting`,
  `completed→completed`, `failed→failed`, and `cancelled→cancelled` event/status
  pairs; Item/output or unknown Turn event names and mismatched snapshots are ignored.
  The UI therefore does not label the mixed projection as wholly durable. Items are
  counted against their owning Turn only by the protocol `turn_id`; unmatched Items
  remain in the conversation and are explicitly reported rather than hidden or
  guessed.
- Ended wall-clock duration is calculated only when both server `started_at` and
  `completed_at` are valid and ordered. `in_progress` and `waiting` Turns show a
  live, explicitly labelled running elapsed value from server `started_at` to the
  viewer's current clock. Missing, invalid, or reversed timestamps render as
  `Unknown`; Item `duration_ms` values are tool progress and are never summed or
  relabelled as Turn wall-clock time.
- A failed Turn's safe public `error.code` and `error.message` render beside its
  timeline entry without removing conversation Items. The Web does not expose Core,
  daemon, provider, or native-harness diagnostics absent from that resource.
- The Web displays `input_tokens`, `output_tokens`, `total_tokens`, cached input
  tokens, and reasoning output tokens. Session aggregate Usage and each Turn's Usage
  use separately labelled areas. A null resource, missing nested metric, malformed
  value, or unavailable measurement renders as `Unknown`, never inferred zero.
- Turn status, timings, Usage, errors, and tool progress are resource-level
  observability. They are not per-Item timing, monetary cost, provider attribution,
  or a complete OpenAI Trace waterfall.

The client never retries a write automatically. For an input message that receives
an unexpected non-204 2xx, loses its network/response, or fails with HTTP 5xx or a
transient 408/409/425/429, the Web keeps the original payload and idempotency key in
memory. Only a later user-initiated Send of the byte-for-byte unchanged payload
reuses that key. Editing the payload, changing Session/Core, a successful response,
or a permanent 4xx starts a new operation with a new key. This state is intentionally
not stored in browser persistence, and the UI cannot prove whether an uncertain
request was accepted until durable Core state reconciles.

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
