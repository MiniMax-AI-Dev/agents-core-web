export type SettledCollection<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };

export async function settleCollection<T>(load: () => Promise<T>): Promise<SettledCollection<T>> {
  try {
    return { status: "fulfilled", value: await load() };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}
