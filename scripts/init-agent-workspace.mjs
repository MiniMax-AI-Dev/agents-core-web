import { constants } from "node:fs";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(repositoryRoot, ".agents");
const stateRoot = resolve(root, "state");

const files = {
  "AGENTS.md": `# Local Agent instructions\n\n<!-- Private: define repository-specific implementation rules here. -->\n`,
  "issue-agent.md": `# Local issue iteration prompt\n\n<!-- Private: define issue triage, scope, and stop conditions here. -->\n`,
};

await mkdir(root, { recursive: true, mode: 0o700 });
await mkdir(stateRoot, { recursive: true, mode: 0o700 });
await chmod(root, 0o700);
await chmod(stateRoot, 0o700);

for (const [name, contents] of Object.entries(files)) {
  const path = resolve(root, name);
  try {
    await access(path, constants.F_OK);
  } catch {
    await writeFile(path, contents, { encoding: "utf8", mode: 0o600 });
  }
  await chmod(path, 0o600);
}

console.log("Local Agent workspace is ready at .agents/ (Git-ignored).");
