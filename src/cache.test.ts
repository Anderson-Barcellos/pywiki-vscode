import assert from "node:assert/strict";
import { test } from "node:test";
import { WikiCache, type CacheStorage, type WikiCacheEntry } from "./cache.ts";

class MemoryStorage implements CacheStorage {
  readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

function entry(markdown: string): WikiCacheEntry {
  return { markdown, responseId: `resp_${markdown}`, createdAt: 123 };
}

test("cache persiste resposta e response ID entre instâncias", async () => {
  const storage = new MemoryStorage();
  const first = new WikiCache(storage);
  await first.set("simbolo", entry("# Wiki"));

  const restored = new WikiCache(storage);
  assert.deepEqual(restored.get("simbolo"), entry("# Wiki"));
});

test("cache mantém limite LRU e clear também limpa a persistência", async () => {
  const storage = new MemoryStorage();
  const cache = new WikiCache(storage, 2);
  await cache.set("a", entry("a"));
  await cache.set("b", entry("b"));
  assert.equal(cache.get("a")?.markdown, "a");
  await cache.set("c", entry("c"));

  const restored = new WikiCache(storage, 2);
  assert.equal(restored.get("b"), undefined);
  assert.equal(restored.get("a")?.markdown, "a");
  assert.equal(restored.get("c")?.markdown, "c");

  await restored.clear();
  assert.equal(new WikiCache(storage).get("a"), undefined);
});
