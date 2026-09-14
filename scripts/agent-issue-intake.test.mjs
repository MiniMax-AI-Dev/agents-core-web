import assert from "node:assert/strict";
import test from "node:test";

import { AgentIssueIntakeError, createAgentTask, parseIssueForm } from "./agent-issue-intake.mjs";

function eventFixture() {
  return {
    action: "labeled",
    label: { name: "agent-ready" },
    repository: { full_name: "example/agents-core-web" },
    sender: { login: "maintainer" },
    issue: {
      number: 42,
      html_url: "https://github.com/example/agents-core-web/issues/42",
      title: "Bounded session recovery fix",
      state: "open",
      author_association: "CONTRIBUTOR",
      updated_at: "2026-09-14T00:00:00Z",
      user: { login: "reporter" },
      labels: [{ name: "agent-ready" }],
      body: [
        "### Context",
        "Reconnect loses the visible terminal item.",
        "",
        "### Acceptance criteria",
        "- Recovered Items are shown once.",
        "",
        "### Validation",
        "Run the focused recovery test.",
        "",
        "### Non-goals",
        "Do not change the runtime protocol.",
      ].join("\n"),
    },
  };
}

test("parses issue-form sections independently of line endings", () => {
  const parsed = parseIssueForm("### Context\r\n\r\nA\r\n### Validation\r\n\r\nB");
  assert.equal(parsed.values.get("context"), "A");
  assert.equal(parsed.values.get("validation"), "B");
});

test("creates a normalized task packet without treating fields as commands", () => {
  const event = eventFixture();
  event.issue.body = event.issue.body.replace(
    "Reconnect loses the visible terminal item.",
    "Literal untrusted text: $(touch /tmp/must-not-run)",
  );

  const task = createAgentTask(event);

  assert.equal(task.untrusted_input, true);
  assert.equal(task.issue.authorized_by, "maintainer");
  assert.equal(task.issue.fields.context, "Literal untrusted text: $(touch /tmp/must-not-run)");
  assert.equal(task.issue.fields.non_goals, "Do not change the runtime protocol.");
});

test("rejects an issue that was not explicitly labeled agent-ready", () => {
  const event = eventFixture();
  event.label.name = "agent-candidate";
  event.issue.labels = [];

  assert.throws(() => createAgentTask(event), AgentIssueIntakeError);
});

test("rejects missing and duplicate required sections", () => {
  const event = eventFixture();
  event.issue.body = event.issue.body
    .replace("Run the focused recovery test.", "_No response_")
    .concat("\n\n### Context\nA second context");

  assert.throws(
    () => createAgentTask(event),
    (error) =>
      error instanceof AgentIssueIntakeError &&
      error.errors.includes("Validation is required") &&
      error.errors.includes("Context must appear exactly once"),
  );
});
