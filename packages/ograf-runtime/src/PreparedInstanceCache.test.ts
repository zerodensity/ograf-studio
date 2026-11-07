import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PREPARED_INSTANCE_BYTES,
  DEFAULT_PREPARED_INSTANCE_LIMIT,
  PreparedInstanceCache,
} from './PreparedInstanceCache';

const resource = (id: string) => ({ id });

describe('prepared instance cache', () => {
  it('consumes a ready resource once and transfers its disposal ownership', () => {
    const dispose = vi.fn();
    const cache = new PreparedInstanceCache({ dispose });
    const mount = resource('ready');
    expect(cache.put('["state",{"headline":"News"}]', mount, 4096)).toBe(true);
    expect(cache.has('["state",{"headline":"News"}]')).toBe(true);
    expect(cache.stats.hits).toBe(0);
    expect(cache.take('["state",{"headline":"News"}]')).toBe(mount);
    expect(cache.take('["state",{"headline":"News"}]')).toBeUndefined();
    expect(cache.stats).toEqual({
      entries: 0,
      estimatedBytes: 0,
      hits: 1,
      misses: 1,
      evictions: 0,
    });
    cache.clear();
    expect(dispose).not.toHaveBeenCalled();
  });

  it('evicts the oldest unconsumed candidate by count and promotes replacements', () => {
    const dispose = vi.fn();
    const cache = new PreparedInstanceCache({ dispose, maxEntries: 2 });
    const first = resource('first');
    const second = resource('second');
    const replaced = resource('replacement');
    cache.put('first', first, 1);
    cache.put('second', second, 1);
    cache.put('first', replaced, 1);
    expect(dispose.mock.calls).toEqual([[first]]);
    expect(cache.put('third', resource('third'), 1)).toBe(true);
    expect([...cache.keys()]).toEqual(['first', 'third']);
    expect(dispose.mock.calls).toEqual([[first], [second]]);
    expect(cache.stats.evictions).toBe(1);
    expect(cache.take('first')).toBe(replaced);
  });

  it('enforces the estimated memory budget independently of entry count', () => {
    const dispose = vi.fn();
    const cache = new PreparedInstanceCache({ dispose, maxEntries: 8, maxEstimatedBytes: 100 });
    const first = resource('first');
    const second = resource('second');
    cache.put('first', first, 45);
    cache.put('second', second, 50);
    cache.put('third', resource('third'), 60);
    expect(dispose.mock.calls).toEqual([[first], [second]]);
    expect(cache.stats).toMatchObject({ entries: 1, estimatedBytes: 60, evictions: 2 });
  });

  it('rejects an oversized or invalid candidate without replacing a useful entry', () => {
    const dispose = vi.fn();
    const cache = new PreparedInstanceCache({ dispose, maxEstimatedBytes: 100 });
    const kept = resource('kept');
    cache.put('state', kept, 50);
    for (const cost of [101, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const invalid = resource(String(cost));
      expect(cache.put('state', invalid, cost)).toBe(false);
      expect(dispose).toHaveBeenLastCalledWith(invalid);
      expect(cache.has('state')).toBe(true);
    }
    expect(cache.take('state')).toBe(kept);
    expect(dispose).toHaveBeenCalledTimes(4);
  });

  it('uses bounded defaults and allows the pool to be disabled with zero entries', () => {
    expect(DEFAULT_PREPARED_INSTANCE_LIMIT).toBe(4);
    expect(DEFAULT_PREPARED_INSTANCE_BYTES).toBe(64 * 1024 * 1024);
    const dispose = vi.fn();
    const cache = new PreparedInstanceCache({ dispose, maxEntries: 0 });
    const rejected = resource('disabled');
    expect(cache.put('state', rejected, 0)).toBe(false);
    expect(dispose).toHaveBeenCalledExactlyOnceWith(rejected);
    expect(cache.stats.entries).toBe(0);
  });

  it('never owns the same resource twice across keys or on repeated insertion', () => {
    const dispose = vi.fn();
    const cache = new PreparedInstanceCache({ dispose });
    const mount = resource('one owner');
    cache.put('before', mount, 10);
    cache.put('before', mount, 20);
    cache.put('after', mount, 30);
    expect([...cache.keys()]).toEqual(['after']);
    expect(cache.stats.estimatedBytes).toBe(30);
    expect(dispose).not.toHaveBeenCalled();
    cache.clear();
    cache.clear();
    expect(dispose).toHaveBeenCalledExactlyOnceWith(mount);
  });

  it('does not dispose an already cached resource when a replacement estimate is invalid', () => {
    const dispose = vi.fn();
    const cache = new PreparedInstanceCache({ dispose, maxEstimatedBytes: 100 });
    const mount = resource('valid');
    cache.put('state', mount, 10);
    expect(cache.put('other', mount, 101)).toBe(false);
    expect(cache.take('state')).toBe(mount);
    expect(dispose).not.toHaveBeenCalled();
  });

  it('deletes owned resources exactly once and resets statistics on clear', () => {
    const dispose = vi.fn();
    const cache = new PreparedInstanceCache({ dispose });
    const first = resource('delete');
    const second = resource('clear');
    cache.put('first', first, 10);
    cache.put('second', second, 20);
    expect(cache.delete('first')).toBe(true);
    expect(cache.delete('first')).toBe(false);
    cache.take('missing');
    const snapshot = cache.stats;
    snapshot.entries = 999;
    expect(cache.stats.entries).toBe(1);
    cache.clear();
    expect(dispose.mock.calls).toEqual([[first], [second]]);
    expect(cache.stats).toEqual({
      entries: 0,
      estimatedBytes: 0,
      hits: 0,
      misses: 0,
      evictions: 0,
    });
  });

  it('isolates cleanup failures and releases every remaining resource', () => {
    const dispose = vi.fn(() => {
      throw new Error('Driver cleanup failed');
    });
    const cache = new PreparedInstanceCache({ dispose, maxEntries: 1 });
    const first = resource('first');
    const second = resource('second');
    cache.put('first', first, 1);
    expect(() => cache.put('second', second, 1)).not.toThrow();
    expect(() => cache.clear()).not.toThrow();
    expect(dispose.mock.calls).toEqual([[first], [second]]);
    expect(cache.stats.entries).toBe(0);
  });

  it('rejects invalid budgets at construction', () => {
    for (const maxEntries of [-1, 0.5, Number.POSITIVE_INFINITY])
      expect(() => new PreparedInstanceCache({ dispose: vi.fn(), maxEntries })).toThrow(RangeError);
    for (const maxEstimatedBytes of [-1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => new PreparedInstanceCache({ dispose: vi.fn(), maxEstimatedBytes })).toThrow(
        RangeError,
      );
  });
});
