import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, hasDb } from "./db";
import { cache } from "./schema";

/** Stable JSON stringify (sorted keys) so equal inputs hash equally. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

export function hashInput(namespace: string, input: unknown): string {
  return createHash("sha256").update(namespace).update("\u0000").update(stableStringify(input)).digest("hex");
}

export function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

// In-process fallback when no DATABASE_URL (local smoke tests only)
const mem = new Map<string, unknown>();

export async function cacheGet<T>(namespace: string, input: unknown): Promise<T | undefined> {
  const key = hashInput(namespace, input);
  if (!hasDb()) return mem.get(key) as T | undefined;
  const rows = await db().select({ value: cache.value }).from(cache).where(eq(cache.key, key)).limit(1);
  return rows[0]?.value as T | undefined;
}

export async function cacheSet(namespace: string, input: unknown, value: unknown): Promise<void> {
  const key = hashInput(namespace, input);
  if (!hasDb()) {
    mem.set(key, value);
    return;
  }
  await db()
    .insert(cache)
    .values({ key, namespace, value: value as object })
    .onConflictDoUpdate({ target: cache.key, set: { value: value as object, createdAt: new Date() } });
}

/** Read-through cache. `bypass` forces a fresh call (e.g. stability evals) but still writes. */
export async function cached<T>(
  namespace: string,
  input: unknown,
  fn: () => Promise<T>,
  opts: { bypass?: boolean } = {},
): Promise<{ value: T; cached: boolean }> {
  if (!opts.bypass) {
    const hit = await cacheGet<T>(namespace, input);
    if (hit !== undefined) return { value: hit, cached: true };
  }
  const value = await fn();
  await cacheSet(namespace, input, value);
  return { value, cached: false };
}
