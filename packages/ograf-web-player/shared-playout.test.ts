import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mountGraphic } = vi.hoisted(() => ({ mountGraphic: vi.fn() }));
vi.mock('./ograf-player.js', () => ({
  dataFromSchemaDefaults: () => ({}),
  mountOGrafGraphic: mountGraphic,
}));

class TestNode {
  textContent = '';
  hidden = true;
  className = '';
  disabled = false;
  offsetWidth = 330;
  offsetHeight = 200;
  dataset: Record<string, string> = {};
  children: unknown[] = [];
  classList = { add: vi.fn(), remove: vi.fn() };
  private properties = new Map<string, string>();
  style = {
    left: '',
    top: '',
    setProperty: (name: string, value: string) => this.properties.set(name, value),
    removeProperty: (name: string) => this.properties.delete(name),
    getPropertyValue: (name: string) => this.properties.get(name) ?? '',
  };
  private capturedPointer?: number;
  private listeners = new Map<string, (event: Record<string, unknown>) => void>();

  constructor(readonly tag = 'div') {}

  addEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
    this.listeners.set(type, listener);
  }
  emit(type: string, event: Record<string, unknown> = {}) {
    this.listeners.get(type)?.({ preventDefault: vi.fn(), ...event });
  }
  click() {
    this.emit('click');
  }
  append(...children: TestNode[]) {
    this.children.push(...children);
  }
  contains(target: unknown): boolean {
    return (
      this === target ||
      this.children.some((child) => child instanceof TestNode && child.contains(target))
    );
  }
  querySelectorAll(selectors: string): TestNode[] {
    const tags = selectors.split(',').map((tag) => tag.trim());
    return this.children.flatMap((child) =>
      child instanceof TestNode
        ? [...(tags.includes(child.tag) ? [child] : []), ...child.querySelectorAll(selectors)]
        : [],
    );
  }
  setPointerCapture(id: number) {
    this.capturedPointer = id;
  }
  hasPointerCapture(id: number) {
    return this.capturedPointer === id;
  }
  releasePointerCapture() {
    this.capturedPointer = undefined;
  }
  getBoundingClientRect() {
    return { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0 };
  }
  replaceChildren() {
    this.children = [];
  }
}

class TestEventSource {
  static OPEN = 1;
  readyState = TestEventSource.OPEN;
  private listeners = new Map<string, (event: { data: string }) => void>();

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    this.listeners.set(type, listener);
  }
  emit(type: string, value: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(value) });
  }
}

const seed = { revision: 1, command: { kind: 'play' } };
const update = { revision: 2, command: { kind: 'update', data: { headline: 'Latest headline' } } };

function snapshot(publicationId: string, commands: unknown[] = [seed], canControl = false) {
  return {
    publicationId,
    manifestUrl: `/package/${publicationId}.ograf.json`,
    canControl,
    revision: commands.length,
    commands,
  };
}

function testPlayer() {
  return {
    manifest: { name: 'Signal Blue' },
    play: vi.fn(),
    update: vi.fn(),
    action: vi.fn(),
    dispose: vi.fn(),
  };
}

describe('shared playout startup recovery', () => {
  let nodes: Map<string, TestNode>;
  let dom: TestNode;
  let source: TestEventSource;
  let fetchState: ReturnType<typeof vi.fn>;
  const node = (selector: string) => nodes.get(selector)!;

  beforeEach(() => {
    vi.resetModules();
    mountGraphic.mockReset();
    nodes = new Map(
      [
        '#layout',
        '#title',
        '#stage',
        '#status',
        '#feedback',
        '#error',
        '#retry-preview',
        '#controls',
        '#operator-fields',
        '#move-controls',
        '#preview-step',
        '#fullscreen',
      ].map((selector) => [selector, new TestNode()]),
    );
    node('#controls').append(
      node('#move-controls'),
      node('#preview-step'),
      node('#fullscreen'),
      node('#operator-fields'),
    );
    node('#layout').append(node('#stage'), node('#feedback'), node('#controls'));
    source = new TestEventSource();
    fetchState = vi.fn();
    dom = Object.assign(new TestNode('document'), {
      querySelector: node,
      documentElement: new TestNode('html'),
      createElement: (tag: string) => new TestNode(tag),
    });
    vi.stubGlobal('document', dom);
    vi.stubGlobal(
      'window',
      Object.assign(new TestNode('window'), { innerWidth: 1200, innerHeight: 600 }),
    );
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal(
      'EventSource',
      Object.assign(
        function () {
          return source;
        },
        { OPEN: TestEventSource.OPEN },
      ),
    );
    vi.stubGlobal('fetch', fetchState);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('cleans up a 550 load failure and retries the latest history without writing a command', async () => {
    const player = testPlayer();
    mountGraphic
      .mockImplementationOnce(async () => {
        node('#stage').children.push('partial player');
        throw new Error('load failed (550): Markets: Isolated supervisor did not connect.');
      })
      .mockResolvedValueOnce(player);
    const response = Promise.withResolvers<{ ok: boolean; json(): unknown }>();
    fetchState.mockReturnValueOnce(response.promise);

    await import('./shared-playout.js');
    source.emit('snapshot', snapshot('current'));
    await vi.waitFor(() => {
      expect(node('#retry-preview').hidden).toBe(false);
      expect(node('#error').textContent).toContain('Isolated supervisor did not connect');
    });
    expect(node('#status').textContent).toBe('Preview failed to load.');
    expect(node('#stage').children).toEqual([]);

    source.emit('command', { publicationId: 'current', ...update });
    node('#retry-preview').click();
    await vi.waitFor(() =>
      expect(fetchState).toHaveBeenCalledWith('./state', {
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(node('#status').textContent).toBe('Retrying preview…');
    source.emit('command', {
      publicationId: 'current',
      revision: 3,
      command: { kind: 'play', goto: 3 },
    });
    response.resolve({ ok: true, json: () => snapshot('current', [seed, update]) });
    await vi.waitFor(() => expect(node('#layout').dataset.revision).toBe('3'));

    expect(fetchState).toHaveBeenCalledTimes(1);
    expect(mountGraphic).toHaveBeenCalledTimes(2);
    expect(player.play.mock.calls).toEqual([[{ delta: 1, skipAnimation: true }], [{ goto: 3 }]]);
    expect(player.update).toHaveBeenCalledExactlyOnceWith(
      { headline: 'Latest headline' },
      { skipAnimation: true },
    );
    expect(node('#status').textContent).toBe('Connected as viewer');
    expect(node('#feedback').hidden).toBe(true);
    expect(node('#error').hidden).toBe(true);
    expect(node('#retry-preview').hidden).toBe(true);
  });

  it('aborts a pending retry when a newer publication arrives', async () => {
    const player = testPlayer();
    mountGraphic.mockRejectedValueOnce(new Error('old load failed')).mockResolvedValueOnce(player);
    let retrySignal: AbortSignal | undefined;
    fetchState.mockImplementationOnce((_url, options: { signal: AbortSignal }) => {
      retrySignal = options.signal;
      return new Promise((_resolve, reject) =>
        retrySignal?.addEventListener('abort', () => reject(new Error('stale retry aborted'))),
      );
    });

    await import('./shared-playout.js');
    source.emit('snapshot', snapshot('old'));
    await vi.waitFor(() => expect(node('#retry-preview').hidden).toBe(false));
    node('#retry-preview').click();
    await vi.waitFor(() => expect(fetchState).toHaveBeenCalledTimes(1));
    source.emit('snapshot', snapshot('replacement'));
    await vi.waitFor(() => expect(node('#layout').dataset.revision).toBe('1'));

    expect(retrySignal?.aborted).toBe(true);
    expect(mountGraphic.mock.calls.map(([options]) => options.manifestUrl)).toEqual([
      '/package/old.ograf.json',
      '/package/replacement.ograf.json',
    ]);
    expect(player.play).toHaveBeenCalledExactlyOnceWith({ delta: 1, skipAnimation: true });
    expect(node('#error').hidden).toBe(true);
    expect(node('#retry-preview').hidden).toBe(true);
  });

  it('opens, moves and dismisses the native-style operator popup without showing the revision', async () => {
    const player = {
      ...testPlayer(),
      manifest: {
        name: 'Headline',
        stepCount: 2,
        schema: { properties: { headline: { title: 'Headline', type: 'string' } } },
      },
      renderCharacteristics: { resolution: { width: 1920, height: 1080 } },
    };
    player.play.mockResolvedValue({ currentStep: 0 });
    mountGraphic.mockResolvedValueOnce(player);

    await import('./shared-playout.js');
    source.emit('snapshot', snapshot('current', [seed], true));
    await vi.waitFor(() => expect(node('#layout').dataset.revision).toBe('1'));
    const controls = node('#controls');
    expect(controls.hidden).toBe(true);
    expect(node('#status').hidden).toBe(true);
    expect(node('#preview-step').textContent).toBe('Step 1 of 2');
    expect(parseFloat(node('#stage').style.getPropertyValue('--graphic-width'))).toBeCloseTo(
      1066.667,
    );

    const preventDefault = vi.fn();
    node('#layout').emit('contextmenu', {
      target: node('#stage'),
      clientX: 100,
      clientY: 100,
      preventDefault,
    });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(controls.hidden).toBe(false);
    expect(controls.style).toMatchObject({ left: '100px', top: '100px' });
    const fields = node('#operator-fields');
    expect(fields.querySelectorAll('button').map((button) => button.textContent)).toEqual([
      '⏮ Back',
      'Next ⏭',
      'Take Out',
      'Update data',
    ]);
    const label = fields.querySelectorAll('label')[0]!;
    expect(label.className).toBe('preview-data-row');
    expect(label.children[0]).toMatchObject({ tag: 'span', textContent: 'Headline' });

    const handle = node('#move-controls');
    handle.emit('pointerdown', {
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    expect(handle.hasPointerCapture(1)).toBe(true);
    handle.emit('pointermove', { pointerId: 1, clientX: 2000, clientY: 2000 });
    expect(controls.style).toMatchObject({ left: '856px', top: '386px' });
    handle.emit('pointerup', { pointerId: 1 });
    expect(handle.hasPointerCapture(1)).toBe(false);

    node('#layout').emit('pointerdown', { button: 0, target: node('#stage') });
    expect(controls.hidden).toBe(true);
    dom.emit('keydown', {
      key: 'd',
      target: { closest: () => fields.querySelectorAll('input')[0] },
    });
    expect(controls.hidden).toBe(true);
    dom.emit('keydown', { key: 'D', target: node('#stage') });
    expect(controls.hidden).toBe(false);
    dom.emit('keydown', { key: 'Escape', target: node('#stage') });
    expect(controls.hidden).toBe(true);
  });

  it('shows off air after the last coordinated lane leaves', async () => {
    const slots = { headline: { current: 'standard' } };
    const player = { ...testPlayer(), element: { getPlayoutSnapshot: () => ({ slots }) } };
    player.play.mockResolvedValue({ currentStep: 0 });
    player.action.mockImplementation(async () => {
      slots.headline.current = '';
    });
    mountGraphic.mockResolvedValueOnce(player);

    await import('./shared-playout.js');
    source.emit('snapshot', snapshot('current'));
    await vi.waitFor(() => expect(node('#layout').dataset.revision).toBe('1'));
    expect(node('#preview-step').textContent).toBe('Step 1');

    source.emit('command', {
      publicationId: 'current',
      revision: 2,
      command: { kind: 'action', actionId: 'transition.out', payload: { slotId: 'headline' } },
    });
    await vi.waitFor(() => expect(node('#layout').dataset.revision).toBe('2'));
    expect(node('#preview-step').textContent).toBe('Off air');
  });

  it('opens a read-only viewer popup with no operator commands', async () => {
    mountGraphic.mockResolvedValueOnce(testPlayer());
    await import('./shared-playout.js');
    source.emit('snapshot', snapshot('current'));
    await vi.waitFor(() => expect(node('#layout').dataset.revision).toBe('1'));
    expect(node('#controls').hidden).toBe(true);
    node('#layout').emit('contextmenu', { target: node('#stage'), clientX: 40, clientY: 40 });
    expect(node('#controls').hidden).toBe(false);
    expect(node('#operator-fields').children).toEqual([]);
    expect(fetchState).not.toHaveBeenCalled();
    dom.emit('keydown', { key: 'Escape' });
    expect(node('#controls').hidden).toBe(true);
  });
});
