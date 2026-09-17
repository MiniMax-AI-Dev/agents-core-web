import type { AgentEnvironmentInput } from "@agents-core-web/agents-client";

import { createIdempotencyKey } from "../../../lib/pending-send";

export interface SessionCreateDraft {
  agentId: string;
  environment: AgentEnvironmentInput;
}

export interface SessionCreateAttempt {
  fingerprint: string;
  idempotencyKey: string;
}

export function sessionCreateFingerprint(draft: SessionCreateDraft): string {
  return JSON.stringify({ agent_id: draft.agentId, environment: draft.environment, stream: false });
}

export function beginSessionCreateAttempt(
  draft: SessionCreateDraft,
  previous: SessionCreateAttempt | null,
  makeKey: () => string = createIdempotencyKey,
): SessionCreateAttempt {
  const fingerprint = sessionCreateFingerprint(draft);
  return {
    fingerprint,
    idempotencyKey: previous?.fingerprint === fingerprint ? previous.idempotencyKey : makeKey(),
  };
}
