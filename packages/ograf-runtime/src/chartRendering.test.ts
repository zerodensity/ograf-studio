import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createChartElement,
  createRendererPluginSnapshot,
  type ChartMarkPose,
  type CompiledChartMarkAnimations,
} from '@ograf-editor/scene-model';
import {
  disposeChart,
  mountChart,
  renderChartAnimationAtFrame,
  updateMountedChart,
  renderChartAnimationHistoryAtFrame,
  setChartMarkAnimationFrame,
  waitForChartsReady,
  applyChartPaintTracks,
  compactSettledChartAnimationHistory,
  chartUpdateChangesDataOnly,
  type ChartAnimationHistoryEntry,
} from './chartRendering';

function chartHost() {
  const canvases: HTMLCanvasElement[] = [];
  const document = {
    createElement(tag: string) {
      const node: Record<string, unknown> = {
        style: {},
        dataset: {},
        width: 640,
        height: 360,
        appendChild: vi.fn(),
      };
      if (tag === 'canvas') {
        const context = new Proxy(
          { canvas: node, measureText: (value: string) => ({ width: value.length * 6 }) },
          {
            get(target, property) {
              if (property in target) return target[property as keyof typeof target];
              return () => undefined;
            },
          },
        );
        node.getContext = vi.fn(() => context);
        canvases.push(node as unknown as HTMLCanvasElement);
      }
      return node;
    },
  };
  return {
    host: {
      ownerDocument: document,
      dataset: {},
      appendChild: vi.fn(),
    } as unknown as HTMLElement,
    canvas: () => canvases[0]!,
    canvases: () => canvases,
  };
}

interface ProviderCalls {
  imports: number;
  creates: number;
  updates: number;
  disposes: number;
  frames: Array<[number, number]>;
  resets: number;
  sampleMarks: boolean;
  markPoses: Array<{ frame: number; poses: Array<ChartMarkPose | null> }>;
  frozenHost?: boolean;
  frameRate?: number;
  initialSize?: [number, number];
  resolve?: () => void;
}

function providerFixture(id: string, delayed = false) {
  const calls: ProviderCalls = {
    imports: 0,
    creates: 0,
    updates: 0,
    disposes: 0,
    frames: [],
    resets: 0,
    sampleMarks: false,
    markPoses: [],
  };
  vi.stubGlobal('__ografTestProviderCalls', calls);
  const source = `
    const calls = globalThis.__ografTestProviderCalls;
    calls.imports++;
    export default {
      apiVersion: 1,
      create(canvas, element, hostAPI) {
        calls.creates++;
        calls.initialSize = [canvas.width, canvas.height];
        calls.frameRate = hostAPI.frameRate;
        calls.frozenHost = Object.isFrozen(hostAPI);
        let current = element;
        const renderer = {
          renderAtFrame(frame) {
            calls.frames.push([frame, current.data.datasets[0].data[0]]);
            if (calls.sampleMarks)
              calls.markPoses.push({frame, poses: [0, 1].map(index => hostAPI.sampleChartMarkAnimation(index))});
          },
          update(next) { current = next; calls.updates++; },
          resetAnimation() { calls.resets++; },
          renderMarkLayers(mask, foreground) {
            mask.getContext('2d');
            foreground.getContext('2d');
            mask.width = foreground.width = 640;
            mask.height = foreground.height = 360;
          },
          dispose() { calls.disposes++; },
        };
        ${delayed ? 'return new Promise(resolve => { calls.resolve = () => resolve(renderer); });' : 'return renderer;'}
      },
    };
  `;
  const snapshot = createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id,
      version: '1.0.0',
      name: 'Test provider',
      presets: ['bar'],
      license: 'MIT',
    },
    source,
    licenseText: 'MIT test fixture',
  });
  const element = createChartElement({
    provider: { id, version: snapshot.manifest.version, sha256: snapshot.sha256 },
  });
  return { calls, snapshot, element };
}

function markProviderFixture(id: string, delayed = false) {
  const fixture = providerFixture(id, delayed);
  const snapshot = createRendererPluginSnapshot({
    ...fixture.snapshot,
    manifest: {
      ...fixture.snapshot.manifest,
      chartFeatures: ['mark-animation-v1', 'morph-update-v1'],
    },
  });
  const phase = {
    reference: { id: 'test.animations', version: '1.0.0', sha256: 'a'.repeat(64) },
    presetId: 'test-mark-pose',
    durationFrames: 20,
    delayFrames: 0,
    staggerFrames: 5,
  };
  const element = {
    ...fixture.element,
    provider: { id, version: snapshot.manifest.version, sha256: snapshot.sha256 },
    markAnimations: { in: phase, out: phase },
  };
  const key = (frame: number, value: number) => ({
    id: `key-${frame}-${value}`,
    frame,
    value,
    easing: 'linear' as const,
  });
  const compiled: CompiledChartMarkAnimations = {
    in: {
      startFrame: 10,
      durationFrames: 20,
      staggerFrames: 5,
      staggerSlots: 4,
      tracks: { opacity: [key(0, 0), key(20, 1)], x: [key(0, -100), key(20, 0)] },
    },
    out: {
      startFrame: 80,
      durationFrames: 20,
      staggerFrames: 5,
      staggerSlots: 4,
      tracks: { opacity: [key(0, 1), key(20, 0)], x: [key(0, 0), key(20, 50)] },
    },
  };
  fixture.calls.sampleMarks = true;
  return { ...fixture, snapshot, element, compiled };
}

afterEach(() => {
  globalThis.__OGRAF_STUDIO_RENDERER_PLUGIN_POLICY__ = undefined;
  vi.useRealTimers();
});

describe('external renderer provider lifecycle', () => {
  it.each(['fade', 'reveal'] as const)(
    'retains interrupted %s morph origins until the final staggered point settles',
    (type) => {
      const element = createChartElement({
        data: {
          labels: ['A', 'B', 'C'],
          datasets: [
            {
              label: 'Values',
              data: [10, 20, 30],
              backgroundColor: '#44e6ad',
              borderColor: '#102637',
            },
          ],
        },
        animation: {
          type,
          durationFrames: 25,
          delayFrames: 0,
          staggerFrames: 10,
          easing: 'linear',
          replayOnUpdate: true,
          updateMode: 'morph',
        },
      });
      const history: ChartAnimationHistoryEntry[] = [0, 50, 80].map((frame) => ({
        frame,
        element: structuredClone(element),
      }));
      const before = structuredClone(history);
      compactSettledChartAnimationHistory(history);
      expect(history).toEqual(before);
      history.push({ frame: 130, element: structuredClone(element) });
      compactSettledChartAnimationHistory(history);
      expect(history.map((entry) => entry.frame)).toEqual([80, 130]);
      expect(history[0]!.reset).toBe(true);
    },
  );

  it('only treats data edits as deferrable, retaining provider, paint and style readiness', () => {
    const element = createChartElement();
    const next = structuredClone(element);
    next.data.datasets[0]!.data[0] = 99;
    expect(chartUpdateChangesDataOnly(element, next)).toBe(true);
    expect(chartUpdateChangesDataOnly(element, { ...next, fill: '#ffffff' })).toBe(false);
    expect(
      chartUpdateChangesDataOnly(element, {
        ...next,
        provider: { id: 'other', version: '2', sha256: 'a'.repeat(64) },
      }),
    ).toBe(false);
    expect(chartUpdateChangesDataOnly(element, { ...next, fontSize: next.fontSize + 1 })).toBe(
      false,
    );
  });
  it('selects a readable hidden mark mask before the provider allocates its context', async () => {
    const fixture = providerFixture('test.readable-mark-mask');
    const snapshot = createRendererPluginSnapshot({
      ...fixture.snapshot,
      manifest: { ...fixture.snapshot.manifest, chartFeatures: ['mark-paint-v1'] },
    });
    const element = {
      ...fixture.element,
      provider: {
        id: snapshot.manifest.id,
        version: snapshot.manifest.version,
        sha256: snapshot.sha256,
      },
      fill: '#ffffff',
    };
    const { host, canvases } = chartHost();
    mountChart(host, element, { rendererPlugins: [snapshot] });
    const [chart, mask, paint, foreground] = canvases();
    expect(mask!.getContext).toHaveBeenNthCalledWith(1, '2d', { willReadFrequently: true });
    await waitForChartsReady(host);
    expect(mask!.getContext).toHaveBeenNthCalledWith(2, '2d');
    expect(foreground!.getContext).toHaveBeenNthCalledWith(1, '2d');
    for (const canvas of [chart, paint, foreground])
      expect(canvas!.getContext).not.toHaveBeenCalledWith('2d', { willReadFrequently: true });
    disposeChart(host);
  });

  it('seeds a detached chart bitmap from its authored layer size before provider creation', async () => {
    const fixture = providerFixture('test.detached-chart-size');
    const { host, canvas } = chartHost();
    Object.assign(host, {
      style: { width: '960px', height: '540px' },
      clientWidth: 0,
      clientHeight: 0,
    });
    mountChart(host, fixture.element, { rendererPlugins: [fixture.snapshot] });
    expect([canvas().width, canvas().height]).toEqual([960, 540]);
    await waitForChartsReady(host);
    expect(fixture.calls.initialSize).toEqual([960, 540]);
    disposeChart(host);
  });

  it('prefers current layout dimensions to authored style and resolves a detached percentage wrapper', async () => {
    const visible = providerFixture('test.visible-chart-size');
    const first = chartHost();
    Object.assign(first.host, {
      style: { width: '960px', height: '540px' },
      clientWidth: 800,
      clientHeight: 400,
    });
    mountChart(first.host, visible.element, { rendererPlugins: [visible.snapshot] });
    expect([first.canvas().width, first.canvas().height]).toEqual([800, 400]);
    await waitForChartsReady(first.host);
    expect(visible.calls.initialSize).toEqual([800, 400]);
    disposeChart(first.host);

    const detached = providerFixture('test.detached-chart-wrapper');
    const second = chartHost();
    Object.assign(second.host, {
      style: { width: '100%', height: '100%' },
      clientWidth: 0,
      clientHeight: 0,
      parentElement: {
        style: { width: '740px', height: '415px' },
        clientWidth: 0,
        clientHeight: 0,
        parentElement: null,
      },
    });
    mountChart(second.host, detached.element, { rendererPlugins: [detached.snapshot] });
    await waitForChartsReady(second.host);
    expect(detached.calls.initialSize).toEqual([740, 415]);
    disposeChart(second.host);
  });

  it('defers early zero-size paint tracks while the provider mounts, then readies and draws valid coverage', async () => {
    const fixture = providerFixture('test.pending-paint-coverage', true);
    const snapshot = createRendererPluginSnapshot({
      ...fixture.snapshot,
      manifest: { ...fixture.snapshot.manifest, chartFeatures: ['mark-paint-v1'] },
    });
    const element = {
      ...fixture.element,
      provider: {
        id: snapshot.manifest.id,
        version: snapshot.manifest.version,
        sha256: snapshot.sha256,
      },
      fill: '#ffffff',
    };
    const { host, canvases } = chartHost();
    mountChart(host, element, { rendererPlugins: [snapshot] });
    const [, mask, paint] = canvases();
    mask!.width = mask!.height = 0;
    const draw = vi.fn((source: unknown) => {
      const canvas = source as HTMLCanvasElement;
      if (canvas.width <= 0 || canvas.height <= 0) throw new Error('zero-size canvas');
    });
    paint!.getContext('2d')!.drawImage = draw;
    expect(applyChartPaintTracks(host, {}, 0)).toBe(true);
    expect(draw).not.toHaveBeenCalled();
    let ready = false;
    const readiness = waitForChartsReady(host).then(() => {
      ready = true;
    });
    await vi.waitFor(() => expect(fixture.calls.creates).toBe(1));
    expect(ready).toBe(false);
    fixture.calls.resolve!();
    await readiness;
    expect([mask!.width, mask!.height]).toEqual([640, 360]);
    expect([paint!.width, paint!.height]).toEqual([640, 360]);
    expect(draw).toHaveBeenCalledWith(mask, 0, 0);
    expect(applyChartPaintTracks(host, {}, 1)).toBe(true);
    disposeChart(host);
  });

  it('samples mark In/Out on the lifecycle clock independently of data replay, backward and repeated seeks', async () => {
    const { calls, snapshot, element, compiled } = markProviderFixture('test.mark-clocks');
    const { host } = chartHost();
    mountChart(host, element, { rendererPlugins: [snapshot], chartMarkAnimations: compiled });
    await waitForChartsReady(host);
    expect(calls.frozenHost).toBe(true);
    calls.markPoses = [];
    host.dataset.ografChartAnimationFrame = '0';
    for (const markFrame of [20, 90, 20, 90])
      renderChartAnimationAtFrame(host, element, 500, markFrame);
    expect(calls.markPoses.map((sample) => sample.frame)).toEqual([0, 0, 0, 0]);
    expect(calls.markPoses[0]!.poses).toMatchObject([
      { x: -50, opacity: 0.5 },
      { x: -75, opacity: 0.25 },
    ]);
    expect(calls.markPoses[1]!.poses).toMatchObject([
      { x: 25, opacity: 0.5 },
      { x: 12.5, opacity: 0.75 },
    ]);
    expect(calls.markPoses[2]).toEqual(calls.markPoses[0]);
    expect(calls.markPoses[3]).toEqual(calls.markPoses[1]);
    // Shader/media paint refreshes can advance their own clock without advancing this lifecycle.
    setChartMarkAnimationFrame(host, 20);
    delete host.dataset.ografChartAnimationFrame;
    renderChartAnimationAtFrame(host, element, 1000);
    expect(calls.markPoses.at(-1)).toEqual({ frame: 1000, poses: calls.markPoses[0]!.poses });
    disposeChart(host);
  });

  it('retains the latest lifecycle sample while an asynchronous provider is mounting', async () => {
    const { calls, snapshot, element, compiled } = markProviderFixture('test.mark-pending', true);
    const { host } = chartHost();
    mountChart(host, element, { rendererPlugins: [snapshot], chartMarkAnimations: compiled });
    renderChartAnimationAtFrame(host, element, 3, 90);
    await vi.waitFor(() => expect(calls.creates).toBe(1));
    calls.resolve!();
    await waitForChartsReady(host);
    expect(calls.markPoses.at(-1)).toMatchObject({
      frame: 3,
      poses: [
        { x: 25, opacity: 0.5 },
        { x: 12.5, opacity: 0.75 },
      ],
    });
    disposeChart(host);
  });

  it('updates and removes compiled mark curves without remounting or retaining stale curves', async () => {
    const { calls, snapshot, element, compiled } = markProviderFixture('test.mark-updates');
    const { host } = chartHost();
    const options = { rendererPlugins: [snapshot], chartMarkAnimations: compiled };
    mountChart(host, element, options);
    await waitForChartsReady(host);
    renderChartAnimationAtFrame(host, element, 0, 20);
    const replacement = structuredClone(compiled);
    replacement.in!.tracks.x![0]!.value = -200;
    expect(
      updateMountedChart(host, element, { ...options, chartMarkAnimations: replacement }),
    ).toBe(true);
    expect(calls.markPoses.at(-1)!.poses[0]).toMatchObject({ x: -100, opacity: 0.5 });
    const without = structuredClone(element);
    delete (without as { markAnimations?: unknown }).markAnimations;
    expect(updateMountedChart(host, without, { rendererPlugins: [snapshot] })).toBe(true);
    expect(calls.markPoses.at(-1)!.poses).toEqual([null, null]);
    renderChartAnimationAtFrame(host, without, 0, 90);
    expect(calls.markPoses.at(-1)!.poses).toEqual([null, null]);
    expect(calls).toMatchObject({ creates: 1, updates: 2, disposes: 0 });
    disposeChart(host);
  });

  it('keeps mark lifecycle sampling independent throughout deterministic data-morph history replay', async () => {
    const { calls, snapshot, element, compiled } = markProviderFixture('test.mark-history');
    const { host } = chartHost();
    mountChart(host, element, { rendererPlugins: [snapshot], chartMarkAnimations: compiled });
    await waitForChartsReady(host);
    const change = (value: number) => ({
      ...element,
      data: {
        ...element.data,
        datasets: [{ ...element.data.datasets[0]!, data: [value, 35, 15, 8] }],
      },
    });
    const history = [
      { frame: 0, element, reset: true, skip: true },
      { frame: 30, element: change(70) },
      { frame: 35, element: change(90) },
    ];
    calls.frames = [];
    calls.markPoses = [];
    expect(renderChartAnimationHistoryAtFrame(host, history, 40, 90)).toBe(true);
    expect(calls.frames).toEqual([
      [31, 42],
      [5, 70],
      [5, 90],
    ]);
    for (const sample of calls.markPoses)
      expect(sample.poses).toMatchObject([
        { x: 25, opacity: 0.5 },
        { x: 12.5, opacity: 0.75 },
      ]);
    const forward = structuredClone(calls.markPoses);
    renderChartAnimationHistoryAtFrame(host, history, 15, 20);
    calls.markPoses = [];
    renderChartAnimationHistoryAtFrame(host, history, 40, 90);
    expect(calls.markPoses).toEqual(forward);
    disposeChart(host);
  });

  it('fails closed for missing compiled mark curves before creating or changing a provider', async () => {
    const { calls, snapshot, element, compiled } = markProviderFixture('test.mark-missing');
    const first = chartHost();
    const createElement = vi.spyOn(first.host.ownerDocument, 'createElement');
    expect(() => mountChart(first.host, element, { rendererPlugins: [snapshot] })).toThrow(
      /compiled curves/,
    );
    expect(createElement).not.toHaveBeenCalled();
    for (const incomplete of [{}, { in: compiled.in! }, { out: compiled.out! }]) {
      expect(() =>
        mountChart(chartHost().host, element, {
          rendererPlugins: [snapshot],
          chartMarkAnimations: incomplete,
        }),
      ).toThrow(/compiled curves/);
    }
    const without = structuredClone(element);
    delete (without as { markAnimations?: unknown }).markAnimations;
    expect(() =>
      mountChart(chartHost().host, without, {
        rendererPlugins: [snapshot],
        chartMarkAnimations: compiled,
      }),
    ).toThrow(/compiled curves/);
    const { host } = chartHost();
    mountChart(host, element, { rendererPlugins: [snapshot], chartMarkAnimations: compiled });
    await waitForChartsReady(host);
    renderChartAnimationAtFrame(host, element, 0, 90);
    expect(() => updateMountedChart(host, element, { rendererPlugins: [snapshot] })).toThrow(
      /compiled curves/,
    );
    for (const incomplete of [{}, { in: compiled.in! }, { out: compiled.out! }]) {
      expect(() =>
        updateMountedChart(host, element, {
          rendererPlugins: [snapshot],
          chartMarkAnimations: incomplete,
        }),
      ).toThrow(/compiled curves/);
    }
    expect(() =>
      updateMountedChart(host, without, {
        rendererPlugins: [snapshot],
        chartMarkAnimations: compiled,
      }),
    ).toThrow(/compiled curves/);
    expect(calls).toMatchObject({ creates: 1, updates: 0, disposes: 0 });
    renderChartAnimationAtFrame(host, element, 0, 90);
    expect(calls.markPoses.at(-1)!.poses[0]).toMatchObject({ x: 25, opacity: 0.5 });
    disposeChart(host);
  });

  it.each([
    [
      'NaN value',
      (compiled: CompiledChartMarkAnimations) => {
        compiled.in!.tracks.x![0]!.value = Number.NaN;
      },
    ],
    [
      'infinite value',
      (compiled: CompiledChartMarkAnimations) => {
        compiled.in!.tracks.x![0]!.value = Number.POSITIVE_INFINITY;
      },
    ],
    [
      'duplicate key frames',
      (compiled: CompiledChartMarkAnimations) => {
        compiled.in!.tracks.x![1]!.frame = 0;
      },
    ],
    [
      'unknown easing',
      (compiled: CompiledChartMarkAnimations) => {
        compiled.in!.tracks.x![0]!.easing = 'untrusted-easing' as never;
      },
    ],
    [
      'negative start',
      (compiled: CompiledChartMarkAnimations) => {
        compiled.in!.startFrame = -1;
      },
    ],
  ] as const)(
    'rejects %s in compiled mark curves before executing the renderer',
    (label, alter) => {
      const { calls, snapshot, element, compiled } = markProviderFixture(
        `test.mark-invalid-${label.toLowerCase().replaceAll(' ', '-')}`,
      );
      alter(compiled);
      const { host } = chartHost();
      expect(() =>
        mountChart(host, element, { rendererPlugins: [snapshot], chartMarkAnimations: compiled }),
      ).toThrow(/invalid compiled/);
      expect(host.appendChild).not.toHaveBeenCalled();
      expect(calls).toMatchObject({ imports: 0, creates: 0, updates: 0 });
    },
  );

  it('requires a provider before creating any chart host or canvas', () => {
    const { host } = chartHost();
    const createElement = vi.spyOn(host.ownerDocument, 'createElement');
    expect(() => mountChart(host, createChartElement())).toThrow(/Choose a chart renderer plugin/);
    expect(createElement).not.toHaveBeenCalled();
    expect(host.appendChild).not.toHaveBeenCalled();
  });
  it('does not silently apply new chart options to a legacy pinned renderer', () => {
    const { snapshot, element } = providerFixture('test.legacy-features');
    const { host } = chartHost();
    expect(() =>
      mountChart(
        host,
        { ...element, presentation: { maxBarThickness: 40 } },
        { rendererPlugins: [snapshot] },
      ),
    ).toThrow('does not support presentation-v1');
    expect(host.appendChild).not.toHaveBeenCalled();
  });

  it('rejects invalid canonical updates without touching the currently on-air provider', async () => {
    const fixture = providerFixture('test.atomic-canonical-update');
    const snapshot = createRendererPluginSnapshot({
      ...fixture.snapshot,
      manifest: {
        ...fixture.snapshot.manifest,
        chartFeatures: ['canonical-data-v1', 'presentation-v1'],
      },
    });
    const element = {
      ...fixture.element,
      provider: {
        id: snapshot.manifest.id,
        version: snapshot.manifest.version,
        sha256: snapshot.sha256,
      },
    };
    const { host } = chartHost();
    mountChart(host, element, { rendererPlugins: [snapshot] });
    await waitForChartsReady(host);
    const invalid = {
      ...element,
      data: {
        ...element.data,
        mode: 'percentages' as const,
        rows: [{ id: 'one', label: 'One', value: 90 }],
      },
    };
    expect(() => updateMountedChart(host, invalid, { rendererPlugins: [snapshot] })).toThrow(
      'missing 10%',
    );
    expect(fixture.calls).toMatchObject({ updates: 0, disposes: 0 });
    renderChartAnimationAtFrame(host, element, 9);
    expect(fixture.calls.frames.at(-1)).toEqual([9, element.data.datasets[0]!.data[0]]);
    disposeChart(host);
  });

  it('replays the same event history after forward/backward seeks, including rapid interruption and skipped Takes', async () => {
    const { calls, snapshot, element } = providerFixture('test.morph-history');
    const { host } = chartHost();
    mountChart(host, element, { rendererPlugins: [snapshot] });
    await waitForChartsReady(host);
    const change = (value: number) => ({
      ...element,
      data: {
        ...element.data,
        datasets: [{ ...element.data.datasets[0]!, data: [value, 35, 15, 8] }],
      },
    });
    const history = [
      { frame: 0, element, reset: true, skip: true },
      { frame: 30, element: change(70) },
      { frame: 35, element: change(90) },
    ];
    calls.frames = [];
    expect(renderChartAnimationHistoryAtFrame(host, history, 40)).toBe(true);
    const forward = [...calls.frames];
    expect(forward).toEqual([
      [31, 42],
      [5, 70],
      [5, 90],
    ]);
    renderChartAnimationHistoryAtFrame(host, history, 15);
    calls.frames = [];
    renderChartAnimationHistoryAtFrame(host, history, 40);
    expect(calls.frames).toEqual(forward);
    expect(calls.resets).toBe(3);
    disposeChart(host);
  });
  it('loads pinned code once, keeps the latest seek/data during loading, and disposes each instance', async () => {
    const { calls, snapshot, element } = providerFixture('test.latest-data');
    const { host } = chartHost();
    mountChart(host, element, { rendererPlugins: [snapshot], frameRate: 10 });
    renderChartAnimationAtFrame(host, element, 7);
    const updated = structuredClone(element);
    updated.data.datasets[0]!.data[0] = 99;
    expect(updateMountedChart(host, updated, { rendererPlugins: [snapshot], frameRate: 10 })).toBe(
      true,
    );
    await waitForChartsReady(host);
    expect(calls).toMatchObject({ imports: 1, creates: 1, frameRate: 10 });
    expect(calls.frames.at(-1)).toEqual([7, 99]);

    const second = chartHost();
    mountChart(second.host, element, { rendererPlugins: [snapshot], frameRate: 10 });
    await waitForChartsReady(second.host);
    expect(calls).toMatchObject({ imports: 1, creates: 2 });
    disposeChart(host);
    disposeChart(second.host);
    expect(calls.disposes).toBe(2);
  });

  it('starts the readiness budget after synchronous host scene construction yields', async () => {
    let now = 0;
    const time = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { calls, snapshot, element } = providerFixture('test.host-scene-construction', true);
    const { host } = chartHost();
    try {
      mountChart(host, element, { rendererPlugins: [snapshot] });
      // Creating the rest of a large scene can block module loading for longer than 2.5 seconds.
      now = 5000;
      await vi.waitFor(() => expect(calls.creates).toBe(1));
      const ready = waitForChartsReady(host);
      now = 5100;
      calls.resolve!();
      await expect(ready).resolves.toBeUndefined();
      expect(calls.frames).toHaveLength(1);
    } finally {
      disposeChart(host);
      time.mockRestore();
    }
  });

  it('shares one cold import across concurrently mounted charts after host work yields', async () => {
    let now = 0;
    const time = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { calls, snapshot, element } = providerFixture('test.concurrent-scene-charts');
    const charts = Array.from({ length: 8 }, () => chartHost());
    try {
      for (const chart of charts) mountChart(chart.host, element, { rendererPlugins: [snapshot] });
      now = 5000;
      await Promise.all(charts.map((chart) => waitForChartsReady(chart.host)));
      expect(calls).toMatchObject({ imports: 1, creates: 8 });
      expect(calls.frames).toHaveLength(8);
    } finally {
      for (const chart of charts) disposeChart(chart.host);
      time.mockRestore();
    }
  });

  it('prepares and seeks a bar and area in the same scene without sharing state', async () => {
    const fixture = providerFixture('test.concurrent-mixed-charts');
    const snapshot = createRendererPluginSnapshot({
      ...fixture.snapshot,
      manifest: { ...fixture.snapshot.manifest, presets: ['bar', 'area'] },
    });
    const bar = {
      ...fixture.element,
      provider: {
        id: snapshot.manifest.id,
        version: snapshot.manifest.version,
        sha256: snapshot.sha256,
      },
    };
    const area = structuredClone({ ...bar, preset: 'area' as const });
    area.data.datasets[0]!.data[0] = 42;
    const barHost = chartHost().host;
    const areaHost = chartHost().host;
    const scene = { querySelectorAll: () => [barHost, areaHost] } as unknown as ParentNode;
    try {
      mountChart(barHost, bar, { rendererPlugins: [snapshot] });
      mountChart(areaHost, area, { rendererPlugins: [snapshot] });
      renderChartAnimationAtFrame(barHost, bar, 4);
      renderChartAnimationAtFrame(areaHost, area, 12);
      await waitForChartsReady(scene);
      expect(fixture.calls).toMatchObject({ imports: 1, creates: 2 });
      expect(fixture.calls.frames).toContainEqual([4, bar.data.datasets[0]!.data[0]]);
      expect(fixture.calls.frames).toContainEqual([12, 42]);
      renderChartAnimationAtFrame(barHost, bar, 8);
      expect(fixture.calls.frames.at(-1)).toEqual([8, bar.data.datasets[0]!.data[0]]);
    } finally {
      disposeChart(barHost);
      disposeChart(areaHost);
    }
  });

  it('does not load a queued provider after disposal or after its trust is revoked', async () => {
    const { calls, snapshot, element } = providerFixture('test.queued-cancel');
    let trusted = true;
    globalThis.__OGRAF_STUDIO_RENDERER_PLUGIN_POLICY__ = () => trusted;
    const disposed = chartHost();
    const revoked = chartHost();
    mountChart(disposed.host, element, { rendererPlugins: [snapshot] });
    const disposedReady = waitForChartsReady(disposed.host);
    disposeChart(disposed.host);
    await expect(disposedReady).resolves.toBeUndefined();
    mountChart(revoked.host, element, { rendererPlugins: [snapshot] });
    const revokedReady = expect(waitForChartsReady(revoked.host)).rejects.toThrow(/not trusted/);
    trusted = false;
    await revokedReady;
    expect(calls).toMatchObject({ imports: 0, creates: 0 });
    disposeChart(revoked.host);
  });

  it('rejects altered bytes, unsupported chart types, and nested module imports before execution', async () => {
    const { calls, snapshot, element } = providerFixture('test.integrity');
    const altered = { ...snapshot, source: snapshot.source + '\n// changed' };
    expect(() => mountChart(chartHost().host, element, { rendererPlugins: [altered] })).toThrow(
      /integrity/,
    );
    expect(() =>
      mountChart(chartHost().host, { ...element, preset: 'pie' }, { rendererPlugins: [snapshot] }),
    ).toThrow(/does not support/);
    const nested = createRendererPluginSnapshot({
      ...snapshot,
      manifest: { ...snapshot.manifest, id: 'test.nested-import' },
      source: 'import "./extra.js"; export default {apiVersion:1,create(){}};',
    });
    const nestedElement = {
      ...element,
      provider: { id: nested.manifest.id, version: nested.manifest.version, sha256: nested.sha256 },
    };
    const { host } = chartHost();
    mountChart(host, nestedElement, { rendererPlugins: [nested] });
    await expect(waitForChartsReady(host)).rejects.toThrow(/self-contained|imports|import/i);
    expect(calls.imports).toBe(0);
    disposeChart(host);
  });

  it('checks trust before cached reuse and revokes a mounted provider when disabled', async () => {
    const { calls, snapshot, element } = providerFixture('test.revoked');
    let trusted = true;
    globalThis.__OGRAF_STUDIO_RENDERER_PLUGIN_POLICY__ = () => trusted;
    const { host } = chartHost();
    mountChart(host, element, { rendererPlugins: [snapshot] });
    await waitForChartsReady(host);
    trusted = false;
    expect(() => renderChartAnimationAtFrame(host, element, 3)).toThrow(/not trusted/);
    await expect(waitForChartsReady(host)).rejects.toThrow(/not trusted/);
    expect(() => mountChart(chartHost().host, element, { rendererPlugins: [snapshot] })).toThrow(
      /not trusted/,
    );
    expect(calls).toMatchObject({ imports: 1, creates: 1, disposes: 1 });
    disposeChart(host);
  });

  it('does not use a mounted snapshot when the current project catalog is missing or altered', async () => {
    const { snapshot, element } = providerFixture('test.current-catalog');
    const { host } = chartHost();
    mountChart(host, element, { rendererPlugins: [snapshot] });
    await waitForChartsReady(host);
    expect(() => updateMountedChart(host, element, { rendererPlugins: [] })).toThrow(
      /missing from this template/,
    );
    expect(() =>
      updateMountedChart(host, element, {
        rendererPlugins: [{ ...snapshot, source: snapshot.source + '// tampered' }],
      }),
    ).toThrow(/integrity/);
    disposeChart(host);
  });

  it('keys the module cache by exact plugin metadata as well as executable bytes', async () => {
    const { calls, snapshot, element } = providerFixture('test.version-cache');
    const nextVersion = createRendererPluginSnapshot({
      ...snapshot,
      manifest: { ...snapshot.manifest, version: '1.0.1' },
    });
    const first = chartHost();
    const second = chartHost();
    mountChart(first.host, element, { rendererPlugins: [snapshot] });
    await waitForChartsReady(first.host);
    mountChart(
      second.host,
      {
        ...element,
        provider: {
          id: nextVersion.manifest.id,
          version: nextVersion.manifest.version,
          sha256: nextVersion.sha256,
        },
      },
      { rendererPlugins: [nextVersion] },
    );
    await waitForChartsReady(second.host);
    expect(calls).toMatchObject({ imports: 2, creates: 2 });
    disposeChart(first.host);
    disposeChart(second.host);
  });

  it('rejects an asynchronous frame renderer and cleans up the failed instance', async () => {
    const { calls, snapshot, element } = providerFixture('test.async-render');
    const asynchronous = createRendererPluginSnapshot({
      ...snapshot,
      source: snapshot.source.replace('renderAtFrame(frame) {', 'async renderAtFrame(frame) {'),
    });
    const { host } = chartHost();
    mountChart(
      host,
      {
        ...element,
        provider: {
          id: asynchronous.manifest.id,
          version: asynchronous.manifest.version,
          sha256: asynchronous.sha256,
        },
      },
      { rendererPlugins: [asynchronous] },
    );
    await expect(waitForChartsReady(host)).rejects.toThrow(/must be synchronous/);
    expect(calls.disposes).toBe(1);
    disposeChart(host);
  });

  it('does not render a provider instance that completes after disposal', async () => {
    const { calls, snapshot, element } = providerFixture('test.disposed-pending', true);
    const { host } = chartHost();
    mountChart(host, element, { rendererPlugins: [snapshot] });
    await vi.waitFor(() => expect(calls.creates).toBe(1));
    const ready = waitForChartsReady(host);
    disposeChart(host);
    await ready;
    calls.resolve!();
    await vi.waitFor(() => expect(calls.disposes).toBe(1));
    expect(calls.frames).toEqual([]);
  });

  it('bounds initialization and disposes an instance that resolves after timeout', async () => {
    const { calls, snapshot, element } = providerFixture('test.timed-out', true);
    const { host } = chartHost();
    mountChart(host, element, { rendererPlugins: [snapshot] });
    await vi.waitFor(() => expect(calls.creates).toBe(1));
    await expect(waitForChartsReady(host)).rejects.toThrow(/2500 ms/);
    calls.resolve!();
    await vi.waitFor(() => expect(calls.disposes).toBe(1));
    expect(calls.frames).toEqual([]);
    disposeChart(host);
  });

  it('enforces the cold-load deadline even when other synchronous work delays the timer callback', async () => {
    let now = 0;
    const time = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { calls, snapshot, element } = providerFixture('test.cold-main-thread-delay', true);
    const { host } = chartHost();
    try {
      mountChart(host, element, { rendererPlugins: [snapshot] });
      await vi.waitFor(() => expect(calls.creates).toBe(1));
      const ready = waitForChartsReady(host);
      now = 2501;
      calls.resolve!();
      await expect(ready).rejects.toThrow('did not become ready within 2500 ms');
      expect(calls.disposes).toBe(1);
      expect(calls.frames).toEqual([]);
    } finally {
      disposeChart(host);
      time.mockRestore();
    }
  });
});
