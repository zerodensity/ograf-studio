import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addEffect,
  createChartElement,
  createRendererPluginSnapshot,
  createLayerOfKind,
  createMediaPaint,
  createShaderPaint,
} from '@ograf-editor/scene-model';

const mocks = vi.hoisted(() => ({
  toCanvas: vi.fn(),
  createRenderer: vi.fn(),
}));
vi.mock('html-to-image', () => ({ toCanvas: mocks.toCanvas }));
vi.mock('./shaderRendering', () => ({ createShaderRenderer: mocks.createRenderer }));

import {
  applyLayerEffectsFilter,
  disposeLayerEffects,
  resumeLayerEffects,
  suspendLayerEffects,
  waitForLayerEffectsReady,
} from './effectCompositing';
import {
  disposeChart,
  mountChart,
  renderChartAnimationAtFrame,
  waitForChartsReady,
} from './chartRendering';
import { applyRevealClip } from './loopRendering';

class Node extends EventTarget {
  style: Record<string, string> = {};
  className = '';
  dataset: Record<string, string> = {};
  children: Node[] = [];
  parentNode: Node | null = null;
  clientWidth = 100;
  clientHeight = 60;
  currentSrc = '';
  src = '';
  ownerDocument!: { createElement: (tag: string) => Node; createElementNS: () => Node };
  get firstElementChild(): Node | null {
    return this.children[0] ?? null;
  }
  override dispatchEvent(event: Event): boolean {
    const result = super.dispatchEvent(event);
    if (event.bubbles) this.parentNode?.dispatchEvent(event);
    return result;
  }
  setAttribute() {}
  getRootNode(): Node {
    return this.parentNode?.getRootNode() ?? this;
  }
  appendChild(node: Node) {
    node.remove();
    this.children.push(node);
    node.parentNode = this;
    return node;
  }
  remove() {
    if (this.parentNode)
      this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
    this.parentNode = null;
  }
  querySelectorAll(selector: string): Node[] {
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
    if (selector === '*') return descendants;
    if (selector === 'img') return descendants.filter((node) => node.dataset.kind === 'img');
    if (selector === 'canvas') return descendants.filter((node) => node.dataset.kind === 'canvas');
    if (selector === 'video') return descendants.filter((node) => node.dataset.kind === 'video');
    return [];
  }
}

class Canvas extends Node {
  width = 0;
  height = 0;
  compositeOperations: string[] = [];
  drawStates: Array<{ input: unknown; opacity: number; operation: string }> = [];
  context = {
    filter: 'none',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    drawImage: vi.fn((...args: unknown[]) => {
      this.drawStates.push({
        input: args[0],
        opacity: this.context.globalAlpha,
        operation: this.context.globalCompositeOperation,
      });
    }),
    clearRect: vi.fn(),
  };
  constructor() {
    super();
    this.dataset.kind = 'canvas';
    let operation = 'source-over';
    Object.defineProperty(this.context, 'globalCompositeOperation', {
      get: () => operation,
      set: (value: string) => {
        operation = value;
        this.compositeOperations.push(value);
      },
    });
  }
  getContext() {
    return this.context;
  }
}

function fixture() {
  const document = {
    createElement: (tag: string) => {
      const node = tag === 'canvas' ? new Canvas() : new Node();
      node.ownerDocument = document;
      return node;
    },
    createElementNS: () => {
      const node = new Node();
      node.ownerDocument = document;
      return node;
    },
  };
  const host = new Node();
  host.ownerDocument = document;
  host.style.width = '100px';
  host.style.height = '60px';
  const content = new Node();
  content.className = 'layer-content-host';
  content.ownerDocument = document;
  host.appendChild(content);
  const base = document.createElement('canvas') as Canvas;
  base.width = 100;
  base.height = 60;
  mocks.toCanvas.mockResolvedValue(base);
  return { host, content, base };
}

function mediaFixture() {
  const fixtureNodes = fixture();
  const media = fixtureNodes.host.ownerDocument.createElement('canvas') as Canvas;
  media.width = 100;
  media.height = 60;
  media.dataset.ografMediaCanvas = 'true';
  fixtureNodes.content.appendChild(media);
  return { ...fixtureNodes, media };
}

function fakeRenderer(ready: () => Promise<void> = async () => {}) {
  return {
    setInput: vi.fn(),
    setEffectBlend: vi.fn(),
    updateParameters: vi.fn(),
    render: vi.fn(),
    ready: vi.fn(ready),
    completeFrame: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
}

beforeEach(() => {
  vi.stubGlobal('HTMLElement', Node);
  mocks.toCanvas.mockReset();
  mocks.createRenderer.mockReset();
  mocks.createRenderer.mockImplementation(() => fakeRenderer());
});
afterEach(() => vi.unstubAllGlobals());

describe('shader effect stacks and the DOM they flatten', () => {
  class FakeMutationObserver {
    static latest: FakeMutationObserver;
    records: unknown[] = [];
    disconnected = false;
    constructor(readonly callback: (records: MutationRecord[]) => void) {
      FakeMutationObserver.latest = this;
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
    takeRecords() {
      return this.records.splice(0);
    }
    deliver(record: object) {
      this.callback([record as MutationRecord]);
    }
  }

  async function mounted() {
    vi.stubGlobal('MutationObserver', FakeMutationObserver);
    const nodes = fixture();
    const layer = createLayerOfKind('rectangle');
    layer.effects.stack = [];
    addEffect(layer, 'shader', { blendMode: 'normal' });
    const host = nodes.host as unknown as HTMLElement;
    applyLayerEffectsFilter(host, layer.effects, 0);
    await waitForLayerEffectsReady(host);
    expect(mocks.toCanvas).toHaveBeenCalledOnce();
    const output = nodes.host.children.find(
      (child) => child.dataset.ografShaderEffectOutput === 'true',
    ) as Canvas;
    const inner = { getAttribute: () => 'after', dataset: {}, style: {} };
    return { ...nodes, layer, host: nodes.host, element: host, output, inner };
  }

  it.each([
    ['a style written by a frame renderer', { type: 'attributes', attributeName: 'style' }],
    ['an SVG attribute', { type: 'attributes', attributeName: 'stroke-width' }],
    ['replaced text', { type: 'characterData' }],
  ])('recaptures a held frame after %s', async (_name, change) => {
    const { element, inner } = await mounted();
    FakeMutationObserver.latest.deliver({ ...change, target: inner, oldValue: 'before' });
    await waitForLayerEffectsReady(element);
    expect(mocks.toCanvas).toHaveBeenCalledTimes(2);
    disposeLayerEffects(element);
  });

  it('recaptures when content is added, but not for its own output or filter', async () => {
    const { element, host, output } = await mounted();
    const observer = FakeMutationObserver.latest;
    const childList = (node: object) => ({
      type: 'childList',
      target: host,
      addedNodes: [node],
      removedNodes: [],
    });
    observer.deliver(childList(output));
    observer.deliver(childList({ dataset: { ografEffectFilter: 'true' } }));
    observer.deliver(childList({ dataset: { ografRuntimeAuxiliary: 'true' } }));
    await waitForLayerEffectsReady(element);
    expect(mocks.toCanvas).toHaveBeenCalledOnce();
    observer.deliver(childList({ dataset: {} }));
    await waitForLayerEffectsReady(element);
    expect(mocks.toCanvas).toHaveBeenCalledTimes(2);
    disposeLayerEffects(element);
  });

  it('does not recapture for what a capture ignores', async () => {
    const { element, host, output, inner } = await mounted();
    const observer = FakeMutationObserver.latest;
    const style = { type: 'attributes', attributeName: 'style', oldValue: 'before' };
    // The composite's position, its own output, bookkeeping, and a write of the same value.
    observer.deliver({ ...style, target: host });
    observer.deliver({ ...style, target: output });
    observer.deliver({ ...style, target: inner, attributeName: 'data-ograf-frame' });
    observer.deliver({ ...style, target: inner, oldValue: 'after' });
    await waitForLayerEffectsReady(element);
    expect(mocks.toCanvas).toHaveBeenCalledOnce();
    disposeLayerEffects(element);
  });

  it('counts a change made just before anyone asks whether the picture is current', async () => {
    const { element, inner } = await mounted();
    FakeMutationObserver.latest.records.push({
      type: 'attributes',
      attributeName: 'style',
      target: inner,
      oldValue: 'before',
    });
    await waitForLayerEffectsReady(element);
    expect(mocks.toCanvas).toHaveBeenCalledTimes(2);
    disposeLayerEffects(element);
  });

  it('keeps the current picture up during a recapture', async () => {
    const { element, output, inner } = await mounted();
    expect(output.style.display).toBe('block');
    let duringCapture: string | undefined;
    const base = await mocks.toCanvas.mock.results[0]!.value;
    mocks.toCanvas.mockImplementation(async () => {
      duringCapture = output.style.display;
      return base;
    });
    FakeMutationObserver.latest.deliver({
      type: 'attributes',
      attributeName: 'style',
      target: inner,
      oldValue: 'before',
    });
    await waitForLayerEffectsReady(element);
    expect(duringCapture).toBe('block');
    disposeLayerEffects(element);
  });

  it('captures an opacity someone else sets on hidden content, and hides it again', async () => {
    const { element, content } = await mounted();
    expect(content.style.opacity).toBe('0');
    const base = await mocks.toCanvas.mock.results[0]!.value;
    let duringCapture: string | undefined;
    mocks.toCanvas.mockImplementation(async () => {
      duringCapture = content.style.opacity;
      return base;
    });
    content.style.opacity = '0.25';
    FakeMutationObserver.latest.deliver({
      type: 'attributes',
      attributeName: 'style',
      target: content,
      oldValue: 'opacity: 0',
    });
    await waitForLayerEffectsReady(element);
    expect(duringCapture).toBe('0.25');
    expect(content.style.opacity).toBe('0');
    disposeLayerEffects(element);
    expect(content.style.opacity).toBe('0.25');
  });

  it('hides content again without a recapture when the same opacity is written back', async () => {
    const { element, content } = await mounted();
    content.style.opacity = '';
    // What is left once it has been hidden again is what was there before.
    Object.assign(content, { getAttribute: () => 'opacity: 0' });
    FakeMutationObserver.latest.deliver({
      type: 'attributes',
      attributeName: 'style',
      target: content,
      oldValue: 'opacity: 0',
    });
    expect(content.style.opacity).toBe('0');
    await waitForLayerEffectsReady(element);
    expect(mocks.toCanvas).toHaveBeenCalledOnce();
    disposeLayerEffects(element);
  });

  it('stops observing when disposed', async () => {
    const { element } = await mounted();
    const observer = FakeMutationObserver.latest;
    disposeLayerEffects(element);
    expect(observer.disconnected).toBe(true);
  });

  it('settles readiness while live input keeps invalidating the output', async () => {
    const { element, layer } = await mounted();
    const renderer = mocks.createRenderer.mock.results[0]!.value;
    let elapsed = 0;
    renderer.completeFrame.mockReset();
    renderer.completeFrame.mockImplementation(async () => {
      elapsed += 16;
      applyLayerEffectsFilter(element, layer.effects, elapsed);
    });
    await waitForLayerEffectsReady(element);
    expect(renderer.completeFrame).toHaveBeenCalledTimes(8);
    disposeLayerEffects(element);
  });
});

describe('shader effect stacks under a suspended presentation', () => {
  function mountedStack() {
    const { host, content } = fixture();
    const root = new Node();
    root.appendChild(host);
    const layer = createLayerOfKind('rectangle');
    layer.effects.stack = [];
    addEffect(layer, 'shader', { blendMode: 'screen' });
    const output = () =>
      host.children.find((child) => child.dataset.ografShaderEffectOutput === 'true') as Canvas;
    const apply = (elapsedMs: number) =>
      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, elapsedMs);
    const parent = root as unknown as ParentNode & globalThis.Node;
    return { host, content, parent, output, apply };
  }

  it('commits nothing while suspended, yet readiness resolves and resume commits the newest state', async () => {
    const { host, parent, output, apply } = mountedStack();
    apply(0);
    await waitForLayerEffectsReady(parent);
    const renderer = mocks.createRenderer.mock.results[0]!.value;
    const commits = output().context.clearRect.mock.calls.length;
    expect(commits).toBeGreaterThan(0);

    suspendLayerEffects(parent);
    apply(100);
    apply(200);
    await waitForLayerEffectsReady(parent);
    expect(output().context.clearRect).toHaveBeenCalledTimes(commits);
    expect(renderer.render).not.toHaveBeenCalledWith(200);

    const refresh = resumeLayerEffects(parent, false);
    expect(refresh).not.toBeNull();
    await refresh!();
    expect(renderer.render).toHaveBeenLastCalledWith(200);
    expect(output().context.clearRect).toHaveBeenCalledTimes(commits + 1);
    disposeLayerEffects(host as unknown as HTMLElement);
  });

  it('leaves an unchanged stack alone unless per-frame drawing was parked', async () => {
    const { host, parent, output, apply } = mountedStack();
    apply(0);
    await waitForLayerEffectsReady(parent);
    const commits = output().context.clearRect.mock.calls.length;

    suspendLayerEffects(parent);
    expect(resumeLayerEffects(parent, false)).toBeNull();
    suspendLayerEffects(parent);
    const refresh = resumeLayerEffects(parent, true);
    expect(refresh).not.toBeNull();
    await refresh!();
    expect(output().context.clearRect).toHaveBeenCalledTimes(commits + 1);
    disposeLayerEffects(host as unknown as HTMLElement);
  });

  it('captures a live canvas again on refresh, because a capture at this same time can be older', async () => {
    const { host, content, parent, apply } = mountedStack();
    const live = host.ownerDocument.createElement('canvas') as Canvas;
    content.appendChild(live);
    apply(500);
    await waitForLayerEffectsReady(parent);
    const captures = mocks.toCanvas.mock.calls.length;
    apply(500);
    await waitForLayerEffectsReady(parent);
    expect(mocks.toCanvas).toHaveBeenCalledTimes(captures);

    suspendLayerEffects(parent);
    await resumeLayerEffects(parent, true)!();
    expect(mocks.toCanvas).toHaveBeenCalledTimes(captures + 1);
    disposeLayerEffects(host as unknown as HTMLElement);
  });

  it('keeps the cached capture of static content on refresh', async () => {
    const { host, parent, apply } = mountedStack();
    apply(500);
    await waitForLayerEffectsReady(parent);
    const captures = mocks.toCanvas.mock.calls.length;

    suspendLayerEffects(parent);
    await resumeLayerEffects(parent, true)!();
    expect(mocks.toCanvas).toHaveBeenCalledTimes(captures);
    disposeLayerEffects(host as unknown as HTMLElement);
  });

  it('has nothing to refresh when the root holds no stack', () => {
    const root = new Node() as unknown as ParentNode & globalThis.Node;
    suspendLayerEffects(root);
    expect(resumeLayerEffects(root, true)).toBeNull();
  });

  it('waits for a capture already running when the refresh starts', async () => {
    const { host, parent, output, apply } = mountedStack();
    apply(0);
    await waitForLayerEffectsReady(parent);
    const commits = output().context.clearRect.mock.calls.length;
    const renderer = mocks.createRenderer.mock.results[0]!.value;
    let finishFrame!: () => void;
    renderer.ready.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishFrame = resolve;
      }),
    );

    suspendLayerEffects(parent);
    const refresh = resumeLayerEffects(parent, true)!;
    // The first resumed frame's own update, as the parked content loop submits it.
    apply(300);
    let revealed = false;
    const finished = refresh().then(() => {
      revealed = true;
    });
    await vi.waitFor(() => expect(renderer.render).toHaveBeenCalledWith(300));
    expect(revealed).toBe(false);
    expect(output().context.clearRect).toHaveBeenCalledTimes(commits);
    finishFrame();
    await finished;
    expect(output().context.clearRect.mock.calls.length).toBeGreaterThan(commits);
    disposeLayerEffects(host as unknown as HTMLElement);
  });
});

describe('shader effect compositing', () => {
  it('keeps realtime effects fence-free and completes their GPU work only at explicit readiness', async () => {
    const { host } = fixture();
    const layer = createLayerOfKind('rectangle');
    layer.effects.stack = [];
    addEffect(layer, 'shader', { blendMode: 'screen' });
    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
    await vi.waitFor(() => expect(mocks.createRenderer).toHaveBeenCalledOnce());
    const renderer = mocks.createRenderer.mock.results[0]!.value;
    expect(renderer.render).toHaveBeenCalled();
    expect(renderer.completeFrame).not.toHaveBeenCalled();
    let resolveGpu!: () => void;
    renderer.completeFrame.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveGpu = resolve;
      }),
    );
    let settled = false;
    const readiness = waitForLayerEffectsReady(host as unknown as HTMLElement).then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(renderer.completeFrame).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    resolveGpu();
    await readiness;
    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 600);
    await vi.waitFor(() => expect(renderer.render).toHaveBeenLastCalledWith(600));
    expect(renderer.completeFrame).toHaveBeenCalledOnce();
    await waitForLayerEffectsReady(host as unknown as HTMLElement);
    expect(renderer.completeFrame).toHaveBeenCalledTimes(2);
    disposeLayerEffects(host as unknown as HTMLElement);
  });

  it('rejects explicit effect readiness when the GPU completion fails', async () => {
    const { host } = fixture();
    const layer = createLayerOfKind('rectangle');
    layer.effects.stack = [];
    addEffect(layer, 'shader', { blendMode: 'screen' });
    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
    await vi.waitFor(() => expect(mocks.createRenderer).toHaveBeenCalledOnce());
    const renderer = mocks.createRenderer.mock.results[0]!.value;
    renderer.completeFrame.mockRejectedValue(new Error('Shader GPU completion wait failed.'));
    await expect(waitForLayerEffectsReady(host as unknown as HTMLElement)).rejects.toThrow(
      'GPU completion wait failed',
    );
    disposeLayerEffects(host as unknown as HTMLElement);
  });

  it('awaits a newer effect request arriving during explicit GPU completion', async () => {
    const { host } = fixture();
    const layer = createLayerOfKind('rectangle');
    layer.effects.stack = [];
    addEffect(layer, 'shader', { blendMode: 'screen' });
    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
    await vi.waitFor(() => expect(mocks.createRenderer).toHaveBeenCalledOnce());
    const renderer = mocks.createRenderer.mock.results[0]!.value;
    let finishFirst!: () => void;
    let finishLatest!: () => void;
    renderer.completeFrame
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishLatest = resolve;
        }),
      );
    let settled = false;
    const readiness = waitForLayerEffectsReady(host as unknown as HTMLElement).then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(renderer.completeFrame).toHaveBeenCalledOnce());
    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 900);
    finishFirst();
    await vi.waitFor(() => expect(renderer.completeFrame).toHaveBeenCalledTimes(2));
    expect(renderer.render).toHaveBeenLastCalledWith(900);
    expect(settled).toBe(false);
    finishLatest();
    await readiness;
    disposeLayerEffects(host as unknown as HTMLElement);
  });

  it('bounds the total completion wait while newer effect frames keep arriving', async () => {
    const { host } = fixture();
    const layer = createLayerOfKind('rectangle');
    layer.effects.stack = [];
    addEffect(layer, 'shader', { blendMode: 'screen' });
    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
    await vi.waitFor(() => expect(mocks.createRenderer).toHaveBeenCalledOnce());
    const renderer = mocks.createRenderer.mock.results[0]!.value;
    let finishFirst!: () => void;
    let finishLatest!: () => void;
    renderer.completeFrame
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishLatest = resolve;
        }),
      );
    vi.useFakeTimers();
    try {
      const readiness = expect(
        waitForLayerEffectsReady(host as unknown as HTMLElement),
      ).rejects.toThrow('30000 ms');
      await vi.advanceTimersByTimeAsync(20_000);
      expect(renderer.completeFrame).toHaveBeenCalledOnce();
      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 900);
      finishFirst();
      await vi.advanceTimersByTimeAsync(0);
      expect(renderer.completeFrame).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(10_001);
      await readiness;
      finishLatest();
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      disposeLayerEffects(host as unknown as HTMLElement);
      vi.useRealTimers();
    }
  });

  it.each([1, 0.5])(
    'composites a transparent generated shader over the incoming image at Normal opacity %s',
    async (blendOpacity) => {
      const { host, content } = fixture();
      const layer = createLayerOfKind('image');
      layer.effects.stack = [];
      addEffect(layer, 'shader', {
        blendMode: 'normal',
        blendOpacity,
        shader: createShaderPaint({
          fragmentSource:
            'void mainImage(out vec4 color, in vec2 fragCoord) { color = vec4(1.0, 0.5, 0.0, 0.25); }',
        }),
      });

      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);

      const renderer = mocks.createRenderer.mock.results[0]!.value;
      const input = renderer.setInput.mock.calls[0]![0] as Canvas;
      const shaderOutput = mocks.createRenderer.mock.calls[0]![0] as Canvas;
      const output = host.children.find(
        (node) => node.dataset.ografShaderEffectOutput === 'true',
      ) as Canvas;
      const blended = output.context.drawImage.mock.calls[0]![0] as Canvas;
      expect(blended.drawStates).toEqual([
        { input, opacity: 1, operation: 'source-over' },
        { input: shaderOutput, opacity: blendOpacity, operation: 'source-atop' },
      ]);
      // source-atop preserves the incoming coverage, including partially transparent edges.
      // Applying destination-in again would multiply that alpha a second time.
      expect(blended.compositeOperations).not.toContain('destination-in');
      expect(blended.context.globalCompositeOperation).toBe('source-over');
      expect(blended.context.globalAlpha).toBe(1);
      expect(content.style.opacity).toBe('0');
      expect(output.style.mixBlendMode).toBe('normal');
      expect(output.style.opacity).toBe('1');
      disposeLayerEffects(host as unknown as HTMLElement);
    },
  );

  it('keeps the incoming image when a generated Normal shader is fully transparent', async () => {
    const { host } = fixture();
    const layer = createLayerOfKind('image');
    layer.effects.stack = [];
    addEffect(layer, 'shader', {
      blendMode: 'normal',
      shader: createShaderPaint({
        fragmentSource: 'void mainImage(out vec4 color, in vec2 fragCoord) { color = vec4(0.0); }',
      }),
    });

    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
    await waitForLayerEffectsReady(host as unknown as HTMLElement);

    const renderer = mocks.createRenderer.mock.results[0]!.value;
    const input = renderer.setInput.mock.calls[0]![0] as Canvas;
    const shaderOutput = mocks.createRenderer.mock.calls[0]![0] as Canvas;
    const output = host.children.find(
      (node) => node.dataset.ografShaderEffectOutput === 'true',
    ) as Canvas;
    const blended = output.context.drawImage.mock.calls[0]![0] as Canvas;
    expect(blended.drawStates).toEqual([
      { input, opacity: 1, operation: 'source-over' },
      { input: shaderOutput, opacity: 1, operation: 'source-atop' },
    ]);
    expect(blended.compositeOperations).not.toContain('destination-in');
    disposeLayerEffects(host as unknown as HTMLElement);
  });

  it('ignores input-channel identifiers in comments when identifying generated overlays', async () => {
    const { host } = fixture();
    const layer = createLayerOfKind('image');
    layer.effects.stack = [];
    addEffect(layer, 'shader', {
      blendMode: 'normal',
      shader: createShaderPaint({
        fragmentSource: `// No iChannel0 input is required for this overlay.
          /* iChannelResolution is not sampled either. */
          void mainImage(out vec4 color, in vec2 fragCoord) { color = vec4(0.7, 0.2, 0.0, 0.4); }`,
      }),
    });

    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
    await waitForLayerEffectsReady(host as unknown as HTMLElement);

    const input = mocks.createRenderer.mock.results[0]!.value.setInput.mock.calls[0]![0] as Canvas;
    const output = host.children.find(
      (node) => node.dataset.ografShaderEffectOutput === 'true',
    ) as Canvas;
    const blended = output.context.drawImage.mock.calls[0]![0] as Canvas;
    expect(blended.drawStates[0]).toEqual({ input, opacity: 1, operation: 'source-over' });
    expect(blended.drawStates[1]!.operation).toBe('source-atop');
    expect(blended.compositeOperations).not.toContain('destination-in');
    disposeLayerEffects(host as unknown as HTMLElement);
  });

  it.each([
    {
      name: 'iChannel0',
      fragmentSource:
        'void mainImage(out vec4 color, in vec2 fragCoord) { color = texture(iChannel0, fragCoord / iResolution.xy); color.a = 0.0; }',
    },
    {
      name: 'iChannelResolution',
      fragmentSource:
        'void mainImage(out vec4 color, in vec2 fragCoord) { color = vec4(fragCoord / iChannelResolution[0].xy, 0.0, 0.0); }',
    },
  ])(
    'keeps Normal post-process replacement for a shader using $name',
    async ({ fragmentSource }) => {
      const { host } = fixture();
      const layer = createLayerOfKind('image');
      layer.effects.stack = [];
      addEffect(layer, 'shader', {
        blendMode: 'normal',
        shader: createShaderPaint({ fragmentSource }),
      });

      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);

      const input = mocks.createRenderer.mock.results[0]!.value.setInput.mock
        .calls[0]![0] as Canvas;
      const shaderOutput = mocks.createRenderer.mock.calls[0]![0] as Canvas;
      const output = host.children.find(
        (node) => node.dataset.ografShaderEffectOutput === 'true',
      ) as Canvas;
      const blended = output.context.drawImage.mock.calls[0]![0] as Canvas;
      expect(blended.drawStates).toEqual([
        { input: shaderOutput, opacity: 1, operation: 'source-over' },
        { input, opacity: 1, operation: 'destination-in' },
      ]);
      expect(blended.compositeOperations).not.toContain('source-atop');
      expect(blended.context.globalCompositeOperation).toBe('source-over');
      disposeLayerEffects(host as unknown as HTMLElement);
    },
  );

  it('gives a shader a padded copy of the Media canvas instead of flattening the DOM', async () => {
    const { host, media } = mediaFixture();
    const layer = createLayerOfKind('rectangle');
    layer.effects.stack = [];
    addEffect(layer, 'shader', { blendMode: 'normal' });

    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
    await waitForLayerEffectsReady(host as unknown as HTMLElement);

    expect(mocks.toCanvas).not.toHaveBeenCalled();
    const input = mocks.createRenderer.mock.results[0]!.value.setInput.mock.calls[0]![0] as Canvas;
    expect(input).toBeInstanceOf(Canvas);
    expect([input.width, input.height]).toEqual([102, 62]);
    expect(input.context.drawImage).toHaveBeenCalledWith(media, 1, 1, 100, 60);
    disposeLayerEffects(host as unknown as HTMLElement);
  });

  it.each(['normal', 'screen'] as const)(
    'feeds a %s Canvas 2D filter on the Media copy into the next shader',
    async (blendMode) => {
      const { host, media } = mediaFixture();
      const layer = createLayerOfKind('rectangle');
      layer.effects.stack = [];
      addEffect(layer, 'brightness', {
        blendMode,
        blendOpacity: blendMode === 'normal' ? 1 : 0.6,
        params: { amount: 1.2 },
      });
      addEffect(layer, 'shader', { blendMode: 'normal' });

      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);

      const shaderInput = mocks.createRenderer.mock.results[0]!.value.setInput.mock
        .calls[0]![0] as Canvas;
      const filtered =
        blendMode === 'normal'
          ? shaderInput
          : (shaderInput.context.drawImage.mock.calls[1]![0] as Canvas);
      expect(filtered.context.filter).toBe('brightness(1.2)');
      const capture = filtered.context.drawImage.mock.calls[0]![0] as Canvas;
      expect(capture.context.drawImage).toHaveBeenCalledWith(media, 1, 1, 100, 60);
      if (blendMode !== 'normal') expect(shaderInput.drawStates[0]!.input).toBe(capture);
      disposeLayerEffects(host as unknown as HTMLElement);
    },
  );

  it('chains the Media copy into the first shader and its result into the next', async () => {
    const { host, media } = mediaFixture();
    const layer = createLayerOfKind('rectangle');
    layer.effects.stack = [];
    addEffect(layer, 'shader', { blendMode: 'normal' });
    addEffect(layer, 'shader', { blendMode: 'screen', blendOpacity: 0.6 });

    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
    await waitForLayerEffectsReady(host as unknown as HTMLElement);

    expect(mocks.createRenderer).toHaveBeenCalledTimes(2);
    const firstOutput = mocks.createRenderer.mock.calls[0]![0] as Canvas;
    const capture = mocks.createRenderer.mock.results[0]!.value.setInput.mock
      .calls[0]![0] as Canvas;
    expect(capture.context.drawImage).toHaveBeenCalledWith(media, 1, 1, 100, 60);
    const secondInput = mocks.createRenderer.mock.results[1]!.value.setInput.mock
      .calls[0]![0] as Canvas;
    expect(secondInput).not.toBe(capture);
    expect(secondInput.drawStates).toEqual([
      { input: firstOutput, opacity: 1, operation: 'source-over' },
      { input: capture, opacity: 1, operation: 'destination-in' },
    ]);
    disposeLayerEffects(host as unknown as HTMLElement);
  });

  describe('on a Media fill', () => {
    const generativeSource =
      'void mainImage(out vec4 color, in vec2 fragCoord) { color = vec4(1.0, 0.5, 0.0, 0.25); }';
    // The essence of 20-signal-glitch: zoom below 1 samples outside the input and leaves margins.
    const zoomedSource = `const float zoom = 0.8;
      void mainImage(out vec4 color, in vec2 fragCoord) {
        vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
        vec2 uv = coord / iResolution.xy;
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        color = texture(iChannel0, uv) * inside;
      }`;

    /** The first shader's input: the Media canvas copied into a padded canvas. */
    function capturedInput() {
      return mocks.createRenderer.mock.results[0]!.value.setInput.mock.calls[0]![0] as Canvas;
    }

    function mediaLayer(
      ...shaders: Array<{ source?: string; blendMode?: 'normal' | 'screen'; blendOpacity?: number }>
    ) {
      const layer = createLayerOfKind('rectangle');
      layer.effects.stack = [];
      for (const { source, blendMode = 'normal', blendOpacity = 1 } of shaders)
        addEffect(layer, 'shader', {
          blendMode,
          blendOpacity,
          ...(source ? { shader: createShaderPaint({ fragmentSource: source }) } : {}),
        });
      return layer;
    }

    function effectOutput(host: Node) {
      return host.children.find(
        (node) => node.dataset.ografShaderEffectOutput === 'true',
      ) as Canvas;
    }

    it('replaces the picture with a zoomed input-reading shader instead of doubling it', async () => {
      const { host, content, media } = mediaFixture();
      const layer = mediaLayer({ source: zoomedSource });

      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);

      const input = capturedInput();
      const shaderOutput = mocks.createRenderer.mock.calls[0]![0] as Canvas;
      const output = effectOutput(host);
      const blended = output.context.drawImage.mock.calls[0]![0] as Canvas;
      // Nothing paints the clean input into the transparent margins: it only masks coverage.
      expect(blended.drawStates).toEqual([
        { input: shaderOutput, opacity: 1, operation: 'source-over' },
        { input, opacity: 1, operation: 'destination-in' },
      ]);
      expect(media.style.opacity).toBe('0');
      // The Media canvas alone is replaced. Base content such as a stroke is not in the input.
      expect(content.style.opacity ?? '').toBe('');
      expect(output.style.mixBlendMode).toBe('normal');
      expect(output.style.opacity).toBe('1');
      disposeLayerEffects(host as unknown as HTMLElement);
      expect(media.style.opacity).toBe('');
    });

    it('bakes the input backdrop into a blended input-reading shader instead of using CSS', async () => {
      const { host, media } = mediaFixture();
      const layer = mediaLayer({ source: zoomedSource, blendMode: 'screen', blendOpacity: 0.6 });

      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);

      const input = capturedInput();
      const shaderOutput = mocks.createRenderer.mock.calls[0]![0] as Canvas;
      const output = effectOutput(host);
      const blended = output.context.drawImage.mock.calls[0]![0] as Canvas;
      expect(blended.drawStates).toEqual([
        { input, opacity: 1, operation: 'source-over' },
        { input: shaderOutput, opacity: 0.6, operation: 'screen' },
        { input, opacity: 1, operation: 'destination-in' },
      ]);
      expect(media.style.opacity).toBe('0');
      expect(output.style.mixBlendMode).toBe('normal');
      expect(output.style.opacity).toBe('1');
      disposeLayerEffects(host as unknown as HTMLElement);
    });

    it('keeps a lone generative shader as a live overlay over the visible picture', async () => {
      const { host, media } = mediaFixture();
      const layer = mediaLayer({ source: generativeSource });

      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);

      const output = effectOutput(host);
      expect(output.context.drawImage.mock.calls[0]![0]).toBe(
        mocks.createRenderer.mock.calls[0]![0],
      );
      expect(media.style.opacity ?? '').toBe('');
      disposeLayerEffects(host as unknown as HTMLElement);
    });

    it.each([
      {
        name: 'a generative shader after one reading its input',
        shaders: [{ source: zoomedSource }, { source: generativeSource }],
      },
      {
        name: 'an input-reading shader after a generative one',
        shaders: [{ source: generativeSource }, { source: zoomedSource }],
      },
      {
        name: 'two generative shaders',
        shaders: [{ source: generativeSource }, { source: generativeSource }],
      },
    ])('composites $name in full rather than overlaying the last', async ({ shaders }) => {
      const { host, media } = mediaFixture();
      const layer = mediaLayer(...shaders);

      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);

      const firstOutput = mocks.createRenderer.mock.calls[0]![0] as Canvas;
      const secondInput = mocks.createRenderer.mock.results[1]!.value.setInput.mock
        .calls[0]![0] as Canvas;
      expect(secondInput.drawStates.map((draw) => draw.input)).toContain(firstOutput);
      expect(media.style.opacity).toBe('0');
      expect(effectOutput(host).style.mixBlendMode).toBe('normal');
      disposeLayerEffects(host as unknown as HTMLElement);
    });

    it('keeps a preceding filter in the chain under a generative shader', async () => {
      const { host, media } = mediaFixture();
      const layer = mediaLayer();
      addEffect(layer, 'brightness', { enabled: true, params: { amount: 1.2 } });
      addEffect(layer, 'shader', {
        blendMode: 'normal',
        shader: createShaderPaint({ fragmentSource: generativeSource }),
      });

      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);

      const filtered = mocks.createRenderer.mock.results[0]!.value.setInput.mock
        .calls[0]![0] as Canvas;
      const blended = effectOutput(host).context.drawImage.mock.calls[0]![0] as Canvas;
      expect(blended.drawStates[0]!.input).toBe(filtered);
      expect(blended.drawStates[1]!.operation).toBe('source-atop');
      expect(media.style.opacity).toBe('0');
      disposeLayerEffects(host as unknown as HTMLElement);
    });

    it('keeps live video visible until the first frame commits, then never flashes it', async () => {
      const { host, media } = mediaFixture();
      const resolvers: Array<() => void> = [];
      mocks.createRenderer.mockImplementationOnce(() =>
        fakeRenderer(() => new Promise<void>((resolve) => resolvers.push(resolve))),
      );
      const layer = mediaLayer({ source: zoomedSource });

      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
      await vi.waitFor(() => expect(resolvers).toHaveLength(1));
      const output = effectOutput(host);
      expect(media.style.opacity ?? '').toBe('');
      expect(output.context.drawImage).not.toHaveBeenCalled();

      resolvers[0]!();
      await waitForLayerEffectsReady(host as unknown as HTMLElement);
      expect(media.style.opacity).toBe('0');
      expect(output.context.drawImage).toHaveBeenCalledOnce();

      // A later frame must not reveal the clean picture or take the last frame down.
      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 40);
      await vi.waitFor(() => expect(resolvers).toHaveLength(2));
      expect(media.style.opacity).toBe('0');
      expect(output.style.display).not.toBe('none');
      expect(output.context.clearRect).toHaveBeenCalledOnce();

      resolvers[1]!();
      await waitForLayerEffectsReady(host as unknown as HTMLElement);
      expect(output.context.drawImage).toHaveBeenCalledTimes(2);
      disposeLayerEffects(host as unknown as HTMLElement);
    });

    it('falls back to the live picture when a frame fails and recovers on the next one', async () => {
      const { host, media } = mediaFixture();
      const ready = vi.fn(async () => {});
      mocks.createRenderer.mockImplementationOnce(() => fakeRenderer(ready));
      const layer = mediaLayer({ source: zoomedSource });
      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);
      expect(media.style.opacity).toBe('0');

      ready.mockRejectedValueOnce(new Error('Frame failed.'));
      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 40);
      await expect(waitForLayerEffectsReady(host as unknown as HTMLElement)).rejects.toThrow(
        'Frame failed.',
      );
      const output = effectOutput(host);
      expect(media.style.opacity).toBe('');
      expect(output.style.display).toBe('none');

      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 80);
      await vi.waitFor(() => expect(host.dataset.ografEffectError).toBeUndefined());
      expect(media.style.opacity).toBe('0');
      expect(output.style.display).toBe('block');
      disposeLayerEffects(host as unknown as HTMLElement);
    });

    it('refreshes a held clock only when the Media canvas holds a new picture', async () => {
      const { host, media } = mediaFixture();
      const layer = mediaLayer({ source: zoomedSource });
      media.dataset.ografMediaFrame = '1';

      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);
      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);
      const copies = () =>
        capturedInput().context.drawImage.mock.calls.filter(([input]) => input === media).length;
      expect(copies()).toBe(1);

      media.dataset.ografMediaFrame = '2';
      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);
      expect(copies()).toBe(2);
      disposeLayerEffects(host as unknown as HTMLElement);
    });

    it('hides a remounted Media canvas as soon as the next frame is requested', async () => {
      const { host, content, media } = mediaFixture();
      const layer = mediaLayer({ source: zoomedSource });
      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);

      media.remove();
      const remounted = host.ownerDocument.createElement('canvas') as Canvas;
      remounted.width = 100;
      remounted.height = 60;
      remounted.dataset.ografMediaCanvas = 'true';
      content.appendChild(remounted);
      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 40);
      expect(remounted.style.opacity).toBe('0');

      await waitForLayerEffectsReady(host as unknown as HTMLElement);
      disposeLayerEffects(host as unknown as HTMLElement);
      expect(remounted.style.opacity ?? '').toBe('');
    });

    it('commits the captured picture when every shader is at zero opacity', async () => {
      const { host, media } = mediaFixture();
      const layer = mediaLayer({ source: zoomedSource, blendOpacity: 0 });

      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);

      expect(mocks.createRenderer).not.toHaveBeenCalled();
      const output = effectOutput(host);
      const capture = output.context.drawImage.mock.calls[0]![0] as Canvas;
      expect(output.context.drawImage).toHaveBeenCalledWith(capture, 0, 0);
      expect(capture.context.drawImage).toHaveBeenCalledWith(media, 1, 1, 100, 60);
      expect(media.style.opacity).toBe('0');
      disposeLayerEffects(host as unknown as HTMLElement);
    });

    it.each(['clip', 'live'] as const)(
      'copies the Media canvas of a %s source without paying for a bitmap on every frame',
      async (kind) => {
        const { host, content, media } = mediaFixture();
        const video = host.ownerDocument.createElement('video');
        if (kind === 'clip') {
          video.dataset.kind = 'video';
          video.dataset.ografMediaClip = 'true';
          content.appendChild(video);
        }
        const createBitmap = vi.fn();
        vi.stubGlobal('createImageBitmap', createBitmap);
        const layer = mediaLayer({ source: zoomedSource });

        applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
        await waitForLayerEffectsReady(host as unknown as HTMLElement);

        expect(createBitmap).not.toHaveBeenCalled();
        expect(mocks.toCanvas).not.toHaveBeenCalled();
        const input = capturedInput();
        expect(input.context.drawImage).toHaveBeenCalledWith(media, 1, 1, 100, 60);
        // It reads the canvas, which holds the shape and crop, never the raw video.
        expect(input.drawStates.some((state) => state.input === video)).toBe(false);
        disposeLayerEffects(host as unknown as HTMLElement);
      },
    );

    it('fits a Media backing larger than the layer into the capture', async () => {
      const { host, media } = mediaFixture();
      Object.assign(media, { width: 200, height: 120 });
      const layer = mediaLayer({ source: zoomedSource });

      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);

      const input = capturedInput();
      expect([input.width, input.height]).toEqual([102, 62]);
      expect(input.context.drawImage).toHaveBeenCalledWith(media, 1, 1, 100, 60);
      disposeLayerEffects(host as unknown as HTMLElement);
    });

    describe('between frames at the same size', () => {
      const sourceLayers = {
        'a post-process': { source: zoomedSource },
        'a blended post-process': {
          source: zoomedSource,
          blendMode: 'screen',
          blendOpacity: 0.6,
        },
      } as const;

      it.each(Object.keys(sourceLayers) as Array<keyof typeof sourceLayers>)(
        'redraws the capture and result canvases of %s after clearing them',
        async (name) => {
          const { host, media } = mediaFixture();
          const layer = mediaLayer(sourceLayers[name]);
          const createElement = vi.spyOn(host.ownerDocument, 'createElement');
          media.dataset.ografMediaFrame = '1';

          applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
          await waitForLayerEffectsReady(host as unknown as HTMLElement);
          const capture = capturedInput();
          const output = effectOutput(host);
          const blended = output.context.drawImage.mock.calls[0]![0] as Canvas;
          const allocated = createElement.mock.calls.length;

          media.dataset.ografMediaFrame = '2';
          applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
          await waitForLayerEffectsReady(host as unknown as HTMLElement);

          expect(createElement).toHaveBeenCalledTimes(allocated);
          expect(mocks.createRenderer).toHaveBeenCalledOnce();
          const renderer = mocks.createRenderer.mock.results[0]!.value;
          expect(renderer.setInput.mock.calls[1]![0]).toBe(capture);
          expect(output.context.drawImage.mock.calls[1]![0]).toBe(blended);
          // Without this a transparent margin or corner would keep the previous picture.
          for (const canvas of [capture, blended]) {
            const { clearRect, drawImage } = canvas.context;
            expect(clearRect).toHaveBeenCalledTimes(2);
            expect(clearRect).toHaveBeenLastCalledWith(0, 0, 102, 62);
            // Half the draws belong to the second frame, and all of those follow its clear.
            const secondClear = clearRect.mock.invocationCallOrder[1]!;
            const drawsBeforeIt = drawImage.mock.invocationCallOrder.filter(
              (order) => order < secondClear,
            );
            expect(drawsBeforeIt).toHaveLength(drawImage.mock.calls.length / 2);
          }
          expect(blended.context.globalAlpha).toBe(1);
          expect(blended.context.globalCompositeOperation).toBe('source-over');
          disposeLayerEffects(host as unknown as HTMLElement);
        },
      );

      it.each([
        { dimension: 'width', value: '120px', size: [122, 62], fit: [120, 60] },
        { dimension: 'height', value: '80px', size: [102, 82], fit: [100, 80] },
      ])('allocates new canvases when the layer changes $dimension', async (change) => {
        const { host, media } = mediaFixture();
        const layer = mediaLayer({ source: zoomedSource });

        applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
        await waitForLayerEffectsReady(host as unknown as HTMLElement);
        const capture = capturedInput();

        host.style[change.dimension] = change.value;
        applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
        await waitForLayerEffectsReady(host as unknown as HTMLElement);

        const resized = mocks.createRenderer.mock.results.at(-1)!.value.setInput.mock
          .calls[0]![0] as Canvas;
        expect(resized).not.toBe(capture);
        expect([resized.width, resized.height]).toEqual(change.size);
        expect(resized.context.drawImage).toHaveBeenCalledWith(media, 1, 1, ...change.fit);
        const output = effectOutput(host);
        expect(output.context.drawImage.mock.calls.at(-1)![0]).not.toBe(
          output.context.drawImage.mock.calls[0]![0],
        );
        disposeLayerEffects(host as unknown as HTMLElement);
      });
    });

    describe('with an effect that needs room outside the layer', () => {
      // A blur of radius 10 reserves 1 + 10 * 3 pixels around the layer.
      const padding = 31;

      function blurredLayer() {
        const layer = createLayerOfKind('rectangle');
        layer.effects.stack = [];
        addEffect(layer, 'blur', { blendMode: 'normal', params: { radius: 10 } });
        addEffect(layer, 'shader', {
          blendMode: 'normal',
          shader: createShaderPaint({ fragmentSource: zoomedSource }),
        });
        return layer;
      }

      /** The canvas the blur read, which is the padded capture. */
      function paddedCapture() {
        const blurred = capturedInput();
        return blurred.context.drawImage.mock.calls[0]![0] as Canvas;
      }

      it('pads the Media copy and lets the output spill outside the layer', async () => {
        const { host, media } = mediaFixture();

        applyLayerEffectsFilter(host as unknown as HTMLElement, blurredLayer().effects, 0);
        await waitForLayerEffectsReady(host as unknown as HTMLElement);

        const padded = paddedCapture();
        expect([padded.width, padded.height]).toEqual([100 + padding * 2, 60 + padding * 2]);
        expect(padded.context.drawImage).toHaveBeenCalledWith(media, padding, padding, 100, 60);
        const output = effectOutput(host);
        expect([output.width, output.height]).toEqual([100 + padding * 2, 60 + padding * 2]);
        expect(output.style.left).toBe(`-${padding}px`);
        expect(output.style.top).toBe(`-${padding}px`);
        expect(output.style.width).toBe(`calc(100% + ${padding * 2}px)`);
        disposeLayerEffects(host as unknown as HTMLElement);
      });

      it('fits a Media backing larger than the layer into the padded capture', async () => {
        const { host, media } = mediaFixture();
        Object.assign(media, { width: 200, height: 120 });

        applyLayerEffectsFilter(host as unknown as HTMLElement, blurredLayer().effects, 0);
        await waitForLayerEffectsReady(host as unknown as HTMLElement);

        const padded = paddedCapture();
        expect([padded.width, padded.height]).toEqual([100 + padding * 2, 60 + padding * 2]);
        expect(padded.context.drawImage).toHaveBeenCalledWith(media, padding, padding, 100, 60);
        disposeLayerEffects(host as unknown as HTMLElement);
      });

      it('does not recopy a held frame', async () => {
        const { host, media } = mediaFixture();
        const layer = blurredLayer();

        applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
        await waitForLayerEffectsReady(host as unknown as HTMLElement);
        applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
        await waitForLayerEffectsReady(host as unknown as HTMLElement);

        const padded = paddedCapture();
        expect(
          padded.context.drawImage.mock.calls.filter(([input]) => input === media),
        ).toHaveLength(1);
        disposeLayerEffects(host as unknown as HTMLElement);
      });

      it('shrinks back to its one pixel of padding once the extra room is no longer needed', async () => {
        const { host, media } = mediaFixture();

        applyLayerEffectsFilter(host as unknown as HTMLElement, blurredLayer().effects, 0);
        await waitForLayerEffectsReady(host as unknown as HTMLElement);
        applyLayerEffectsFilter(
          host as unknown as HTMLElement,
          mediaLayer({ source: zoomedSource }).effects,
          0,
        );
        await waitForLayerEffectsReady(host as unknown as HTMLElement);

        const output = effectOutput(host);
        expect([output.width, output.height]).toEqual([102, 62]);
        expect(output.style.left).toBe('-1px');
        expect(output.style.width).toBe('calc(100% + 2px)');
        const input = mocks.createRenderer.mock.results.at(-1)!.value.setInput.mock
          .calls[0]![0] as Canvas;
        expect([input.width, input.height]).toEqual([102, 62]);
        expect(input.context.drawImage).toHaveBeenCalledWith(media, 1, 1, 100, 60);
        disposeLayerEffects(host as unknown as HTMLElement);
      });
    });
  });

  it.each(['normal', 'screen'] as const)(
    'blends and masks with the captured copy when the Media canvas is replaced mid-%s frame',
    async (blendMode) => {
      const { host, media } = mediaFixture();
      // Source replacement may occur while the shader frame is in flight.
      mocks.createRenderer.mockImplementationOnce(() =>
        fakeRenderer(async () => {
          media.remove();
        }),
      );
      const layer = createLayerOfKind('rectangle');
      layer.effects.stack = [];
      addEffect(layer, 'shader', {
        blendMode,
        blendOpacity: blendMode === 'normal' ? 1 : 0.6,
      });

      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);

      const capture = mocks.createRenderer.mock.results[0]!.value.setInput.mock
        .calls[0]![0] as Canvas;
      const shaderOutput = mocks.createRenderer.mock.calls[0]![0] as Canvas;
      const output = host.children.find(
        (node) => node.dataset.ografShaderEffectOutput === 'true',
      ) as Canvas;
      const blended = output.context.drawImage.mock.calls[0]![0] as Canvas;
      expect(blended.drawStates).toEqual(
        blendMode === 'normal'
          ? [
              { input: shaderOutput, opacity: 1, operation: 'source-over' },
              { input: capture, opacity: 1, operation: 'destination-in' },
            ]
          : [
              { input: capture, opacity: 1, operation: 'source-over' },
              { input: shaderOutput, opacity: 0.6, operation: 'screen' },
              { input: capture, opacity: 1, operation: 'destination-in' },
            ],
      );
      expect(blended.context.globalCompositeOperation).toBe('source-over');
      expect(blended.context.globalAlpha).toBe(1);
      disposeLayerEffects(host as unknown as HTMLElement);
    },
  );

  it('holds a capture until its frame changes and survives repeated disposal', async () => {
    const { host, media } = mediaFixture();
    const layer = createLayerOfKind('rectangle');
    layer.effects.stack = [];
    addEffect(layer, 'shader', { blendMode: 'normal' });

    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
    await waitForLayerEffectsReady(host as unknown as HTMLElement);
    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
    await waitForLayerEffectsReady(host as unknown as HTMLElement);
    const capture = mocks.createRenderer.mock.results[0]!.value.setInput.mock
      .calls[0]![0] as Canvas;
    const copies = () =>
      capture.context.drawImage.mock.calls.filter(([input]) => input === media).length;
    expect(copies()).toBe(1);

    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 16);
    await waitForLayerEffectsReady(host as unknown as HTMLElement);
    expect(copies()).toBe(2);
    const renderer = mocks.createRenderer.mock.results[0]!.value;
    expect(renderer.setInput.mock.calls.map(([input]: [Canvas]) => input)).toEqual([
      capture,
      capture,
      capture,
    ]);

    disposeLayerEffects(host as unknown as HTMLElement);
    disposeLayerEffects(host as unknown as HTMLElement);
  });

  it.each(['runtime layer', 'Studio content'] as const)(
    'recaptures a held frame only when the element rendered into the %s changes',
    async (scope) => {
      const { host, content } = fixture();
      const rendered = scope === 'runtime layer' ? host : content;
      const render = (fill: string) => {
        rendered.dataset.ografRenderedElement = JSON.stringify({ type: 'rectangle', fill });
      };
      mocks.toCanvas.mockImplementation(async () => {
        const captured = host.ownerDocument.createElement('canvas') as Canvas;
        captured.width = 100;
        captured.height = 60;
        captured.dataset.fixtureElement = rendered.dataset.ografRenderedElement ?? '';
        return captured;
      });
      const layer = createLayerOfKind('rectangle');
      layer.effects.stack = [];
      addEffect(layer, 'shader', { blendMode: 'normal' });
      const refresh = async () => {
        applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 42);
        await waitForLayerEffectsReady(host as unknown as HTMLElement);
      };
      const inputElement = () => {
        const input = mocks.createRenderer.mock.results[0]!.value.setInput.mock.calls.at(
          -1,
        )![0] as Canvas;
        const captured = input.context.drawImage.mock.calls.at(-1)![0] as Canvas;
        return JSON.parse(captured.dataset.fixtureElement!).fill;
      };

      render('#ff0000');
      await refresh();
      await refresh();
      expect(mocks.toCanvas).toHaveBeenCalledOnce();
      expect(inputElement()).toBe('#ff0000');

      render('#00a0ff');
      await refresh();
      expect(mocks.toCanvas).toHaveBeenCalledTimes(2);
      expect(inputElement()).toBe('#00a0ff');

      await refresh();
      expect(mocks.toCanvas).toHaveBeenCalledTimes(2);
      disposeLayerEffects(host as unknown as HTMLElement);
    },
  );

  it('updates a child wipe inside a composited parent without clipping the whole parent output', async () => {
    const { host, content } = fixture();
    content.className = 'layer-node';
    const paint = host.ownerDocument.createElement('div');
    content.appendChild(paint);
    const sibling = host.ownerDocument.createElement('div');
    sibling.className = 'layer-node';
    host.appendChild(sibling);
    const layer = createLayerOfKind('rectangle');
    layer.effects.stack = [];
    addEffect(layer, 'shader', { blendMode: 'normal' });
    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 42);
    await waitForLayerEffectsReady(host as unknown as HTMLElement);
    applyRevealClip(content as unknown as HTMLElement, {
      clipRight: [{ id: 'child-wipe', frame: 0, value: 0.5, easing: 'linear' }],
    });
    await waitForLayerEffectsReady(host as unknown as HTMLElement);
    const output = host.children.find((child) => child.dataset.ografShaderEffectOutput === 'true')!;
    expect(paint.style.clipPath).toBe('inset(0% 50% 0% 0%)');
    expect(output.style.clipPath ?? '').toBe('');
    expect(sibling.style.clipPath ?? '').toBe('');
    expect(mocks.toCanvas).toHaveBeenCalledTimes(2);
    disposeLayerEffects(host as unknown as HTMLElement);
  });
  it.each(['runtime layer', 'Studio content'] as const)(
    'wipes shader output at a held frame and restores it on backward seeks for %s',
    async (scope) => {
      const { host, content } = fixture();
      const paint = host.ownerDocument.createElement('div');
      content.appendChild(paint);
      const revealHost = scope === 'runtime layer' ? host : content;
      const native = scope === 'runtime layer' ? content : paint;
      host.style.clipPath = 'polygon(0 0, 80% 0, 80% 100%, 0 100%)';
      mocks.toCanvas.mockImplementation(async () => {
        const captured = host.ownerDocument.createElement('canvas') as Canvas;
        captured.width = 100;
        captured.height = 60;
        captured.dataset.fixtureClip = native.style.clipPath ?? '';
        return captured;
      });
      const layer = createLayerOfKind('rectangle');
      layer.effects.stack = [];
      addEffect(layer, 'shader', { blendMode: 'normal' });
      const wipe = (value: number) =>
        applyRevealClip(revealHost as unknown as HTMLElement, {
          clipRight: [{ id: 'wipe', frame: 0, value, easing: 'linear' }],
        });
      wipe(1);
      applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 42);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);
      const renderer = mocks.createRenderer.mock.results[0]!.value;
      const output = host.children.find(
        (child) => child.dataset.ografShaderEffectOutput === 'true',
      )!;
      const inputClip = () => {
        const input = renderer.setInput.mock.calls.at(-1)![0] as Canvas;
        const captured =
          input.dataset.fixtureClip !== undefined
            ? input
            : (input.context.drawImage.mock.calls.at(-1)![0] as Canvas);
        return captured.dataset.fixtureClip;
      };
      expect(output.style.clipPath).toBe('inset(0% 100% 0% 0%)');
      expect(inputClip()).toBe('inset(0% 100% 0% 0%)');
      wipe(0.5);
      const padding = Math.max(0, -(Number.parseFloat(output.style.left ?? '') || 0));
      expect(output.style.clipPath).toBe(`inset(0px ${50 + padding}px 0px 0px)`);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);
      expect(inputClip()).toBe('inset(0% 50% 0% 0%)');
      wipe(0);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);
      expect(output.style.clipPath).toBe('');
      expect(inputClip()).toBe('');
      wipe(0.5);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);
      expect(inputClip()).toBe('inset(0% 50% 0% 0%)');
      expect(mocks.toCanvas).toHaveBeenCalledTimes(4);
      expect(renderer.render.mock.calls.every(([timestamp]: [number]) => timestamp === 42)).toBe(
        true,
      );
      expect(host.style.clipPath).toBe('polygon(0 0, 80% 0, 80% 100%, 0 100%)');
      wipe(0.5);
      await waitForLayerEffectsReady(host as unknown as HTMLElement);
      expect(mocks.toCanvas).toHaveBeenCalledTimes(4);
      disposeLayerEffects(host as unknown as HTMLElement);
    },
  );

  it('refreshes a held shader stack after async chart initialization and later frame changes', async () => {
    const { host, content } = fixture();
    const initialize = { resolve: undefined as (() => void) | undefined };
    vi.stubGlobal('__ografEffectChartInitialize', initialize);
    const snapshot = createRendererPluginSnapshot({
      manifest: {
        schemaVersion: 1,
        apiVersion: 1,
        kind: 'chart',
        id: 'test.shader-chart-ready',
        version: '1.0.0',
        name: 'Async chart fixture',
        presets: ['bar'],
        license: 'MIT',
      },
      licenseText: 'MIT test fixture',
      source: `export default { apiVersion:1, create(canvas) {
        canvas.width=100; canvas.height=60;
        return new Promise(resolve => { globalThis.__ografEffectChartInitialize.resolve = () => resolve({
          renderAtFrame(frame) { canvas.dataset.fixtureFrame=String(frame); },
          update() {}, dispose() {},
        }); });
      }};`,
    });
    const element = createChartElement({
      provider: {
        id: snapshot.manifest.id,
        version: snapshot.manifest.version,
        sha256: snapshot.sha256,
      },
    });
    mocks.toCanvas.mockImplementation(async (source: Node) => {
      const captured = source.ownerDocument.createElement('canvas') as Canvas;
      captured.width = 100;
      captured.height = 60;
      const chartCanvas = source
        .querySelectorAll('canvas')
        .find((canvas) => canvas.dataset.ografChartCanvas === 'true');
      captured.dataset.fixtureFrame = chartCanvas?.dataset.fixtureFrame ?? 'blank';
      return captured;
    });
    mountChart(content as unknown as HTMLElement, element, { rendererPlugins: [snapshot] });
    renderChartAnimationAtFrame(content as unknown as HTMLElement, element, 10);
    await vi.waitFor(() => expect(initialize.resolve).toBeTypeOf('function'));
    const layer = createLayerOfKind('chart');
    layer.effects.stack = [];
    addEffect(layer, 'shader', { blendMode: 'normal' });
    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
    await waitForLayerEffectsReady(host as unknown as HTMLElement);
    const renderer = mocks.createRenderer.mock.results[0]!.value;
    const inputFrame = () => {
      const input = renderer.setInput.mock.calls.at(-1)![0] as Canvas;
      const captured = input.dataset.fixtureFrame
        ? input
        : (input.context.drawImage.mock.calls.at(-1)![0] as Canvas);
      return captured.dataset.fixtureFrame;
    };
    expect(inputFrame()).toBe('blank');

    initialize.resolve!();
    await waitForChartsReady(content as unknown as HTMLElement);
    await waitForLayerEffectsReady(host as unknown as HTMLElement);
    expect(mocks.toCanvas).toHaveBeenCalledTimes(2);
    expect(inputFrame()).toBe('10');
    // Keep the layer/effect clock at zero: chart replay alone must invalidate its cached input.
    renderChartAnimationAtFrame(content as unknown as HTMLElement, element, 15);
    await waitForLayerEffectsReady(host as unknown as HTMLElement);
    expect(mocks.toCanvas).toHaveBeenCalledTimes(3);
    expect(inputFrame()).toBe('15');
    disposeChart(content as unknown as HTMLElement);
    disposeLayerEffects(host as unknown as HTMLElement);
  });

  it('captures the incoming stack result and supplies it to iChannel0 in order', async () => {
    const { host, content, base } = fixture();
    const layer = createLayerOfKind('rectangle');
    layer.effects.stack = [];
    addEffect(layer, 'brightness', { enabled: true, params: { amount: 1.2 } });
    addEffect(layer, 'shader', { blendMode: 'screen', blendOpacity: 0.6 });

    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 1250);
    await waitForLayerEffectsReady(host as unknown as HTMLElement);

    expect(mocks.toCanvas).toHaveBeenCalledOnce();
    expect(mocks.createRenderer).toHaveBeenCalledOnce();
    const renderer = mocks.createRenderer.mock.results[0]!.value;
    expect(renderer.setInput).toHaveBeenCalledOnce();
    expect(renderer.setInput.mock.calls[0]![0]).not.toBe(base);
    expect(renderer.render).toHaveBeenCalledWith(1250);
    expect(content.style.opacity).toBe('0');
    expect(host.children.some((node) => node.dataset.ografShaderEffectOutput === 'true')).toBe(
      true,
    );
  });

  it('commits a completed Media frame while a newer effect frame is queued', async () => {
    const { host, content } = fixture();
    const media = host.ownerDocument.createElement('canvas') as Canvas;
    media.width = 100;
    media.height = 60;
    media.dataset.ografMediaCanvas = 'true';
    host.appendChild(media);
    const layer = createLayerOfKind('rectangle');
    if (layer.element.type !== 'rectangle') throw new Error('Expected rectangle.');
    layer.element.fill = createMediaPaint({
      source: { kind: 'clip', src: 'asset:video' },
      fit: 'fill',
    });
    layer.effects.stack = [];
    addEffect(layer, 'shader', {
      blendMode: 'screen',
      blendOpacity: 0.6,
      shader: createShaderPaint({
        fragmentSource:
          'void mainImage(out vec4 color, in vec2 fragCoord) { color = vec4(1.0, 0.5, 0.0, 0.25); }',
      }),
    });
    let resolveFirst = () => {};
    const ready = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValue(undefined);
    mocks.createRenderer.mockImplementationOnce(() => ({
      setInput: vi.fn(),
      setEffectBlend: vi.fn(),
      updateParameters: vi.fn(),
      render: vi.fn(),
      ready,
      completeFrame: vi.fn(async () => {}),
      dispose: vi.fn(),
    }));

    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
    await vi.waitFor(() => expect(mocks.createRenderer).toHaveBeenCalledOnce());
    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 16);
    resolveFirst();

    await waitForLayerEffectsReady(host as unknown as HTMLElement);
    expect(mocks.toCanvas).not.toHaveBeenCalled();
    const firstRenderer = mocks.createRenderer.mock.results[0]!.value;
    expect(firstRenderer.setInput.mock.calls.length).toBe(2);
    const padded = firstRenderer.setInput.mock.calls[0]![0] as Canvas;
    expect(padded.context.drawImage.mock.calls[0]![0]).toBe(media);
    expect(firstRenderer.setEffectBlend).toHaveBeenCalledWith({
      blendMode: 'normal',
      blendOpacity: 1,
    });
    const output = host.children.find(
      (node) => node.dataset.ografShaderEffectOutput === 'true',
    ) as Canvas;
    expect(output.context.drawImage.mock.calls.length).toBe(2);
    expect(content.style.opacity).toBe('');
    expect(output.style.mixBlendMode).toBe('screen');
    expect(output.style.opacity).toBe('0.6');
  });
});
