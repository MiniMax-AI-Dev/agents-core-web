import type { SessionItem } from "@agents-core-web/agents-client";

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
 * Durable ordering stays authoritative; same-id live values win and live-only
 * Items are appended in their arrival order.
 */
export function mergeDurableAndLiveItems(
  durable: SessionItem[],
  live: SessionItem[],
): SessionItem[] {
  const liveById = new Map(live.map((item) => [item.id, item]));
  const durableIds = new Set(durable.map((item) => item.id));

  return [
    ...durable.map((item) => liveById.get(item.id) ?? item),
    ...live.filter((item) => !durableIds.has(item.id)),
  ];
}
