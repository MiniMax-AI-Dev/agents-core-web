import { appendFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_FIELDS = [
  ["context", "Context"],
  ["acceptance", "Acceptance criteria"],
  ["validation", "Validation"],
  ["non_goals", "Non-goals"],
];

function normalizeHeading(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseIssueForm(body) {
  const source = typeof body === "string" ? body.replace(/\r\n?/g, "\n") : "";
  const headings = [...source.matchAll(/^###\s+(.+?)\s*$/gm)];
  const values = new Map();
  const duplicates = new Set();

  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index];
    const name = normalizeHeading(match[1] ?? "");
    const start = (match.index ?? 0) + match[0].length;
    const end = headings[index + 1]?.index ?? source.length;
    const value = source.slice(start, end).trim();
    if (values.has(name)) duplicates.add(name);
    else values.set(name, value);
  }

  return { values, duplicates };
}

function labelNames(issue) {
  if (!Array.isArray(issue?.labels)) return [];
  return issue.labels.flatMap((label) => {
    if (typeof label === "string") return [label];
    return typeof label?.name === "string" ? [label.name] : [];
  });
}

export class AgentIssueIntakeError extends Error {
  constructor(errors) {
    super(`Agent issue intake rejected:\n- ${errors.join("\n- ")}`);
    this.name = "AgentIssueIntakeError";
    this.errors = errors;
  }
}

export function createAgentTask(event) {
  const errors = [];
  const issue = event?.issue;
  const repository = event?.repository?.full_name;

  if (event?.action !== "labeled" || event?.label?.name !== "agent-ready") {
    errors.push("the triggering action must add the agent-ready label");
  }
  if (!issue || issue.pull_request) errors.push("the event must reference an issue, not a pull request");
  if (issue?.state !== "open") errors.push("the issue must still be open");
  if (!labelNames(issue).includes("agent-ready")) errors.push("the issue no longer carries agent-ready");
  if (typeof repository !== "string" || !/^[^/]+\/[^/]+$/.test(repository)) {
    errors.push("repository.full_name is missing or invalid");
  }
  if (!Number.isSafeInteger(issue?.number) || issue.number <= 0) errors.push("issue.number is missing or invalid");
  if (typeof issue?.title !== "string" || issue.title.trim() === "") errors.push("issue.title is required");

  const parsed = parseIssueForm(issue?.body);
  const fields = {};
  for (const [key, heading] of REQUIRED_FIELDS) {
    const normalized = normalizeHeading(heading);
    const value = parsed.values.get(normalized) ?? "";
    if (parsed.duplicates.has(normalized)) errors.push(`${heading} must appear exactly once`);
    if (value === "" || value.toLowerCase() === "_no response_") errors.push(`${heading} is required`);
    if (value.length > 16_000) errors.push(`${heading} exceeds the 16000 character intake limit`);
    fields[key] = value;
  }

  if (errors.length > 0) throw new AgentIssueIntakeError(errors);

  return {
    schema_version: 1,
    source: "github_issue",
    untrusted_input: true,
    repository,
    issue: {
      number: issue.number,
      url: issue.html_url ?? null,
      title: issue.title.trim(),
      author: issue.user?.login ?? null,
      author_association: issue.author_association ?? null,
      updated_at: issue.updated_at ?? null,
      authorized_by: event.sender?.login ?? null,
      fields,
    },
  };
}

export async function runAgentIssueIntake({ argv = process.argv.slice(2), env = process.env } = {}) {
  const eventPath = argv[0] || env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("Usage: node scripts/agent-issue-intake.mjs <github-event.json>");

  const event = JSON.parse(await readFile(eventPath, "utf8"));
  const task = createAgentTask(event);
  const serialized = `${JSON.stringify(task, null, 2)}\n`;
  const outputPath = env.AGENT_TASK_OUTPUT;

  if (outputPath) {
    await writeFile(outputPath, serialized, { encoding: "utf8", mode: 0o600 });
  } else {
    process.stdout.write(serialized);
  }

  if (env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      env.GITHUB_STEP_SUMMARY,
      `## Agent issue intake\n\nValidated ${task.repository}#${task.issue.number}. ` +
        "The uploaded task fields remain untrusted input.\n",
      "utf8",
    );
  }

  return task;
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedUrl) {
  runAgentIssueIntake().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
