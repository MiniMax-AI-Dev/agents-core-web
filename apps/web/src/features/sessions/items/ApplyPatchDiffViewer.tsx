import { ChevronRight, FileDiff } from "lucide-react";
import { useState } from "react";

import type { SessionItem } from "@agents-core-web/agents-client";

import type { ParsedApplyPatch } from "./apply-patch";

function pretty(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function ApplyPatchDiffViewer({ item, patch, result }: { item: SessionItem; patch: ParsedApplyPatch; result: unknown }) {
  const [openFiles, setOpenFiles] = useState(() => new Set(patch.changes.map((_, index) => index)));
  const status = item.status === "in_progress" ? "In progress" : item.status === "failed" ? "Failed" : item.status === "incomplete" ? "Incomplete" : "Completed";

  const toggle = (index: number) => setOpenFiles((current) => {
    const next = new Set(current);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });

  return (
    <section className="parsar-diff" aria-label="Parsar apply patch diff" data-patch-status={item.status}>
      <header className="parsar-diff__summary">
        <FileDiff size={14} strokeWidth={1.5} aria-hidden="true" />
        <strong>{patch.changes.length} {patch.changes.length === 1 ? "file" : "files"}</strong>
        <span className="parsar-diff__additions">+{patch.additions}</span>
        <span className="parsar-diff__deletions">−{patch.deletions}</span>
        <span className="parsar-diff__status">{status}</span>
      </header>
      <div className="parsar-diff__files">
        {patch.changes.map((change, index) => {
          const open = openFiles.has(index);
          return (
            <section className="parsar-diff__file" key={`${change.path}:${index}`}>
              <button type="button" className="parsar-diff__file-toggle" aria-expanded={open} onClick={() => toggle(index)}>
                <ChevronRight className={open ? "open" : ""} size={14} strokeWidth={1.5} aria-hidden="true" />
                <span className={`parsar-diff__kind parsar-diff__kind--${change.kind}`}>{change.kind}</span>
                <code title={change.path}>{change.path}</code>
                <span className="parsar-diff__counts"><i>+{change.additions}</i><b>−{change.deletions}</b></span>
              </button>
              {open ? (
                <pre className="parsar-diff__content" tabIndex={0} aria-label={`Unified diff for ${change.path}`}>
                  {change.lines.map((line, lineIndex) => <span className={`parsar-diff__line parsar-diff__line--${line.kind}`} key={lineIndex}>{line.text || " "}{"\n"}</span>)}
                </pre>
              ) : null}
            </section>
          );
        })}
      </div>
      <div className="parsar-diff__raw">
        <details><summary>Raw arguments</summary><pre>{pretty(item.arguments)}</pre></details>
        <details><summary>Raw result</summary><pre>{result === undefined ? "No result yet" : pretty(result)}</pre></details>
      </div>
    </section>
  );
}
