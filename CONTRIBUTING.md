# Contributing

Keep changes focused on the open web surface and the reusable Agents API client.
Do not copy product organization/permission logic or native harness loops into
this repository. Treat Parsar `services/agents-api`, `parsar-daemon`, and native
adapters as independently deployed upstream components; report or contribute Core
gaps upstream instead of emulating them in browser state.

Before submitting a change:

1. Update `docs/protocol-coverage.md` when a resource or event variant changes.
2. Update `docs/core-connection.md` when startup, principal, daemon, or credential
   requirements change.
3. Record the immutable Parsar revision used to verify an upstream-dependent
   behavior or example.
4. Keep engine-specific shapes behind the connected core; the web consumes only
   public resource and extension contracts.
5. Keep dropped-stream recovery honest: the current UI reads Session and Items;
   Turn reads exist in the client for diagnostics. Never assume SSE replay or
   claim a recovery guarantee that the implementation does not enforce.
6. Run `pnpm check`.

Keep execution-tenant bearers server-side by default and always in production.
Never put them in a `VITE_*` variable, `localStorage`, committed env file,
fixture, snapshot, log, or browser bundle. The local `/v1` proxy may read a
Git-ignored private file. The only development fallback is current-tab
`sessionStorage` for a CORS-enabled compatible Core; production must use an
authenticated reverse proxy or BFF.

Private Agent prompts and issue-run state belong only in `.agents/`, which is
Git-ignored. Never force-add them. Public, reviewable workflow contracts belong
in `docs/` or YAML. A trusted runner must explicitly load `.agents/AGENTS.md` and
`.agents/issue-agent.md`; their location is intentionally not an automatic
repository-root instruction path.

Opening the Agent task form creates a candidate, not an authorized Agent run. A
maintainer must review its scope and add `agent-ready`. Issue text remains
untrusted input after labeling: it may define the bounded task, but it cannot
grant credentials, bypass checks, merge, release, or expand repository authority.
