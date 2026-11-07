export const DEFAULT_PREPARED_INSTANCE_LIMIT = 4;
export const DEFAULT_PREPARED_INSTANCE_BYTES = 64 * 1024 * 1024;

export interface PreparedInstanceCacheStats {
  entries: number;
  estimatedBytes: number;
  hits: number;
  misses: number;
  evictions: number;
}

/**
 * Owns dormant, ready resources until a caller consumes them. The caller must only
 * insert pristine instances or resource probes, never a previously active renderer.
 * Byte counts are estimates used for admission, not a measurement of GPU memory.
 */
export class PreparedInstanceCache<T extends object> {
  readonly #maxEntries: number;
  readonly #maxEstimatedBytes: number;
  readonly #dispose: (value: T) => void;
  readonly #entries = new Map<string, { value: T; estimatedBytes: number }>();
  readonly #owners = new Map<T, string>();
  #estimatedBytes = 0;
  #hits = 0;
  #misses = 0;
  #evictions = 0;

  constructor(options: {
    dispose(value: T): void;
    maxEntries?: number;
    maxEstimatedBytes?: number;
  }) {
    this.#maxEntries = options.maxEntries ?? DEFAULT_PREPARED_INSTANCE_LIMIT;
    this.#maxEstimatedBytes = options.maxEstimatedBytes ?? DEFAULT_PREPARED_INSTANCE_BYTES;
    if (!Number.isSafeInteger(this.#maxEntries) || this.#maxEntries < 0)
      throw new RangeError('Prepared instance limit must be a nonnegative safe integer.');
    if (!Number.isFinite(this.#maxEstimatedBytes) || this.#maxEstimatedBytes < 0)
      throw new RangeError('Prepared instance byte budget must be finite and nonnegative.');
    this.#dispose = options.dispose;
  }

  get stats(): PreparedInstanceCacheStats {
    return {
      entries: this.#entries.size,
      estimatedBytes: this.#estimatedBytes,
      hits: this.#hits,
      misses: this.#misses,
      evictions: this.#evictions,
    };
  }

  /** Presence checks do not promote entries or record a consumer cache hit. */
  has(key: string): boolean {
    return this.#entries.has(key);
  }

  keys(): IterableIterator<string> {
    return this.#entries.keys();
  }

  /** Transfers sole ownership to the caller; the cache will not dispose this value. */
  take(key: string): T | undefined {
    const entry = this.#remove(key);
    if (!entry) {
      ++this.#misses;
      return undefined;
    }
    ++this.#hits;
    return entry.value;
  }

  /**
   * Takes ownership and promotes the entry to most recently prepared. An oversized
   * candidate is disposed without evicting a useful existing entry with the same key.
   */
  put(key: string, value: T, estimatedBytes: number): boolean {
    const ownedKey = this.#owners.get(value);
    if (
      !Number.isFinite(estimatedBytes) ||
      estimatedBytes < 0 ||
      !this.#maxEntries ||
      estimatedBytes > this.#maxEstimatedBytes
    ) {
      if (ownedKey === undefined) this.#release(value);
      return false;
    }
    // A resource has one owner even if a caller changes its cache identity.
    if (ownedKey !== undefined) this.#remove(ownedKey);
    this.delete(key);
    this.#entries.set(key, { value, estimatedBytes });
    this.#owners.set(value, key);
    this.#estimatedBytes += estimatedBytes;
    while (
      this.#entries.size > this.#maxEntries ||
      this.#estimatedBytes > this.#maxEstimatedBytes
    ) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
      ++this.#evictions;
    }
    return this.#owners.get(value) === key;
  }

  delete(key: string): boolean {
    const entry = this.#remove(key);
    if (!entry) return false;
    this.#release(entry.value);
    return true;
  }

  /** Releases owned resources and starts a new statistics lifetime. */
  clear(): void {
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    this.#owners.clear();
    this.#estimatedBytes = 0;
    this.#hits = 0;
    this.#misses = 0;
    this.#evictions = 0;
    for (const entry of entries) this.#release(entry.value);
  }

  #remove(key: string): { value: T; estimatedBytes: number } | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    this.#owners.delete(entry.value);
    this.#estimatedBytes = Math.max(0, this.#estimatedBytes - entry.estimatedBytes);
    return entry;
  }

  #release(value: T): void {
    try {
      this.#dispose(value);
    } catch {
      // Eviction and background cleanup must not interrupt on-air rendering.
    }
  }
}
