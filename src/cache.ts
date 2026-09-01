export type WikiUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

export type WikiCacheEntry = {
  markdown: string;
  responseId?: string;
  usage?: WikiUsage;
  createdAt: number;
};

type StoredItem = { key: string; entry: WikiCacheEntry };

export type CacheStorage = {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
};

const STORAGE_KEY = "selwiki.responseCache.v1";

export class WikiCache {
  private readonly map = new Map<string, WikiCacheEntry>();
  private readonly storage?: CacheStorage;
  private readonly max: number;

  constructor(storage?: CacheStorage, max = 80) {
    this.storage = storage;
    this.max = max;
    const stored = storage?.get<StoredItem[]>(STORAGE_KEY);
    if (!Array.isArray(stored)) {
      return;
    }
    for (const item of stored.slice(-max)) {
      if (item?.key && item.entry?.markdown) {
        this.map.set(item.key, item.entry);
      }
    }
  }

  get(key: string): WikiCacheEntry | undefined {
    const value = this.map.get(key);
    if (value === undefined) {
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, value);
    void this.persist();
    return value;
  }

  async set(key: string, value: WikiCacheEntry): Promise<void> {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      this.map.delete(oldest);
    }
    await this.persist();
  }

  async clear(): Promise<void> {
    this.map.clear();
    await this.persist();
  }

  private async persist(): Promise<void> {
    if (!this.storage) {
      return;
    }
    const items: StoredItem[] = [...this.map].map(([key, entry]) => ({ key, entry }));
    await this.storage.update(STORAGE_KEY, items);
  }
}
