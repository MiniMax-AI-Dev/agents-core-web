# Roadmap

## M0 — foundation (this init)

- pnpm workspace with React/Vite and a reusable TypeScript Agents API client;
- live same-origin Core connection to an independently deployed backend;
- Agent list/create and a Session conversation vertical slice;
- fetch-based SSE, durable Item recovery, cancel, and function-result handoff;
- architecture, protocol coverage, and private self-iteration workspace rules;
- a public, read-only `agent-ready` issue intake gate that emits a normalized
  task artifact without shipping private prompts or a privileged runner.

## M1 — pinned Parsar Core acceptance

- keep the Web contract fingerprinted to an immutable `services/agents-api`
  revision and record upgrade evidence;
- add raw HTTP fixtures for every UI-used response/event variant;
- harden same-ID durable/live Item precedence so a stale projection cannot replace a
  finalized durable value;
- persist pending-operation idempotency keys across reconciliation-assisted manual
  retry decisions;
- verify disconnect recovery, active steering, cancellation races, function
  action/result/error, pagination, and error presentation;
- add browser E2E with the real core and a controlled executor.

## M2 — runtime-capability integration

- track upstream Parsar Core runtime and Environment work without implementing
  Core adapters in this repository;
- define a namespaced, optional Web capability-discovery contract only when an
  upstream implementation is ready to expose it;
- add compatibility fixtures and UI acceptance for allocation, connection,
  lease, recovery, cancellation, and cleanup behavior;
- expose Docker, E2B, AWS Bedrock AgentCore Runtime, or another provider in Web
  only after the connected Core advertises a versioned capability and passes the
  relevant lifecycle tests;
- report missing Core behavior as an upstream gap rather than emulating it in
  browser or client state.

## M3 — issue-driven self-iteration pilot

- connect a trusted runner to successful intake artifacts;
- consume only structured issues carrying a maintainer-applied `agent-ready` label;
- plan in an isolated branch/worktree, run repository checks, and open a draft PR;
- require human review; never auto-merge, release, or expand issue scope;
- keep prompts, scratch decisions, and run state in the ignored `.agents/`
  workspace while committing only code, tests, and public design decisions.

## M4 — separate Web Cloud service/product

- introduce a BFF, user sessions, managed runtime inventory, audit, and secrets
  in a separate Web Cloud service rather than this open-source TS client;
- design organization/role/billing features as a separate product layer instead
  of coupling them to the open Agents API client.
