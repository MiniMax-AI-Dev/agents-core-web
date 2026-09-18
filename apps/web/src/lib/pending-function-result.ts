import type { FunctionResultContent, FunctionResultInput } from "@agents-core-web/agents-client";

import {
  beginPendingSend,
  failPendingSend,
  type FailedPendingSend,
  type PendingSend,
} from "./pending-send";

export interface PendingFunctionResult extends PendingSend {
  actionKey: string;
}

export interface FailedPendingFunctionResult extends FailedPendingSend {
  actionKey: string;
}

function normalizedOutput(
  output: FunctionResultInput["output"],
): string | null | Array<[FunctionResultContent["type"], string]> {
  if (output === undefined || output === null) return null;
  if (typeof output === "string") return output;
  return output.map((part) => (
    part.type === "input_text"
      ? [part.type, part.text]
      : [part.type, part.image_url]
  ));
}

export function functionResultActionKey(sessionId: string, input: FunctionResultInput): string {
  return JSON.stringify([sessionId, input.turnId, input.callId]);
}

/** Stable comparison payload for deciding whether an explicit retry is the same write. */
export function functionResultAttemptPayload(input: FunctionResultInput): string {
  return JSON.stringify([
    input.turnId,
    input.callId,
    input.success,
    normalizedOutput(input.output),
    input.error ?? null,
  ]);
}

export function beginPendingFunctionResult(
  sessionId: string,
  input: FunctionResultInput,
  previous: FailedPendingFunctionResult | undefined,
  makeKey?: () => string,
): PendingFunctionResult {
  const actionKey = functionResultActionKey(sessionId, input);
  const pending = beginPendingSend(
    sessionId,
    functionResultAttemptPayload(input),
    previous,
    makeKey,
  );
  return { ...pending, actionKey };
}

export function failPendingFunctionResult(
  pending: PendingFunctionResult,
  error: unknown,
  message: string,
): FailedPendingFunctionResult {
  return { ...failPendingSend(pending, error, message), actionKey: pending.actionKey };
}
