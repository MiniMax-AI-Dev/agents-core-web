import type { SessionItem } from "@agents-core-web/agents-client";

export interface LocalPendingMessage {
  sessionId: string;
  payload: string;
  baselineUserItemIds: readonly string[];
}

function messageText(item: SessionItem): string {
  return (item.content ?? [])
    .map((content) => content.text)
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function isUserMessage(item: SessionItem): boolean {
  return item.type === "message" && item.role === "user";
}

export function beginLocalPendingMessage(
  sessionId: string,
  payload: string,
  items: SessionItem[],
): LocalPendingMessage {
  return {
    sessionId,
    payload,
    baselineUserItemIds: items.filter(isUserMessage).map((item) => item.id),
  };
}

export function hasDurablePendingMessage(
  pending: LocalPendingMessage,
  items: SessionItem[],
): boolean {
  const baseline = new Set(pending.baselineUserItemIds);
  return items.some((item) => (
    isUserMessage(item) &&
    !baseline.has(item.id) &&
    messageText(item) === pending.payload
  ));
}
