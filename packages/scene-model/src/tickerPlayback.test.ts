import { describe, expect, it } from 'vitest';
import {
  cloneTickerPlayback,
  createTextElement,
  createTickerElement,
  createTickerPlayback,
  getTickerLayout,
  sampleTicker,
  sampleTickerPlayback,
  resizeTickerPlayback,
  peekTickerPlaybackCandidates,
  updateTickerPlayback,
  type TickerElement,
  type TickerItem,
} from './index';

const item = (id: string, width = 120, content = id): TickerItem => ({
  id,
  width,
  element: createTextElement({ content }),
});
const ticker = (patch: Partial<TickerElement> = {}) =>
  createTickerElement({
    direction: 'left',
    gap: 20,
    speedPixelsPerSecond: 100,
    items: [item('a'), item('b'), item('c')],
    ...patch,
  });
const visible = (sample: ReturnType<typeof sampleTickerPlayback>, width: number) =>
  sample.instances.filter((pass) => pass.admitted && pass.x < width && pass.x + pass.width > 0);

for (const direction of ['left', 'right'] as const)
  describe(`next-appearance ${direction}`, () => {
    it('retains the exact initial repeating layout at arbitrary elapsed time', () => {
      const element = ticker({ direction });
      for (const time of [0, 500, 4300, 1_234_567]) {
        const state = createTickerPlayback(element, 400, time);
        const sample = sampleTickerPlayback(state, time);
        const baseline = sampleTicker(element, 400, time);
        const offset =
          direction === 'right' && baseline.offset === 0 ? -baseline.period : baseline.offset;
        const expected: { id: string; x: number }[] = [];
        for (let cycle = -2; cycle < 5; cycle++)
          for (const row of getTickerLayout(element, 50)) {
            const x = row.x + cycle * baseline.period + offset;
            if (x < 400 && x + row.width > 0) expected.push({ id: row.id, x });
          }
        expect(
          visible(sample, 400)
            .map((pass) => ({ id: pass.item.id, x: pass.x }))
            .sort((a, b) => a.x - b.x),
        ).toEqual(expected.sort((a, b) => a.x - b.x));
      }
    });

    it('pins visible content, dimensions and gaps while replacements enter on later passes', () => {
      const element = ticker({ direction });
      const state = createTickerPlayback(element, 400);
      const before = sampleTickerPlayback(state, 200);
      const pinned = visible(before, 400);
      const changed = ticker({
        direction,
        gap: 55,
        items: [
          item('a', 200, 'updated A'),
          item('b', 90, 'updated B'),
          item('c', 160, 'updated C'),
        ],
      });
      updateTickerPlayback(state, changed, 400, 200);
      const sameTime = sampleTickerPlayback(state, 200);
      for (const pass of pinned)
        expect(sameTime.instances.find((row) => row.key === pass.key)).toMatchObject({
          item: pass.item,
          x: pass.x,
          width: pass.width,
          gapAfter: 20,
        });
      expect(sameTime.pending.total).toBeGreaterThan(0);
      const after = sampleTickerPlayback(state, 10_000);
      expect(
        visible(after, 400).every(
          (pass) =>
            pass.item.element.type === 'text' && pass.item.element.content.startsWith('updated'),
        ),
      ).toBe(true);
      expect(after.pending.total).toBe(0);
    });

    it('removes future copies immediately while letting each admitted copy finish', () => {
      const element = ticker({ direction });
      const state = createTickerPlayback(element, 400);
      const before = sampleTickerPlayback(state, 100);
      const old = visible(before, 400).filter((pass) => pass.item.id === 'b');
      updateTickerPlayback(
        state,
        { ...element, items: element.items.filter((row) => row.id !== 'b') },
        400,
        100,
      );
      const changed = sampleTickerPlayback(state, 100);
      for (const pass of old)
        expect(changed.instances.find((row) => row.key === pass.key)).toMatchObject({
          x: pass.x,
          item: pass.item,
        });
      expect(
        changed.instances.filter((pass) => !pass.admitted).some((pass) => pass.item.id === 'b'),
      ).toBe(false);
      const after = sampleTickerPlayback(state, 10_000);
      expect(after.instances.some((pass) => pass.item.id === 'b')).toBe(false);
      expect(after.pending.removed).toBe(0);
    });

    it('inserts new IDs offscreen without moving admitted copies', () => {
      const element = ticker({ direction });
      const state = createTickerPlayback(element, 400);
      const before = sampleTickerPlayback(state, 200);
      updateTickerPlayback(
        state,
        { ...element, items: [element.items[0]!, item('new', 180), ...element.items.slice(1)] },
        400,
        200,
      );
      const changed = sampleTickerPlayback(state, 200);
      for (const pass of before.instances.filter((pass) => pass.admitted))
        expect(changed.instances.find((row) => row.key === pass.key)?.x).toBe(pass.x);
      const inserted = changed.instances.filter((pass) => pass.item.id === 'new');
      expect(inserted.length).toBeGreaterThan(0);
      expect(inserted.every((pass) => pass.x >= 400 || pass.x + pass.width <= 0)).toBe(true);
      expect(sampleTickerPlayback(state, 10_000).pending.inserted).toBe(0);
    });

    it('updates a short repeating feed per pass even while another copy of the ID is visible', () => {
      const element = ticker({ direction, items: [item('short', 80)], gap: 10 });
      const state = createTickerPlayback(element, 400);
      const initial = sampleTickerPlayback(state, 250);
      updateTickerPlayback(
        state,
        { ...element, items: [item('short', 110, 'replacement')] },
        400,
        250,
      );
      const later = sampleTickerPlayback(state, 1800);
      const current = visible(later, 400);
      expect(
        current.some(
          (pass) =>
            pass.item.element.type === 'text' && pass.item.element.content === 'replacement',
        ),
      ).toBe(true);
      expect(
        current.some(
          (pass) => pass.item.element.type === 'text' && pass.item.element.content === 'short',
        ),
      ).toBe(true);
      expect(initial.instances.length).toBeLessThan(2048);
    });

    it('preserves exact subpixel speed through edits at eight output frame rates', () => {
      for (const fps of [24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60]) {
        const element = ticker({
          direction,
          speedPixelsPerSecond: 137.25,
          items: [item('long', 1200)],
        });
        const state = createTickerPlayback(element, 400);
        const first = visible(sampleTickerPlayback(state, 0), 400)[0]!;
        let previous = first.x;
        for (let frame = 1; frame <= 30; frame++) {
          const time = (frame * 1000) / fps;
          if (frame === 12)
            updateTickerPlayback(
              state,
              { ...element, items: [item('long', 1500, 'changed')] },
              400,
              time,
            );
          const pass = sampleTickerPlayback(state, time).instances.find(
            (row) => row.key === first.key,
          )!;
          expect(pass.x - previous).toBeCloseTo(
            ((direction === 'right' ? 1 : -1) * 137.25) / fps,
            8,
          );
          previous = pass.x;
        }
      }
    });
  });

it.each(['left', 'right'] as const)(
  'removes already prepared %s copies before they enter and closes only offscreen space',
  (direction) => {
    const element = ticker({ direction, items: [item('a', 100), item('b', 100), item('c', 100)] });
    const state = createTickerPlayback(element, 100);
    const before = sampleTickerPlayback(state, 0);
    const future = before.instances.find((pass) => pass.admitted && !pass.entered)!;
    expect(future).toBeDefined();
    updateTickerPlayback(
      state,
      { ...element, items: element.items.filter((row) => row.id !== future.item.id) },
      100,
      0,
    );
    const after = sampleTickerPlayback(state, 0);
    expect(after.instances.some((pass) => pass.item.id === future.item.id)).toBe(false);
    for (const pass of visible(before, 100))
      expect(after.instances.find((row) => row.key === pass.key)?.x).toBe(pass.x);
    expect(after.pending.removed).toBe(0);
  },
);

describe('ticker transport lifecycle', () => {
  it('prepares a distant forward window before making any admission decisions', () => {
    const state = createTickerPlayback(ticker(), 400);
    sampleTickerPlayback(state, 100);
    const keys = new Set(peekTickerPlaybackCandidates(state, 60_000).map((row) => row.key));
    expect(state.core.lastTime).toBe(100);
    expect(state.core.passes.every((row) => !row.admitted)).toBe(true);
    const sample = sampleTickerPlayback(state, 60_000, {
      isReady: (_item, _revision, key) => keys.has(key),
    });
    expect(visible(sample, 400).every((row) => row.admitted)).toBe(true);
    expect(state.decisions.size).toBe(0);
    const expected = sampleTickerPlayback(createTickerPlayback(ticker(), 400), 100);
    expect(sampleTickerPlayback(state, 100, { isReady: () => true })).toEqual(expected);
  });
  it.each(['left', 'right'] as const)(
    'resizes %s viewports without changing visible positions or adding feed history',
    (direction) => {
      const element = ticker({ direction });
      const state = createTickerPlayback(element, 400);
      const before = sampleTickerPlayback(state, 200);
      resizeTickerPlayback(state, 600, 200);
      const after = sampleTickerPlayback(state, 200);
      for (const pass of before.instances)
        expect(after.instances.find((row) => row.key === pass.key)?.x).toBe(pass.x);
      expect(after.pending.total).toBe(0);
      expect(state.events).toHaveLength(0);
      resizeTickerPlayback(state, 300, 300);
      expect(state.events).toHaveLength(0);
    },
  );
  it('reanchors speed changes without jumping the current pass', () => {
    const element = ticker();
    const state = createTickerPlayback(element, 400);
    const before = visible(sampleTickerPlayback(state, 500), 400)[0]!;
    updateTickerPlayback(state, { ...element, speedPixelsPerSecond: 250 }, 400, 500);
    expect(
      sampleTickerPlayback(state, 500).instances.find((row) => row.key === before.key)?.x,
    ).toBe(before.x);
    expect(
      sampleTickerPlayback(state, 600).instances.find((row) => row.key === before.key)?.x,
    ).toBeCloseTo(before.x - 25);
  });
  it('retains prepared pass identities during speed and stationary mask updates', () => {
    const element = ticker();
    const state = createTickerPlayback(element, 400);
    const before = sampleTickerPlayback(state, 100);
    updateTickerPlayback(
      state,
      { ...element, speedPixelsPerSecond: 180, entryFade: 80, background: '#123456' },
      400,
      100,
    );
    const after = sampleTickerPlayback(state, 100);
    for (const pass of before.instances)
      expect(after.instances.find((row) => row.key === pass.key)).toMatchObject({
        x: pass.x,
        entry: pass.entry,
        item: pass.item,
      });
    expect(after.pending.total).toBe(0);
    expect(state.decisions.size).toBe(0);
  });
  it('replays feed and speed events deterministically after repeated backward seeks', () => {
    const element = ticker();
    const state = createTickerPlayback(element, 400);
    sampleTickerPlayback(state, 200);
    updateTickerPlayback(
      state,
      { ...element, items: [item('a', 150, 'new'), item('new', 100), item('c')] },
      400,
      500,
    );
    updateTickerPlayback(
      state,
      {
        ...element,
        speedPixelsPerSecond: 180,
        items: [item('a', 150, 'new'), item('new', 100), item('c')],
      },
      400,
      1200,
    );
    const final = sampleTickerPlayback(state, 2500);
    sampleTickerPlayback(state, 100);
    expect(sampleTickerPlayback(state, 2500)).toEqual(final);
    sampleTickerPlayback(state, 800);
    expect(sampleTickerPlayback(state, 2500)).toEqual(final);
  });
  it('keeps a prepared previous version if a replacement is not ready before admission', () => {
    const element = ticker({ items: [item('a', 100)], gap: 20 });
    const state = createTickerPlayback(element, 300);
    sampleTickerPlayback(state, 0);
    updateTickerPlayback(state, { ...element, items: [item('a', 160, 'not ready')] }, 300, 100);
    const sample = sampleTickerPlayback(state, 1000, {
      isReady: (value) => value.element.type === 'text' && value.element.content !== 'not ready',
    });
    expect(
      visible(sample, 300).every(
        (pass) => pass.item.element.type === 'text' && pass.item.element.content === 'a',
      ),
    ).toBe(true);
    expect(sample.pending.changed).toBe(1);
  });
  it('skips unready insertions without leaving a gap before the next prepared item', () => {
    const element = ticker({ items: [item('a', 100), item('b', 100)], gap: 20 });
    const state = createTickerPlayback(element, 300);
    sampleTickerPlayback(state, 0);
    updateTickerPlayback(
      state,
      { ...element, items: [item('a', 100), item('new', 200), item('b', 100)] },
      300,
      100,
    );
    const sample = sampleTickerPlayback(state, 2000, { isReady: (value) => value.id !== 'new' });
    expect(
      sample.instances.filter((pass) => pass.admitted).every((pass) => pass.item.id !== 'new'),
    ).toBe(true);
    const admitted = sample.instances
      .filter((pass) => pass.admitted)
      .sort((a, b) => a.entry - b.entry);
    for (let index = 1; index < admitted.length; index++)
      expect(admitted[index]!.entry - admitted[index - 1]!.entry).toBe(
        admitted[index - 1]!.width + 20,
      );
  });
  it('copies transport state without sharing mutable source snapshots', () => {
    const state = createTickerPlayback(ticker(), 400);
    sampleTickerPlayback(state, 100);
    const copied = cloneTickerPlayback(state);
    updateTickerPlayback(copied, ticker({ items: [item('different')] }), 400, 200);
    expect(state.core.element.items[0]!.id).toBe('a');
    expect(copied.core.element.items[0]!.id).toBe('different');
  });
  it('bounds resources and can sample a full day without visiting every intervening pass', () => {
    const state = createTickerPlayback(ticker(), 400);
    expect(sampleTickerPlayback(state, 86_400_000).instances.length).toBeLessThan(30);
    expect(() =>
      sampleTickerPlayback(
        createTickerPlayback(ticker({ items: [item('tiny', 1)], gap: 0 }), 3000),
        0,
      ),
    ).toThrow('2048');
  });
});
