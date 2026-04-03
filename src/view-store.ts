import crypto from "crypto";
import { config } from "./config";
import type { ViewEntry } from "./types";

const store = new Map<string, ViewEntry>();

export function storeView(entry: Omit<ViewEntry, "id" | "createdAt" | "expiresAt">): string {
  const id = crypto.randomUUID();
  const now = Date.now();
  store.set(id, {
    ...entry,
    id,
    createdAt: now,
    expiresAt: now + config.viewStore.ttlMs,
  });
  return id;
}

export function getView(id: string): ViewEntry | null {
  const entry = store.get(id);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(id);
    return null;
  }
  return entry;
}

export function startViewCleanup(): void {
  setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of store) {
      if (now > entry.expiresAt) store.delete(id);
    }
  }, config.viewStore.cleanupIntervalMs);
}
