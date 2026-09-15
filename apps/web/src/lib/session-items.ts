import type { SessionItem } from "@agents-core-web/agents-client";

const TERMINAL_ITEM_STATUSES = new Set<SessionItem["status"]>([
  "completed",
  "failed",
  "incomplete",
]);

export function reconcileSessionItem(
  durableOrCurrent: SessionItem,
  liveOrIncoming: SessionItem,
): SessionItem {
  const currentIsTerminal = TERMINAL_ITEM_STATUSES.has(durableOrCurrent.status);
  const incomingIsTerminal = TERMINAL_ITEM_STATUSES.has(liveOrIncoming.status);

  if (currentIsTerminal && !incomingIsTerminal) return durableOrCurrent;
  if (!currentIsTerminal && incomingIsTerminal) return liveOrIncoming;
  return liveOrIncoming;
}

export function upsertSessionItem(
  items: SessionItem[],
  incoming: SessionItem,
): SessionItem[] {
  const existing = items.findIndex((item) => item.id === incoming.id);
  if (existing === -1) return [...items, incoming];
  return items.map((item, index) => (
    index === existing ? reconcileSessionItem(item, incoming) : item
  ));
}

/**
 * Apply a live update only to Items already owned by the same Session.
 * A newly selected Session must never inherit the previous Session's timeline.
 */
export function updateLiveSessionItems(
  current: SessionItem[],
  currentSessionId: string | null,
  eventSessionId: string,
  update: (items: SessionItem[]) => SessionItem[],
): SessionItem[] {
  return update(currentSessionId === eventSessionId ? current : []);
}

/**
 * Reconcile a durable read with Items that arrived while it was in flight.
 * Durable ordering stays authoritative. A terminal same-ID value wins over an
 * in-progress projection in either direction; otherwise the later live value
 * wins. Live-only Items are appended in arrival order.
 */
export function mergeDurableAndLiveItems(
  durable: SessionItem[],
  live: SessionItem[],
): SessionItem[] {
  const liveById = new Map<string, SessionItem>();
  const liveOrder: string[] = [];
  for (const item of live) {
    const previous = liveById.get(item.id);
    if (!previous) liveOrder.push(item.id);
    liveById.set(item.id, previous ? reconcileSessionItem(previous, item) : item);
  }
  const durableIds = new Set(durable.map((item) => item.id));

  return [
    ...durable.map((item) => {
      const liveItem = liveById.get(item.id);
      return liveItem ? reconcileSessionItem(item, liveItem) : item;
    }),
    ...liveOrder
      .filter((id) => !durableIds.has(id))
      .map((id) => liveById.get(id) as SessionItem),
  ];
}
