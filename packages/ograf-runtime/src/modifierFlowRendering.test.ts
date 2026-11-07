import { describe, expect, it, vi } from 'vitest';
import {
  createComposition,
  createDefaultTransform,
  createFieldDefinition,
  createLayerKeyframe,
  createLayerModifier,
  createLayerOfKind,
  modifierProperty,
  normalizeClockTimerSettings,
  type Element,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';
import { buildRuntimeTimeline } from './buildRuntimeTimeline';

// Model a browser's measured glyph metrics, while exercising the real cache, fit, flow, and player.
// Unlike authored-box fallback tests, changed bound content genuinely changes the intrinsic width.
vi.mock('./renderElement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./renderElement')>()),
  renderElementContent: (host: HTMLElement, element: Element) => {
    if (element.type !== 'text') return;
    (host as unknown as ProbeHost).content = {
      style: {},
      getBoundingClientRect: () => {
        (host.ownerDocument as unknown as ProbeDocument).reads += 1;
        return {
          width: element.content.length * 10,
          height: element.fontSize * element.lineHeight,
        };
      },
    };
  },
  disposeElementContent: () => {},
}));

interface ProbeContent {
  style: Record<string, string>;
  getBoundingClientRect(): { width: number; height: number };
}
class ProbeHost {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  content: ProbeContent | undefined;
  children: ProbeHost[] = [];
  constructor(readonly ownerDocument: ProbeDocument) {}
  querySelector() {
    return this.content ?? null;
  }
  querySelectorAll() {
    return [];
  }
  remove() {}
}
class ProbeDocument {
  reads = 0;
  fonts = { addEventListener() {} };
  body = { appendChild() {} };
  createElement() {
    return new ProbeHost(this);
  }
  createDocumentFragment() {
    return { appendChild() {} };
  }
}

function flow(mode: 'squeeze' | 'shrink' = 'squeeze') {
  const panel = createLayerOfKind('rectangle'),
    label = createLayerOfKind('text'),
    icon = createLayerOfKind('ellipse');
  if (label.element.type !== 'text') throw new Error('fixture');
  label.element = {
    ...label.element,
    content: 'x'.repeat(60),
    fontSize: 40,
    lineHeight: 1.2,
    autoFit: 'auto-size',
  };
  panel.autoLayout = {
    ...panel.autoLayout,
    direction: 'horizontal',
    hugWidth: true,
    hugHeight: true,
    gap: 12,
    paddingLeft: 15,
    paddingRight: 20,
    paddingTop: 5,
    paddingBottom: 5,
  };
  panel.keyframes = [
    createLayerKeyframe(0, createDefaultTransform({ x: 100, y: 50, width: 900, height: 100 })),
  ];
  label.parentId = panel.id;
  icon.parentId = panel.id;
  label.keyframes = [createLayerKeyframe(0, createDefaultTransform({ width: 600, height: 60 }))];
  icon.keyframes = [createLayerKeyframe(0, createDefaultTransform({ width: 40, height: 40 }))];
  label.modifiers = [
    createLayerModifier('max-text-width', { maxWidth: 240, mode, minFontSize: 1 }, { id: 'fit' }),
  ];
  label.animationTracks[modifierProperty('fit', 'maxWidth')] = [
    { id: 'a', frame: 0, value: 240, easing: 'linear' },
    { id: 'b', frame: 10, value: 160, easing: 'linear' },
  ];
  const field = createFieldDefinition('text', { key: 'name', defaultValue: label.element.content });
  label.bindings = [{ fieldId: field.id, targetProperty: 'content' }];
  const descriptor = compileDescriptor(
    createComposition({ layers: [panel, label, icon], dataFields: [field] }),
  );
  const document = new ProbeDocument();
  const hosts = new Map(descriptor.layers.map((layer) => [layer.id, new ProbeHost(document)]));
  let data: Record<string, unknown> = { name: label.element.content };
  const timeline = buildRuntimeTimeline(
    descriptor,
    hosts as unknown as Map<string, HTMLElement>,
    () => data,
  );
  return {
    panel,
    label,
    icon,
    hosts,
    document,
    timeline,
    data: (value: string) => {
      data = { name: value };
    },
  };
}

describe('Max Text Width intrinsic sizing before Auto Layout', () => {
  it('hugs and places the sibling using the displayed cap, including data updates and backward seeks', () => {
    const h = flow();
    const panel = h.hosts.get(h.panel.id)!,
      label = h.hosts.get(h.label.id)!,
      icon = h.hosts.get(h.icon.id)!;
    expect(panel.style.width).toBe('327px'); // 15 + capped 240 + gap 12 + icon 40 + 20
    expect(panel.style.height).toBe('58px');
    expect(label.style.width).toBe('240px');
    expect(icon.style.transform).toContain('translate(367px, 55px)');
    expect(h.document.reads).toBe(1);

    for (const frame of [10, 3, 0, 10, 0]) {
      h.timeline.seek(frame, true);
      const width = 240 - frame * 8;
      expect(panel.style.width).toBe(`${width + 87}px`);
      expect(label.style.width).toBe(`${width}px`);
      expect(icon.style.transform).toContain(`translate(${127 + width}px, 55px)`);
    }
    expect(h.document.reads, 'keyframe movement must reuse completed glyph measurements').toBe(1);
    h.data('Short name');
    h.timeline.render();
    expect(label.style.width).toBe('100px');
    expect(panel.style.width).toBe('187px');
    expect(icon.style.transform).toContain('translate(227px, 55px)');
    expect(h.document.reads).toBe(2);
    h.data('x'.repeat(60));
    h.timeline.seek(10, true);
    h.timeline.seek(0, true);
    expect(panel.style.width).toBe('327px');
    expect(icon.style.transform).toContain('translate(367px, 55px)');
    expect(h.document.reads, 'returning to already measured data should hit the cache').toBe(2);
    h.timeline.dispose();
  });

  it('uses proportional shrinking height before hugged cross-axis sizing', () => {
    const h = flow('shrink');
    expect(h.hosts.get(h.label.id)!.style.width).toBe('240px');
    expect(Number.parseFloat(h.hosts.get(h.label.id)!.style.height!)).toBeCloseTo(19.2);
    expect(h.hosts.get(h.panel.id)!.style.height).toBe('50px'); // icon 40 + vertical padding 10
    h.timeline.seek(10, true);
    expect(Number.parseFloat(h.hosts.get(h.label.id)!.style.height!)).toBeCloseTo(12.8);
    expect(h.hosts.get(h.panel.id)!.style.height).toBe('50px');
    h.timeline.dispose();
  });
  it('bounds long-running clock/data measurements and safely remeasures an evicted string', () => {
    const h = flow();
    for (let index = 0; index < 513; index++) {
      h.data(`Name ${index}`);
      h.timeline.render();
    }
    const reads = h.document.reads;
    h.data('Name 512');
    h.timeline.render();
    expect(h.document.reads, 'unchanged current content must stay cached').toBe(reads);
    h.data('Name 0');
    h.timeline.render();
    expect(
      h.document.reads,
      'the 513th distinct value evicts the oldest of 512 cached strings',
    ).toBe(reads + 1);
    expect(h.hosts.get(h.label.id)!.style.width).toBe('60px');
    expect(h.hosts.get(h.panel.id)!.style.width).toBe('147px');
    h.timeline.dispose();
  });
});

describe('clock display geometry before shared modifier evaluation', () => {
  function clockLayout(format: string, initialValueMs: number, maxWidth?: number) {
    const clock = createLayerOfKind('text'),
      plate = createLayerOfKind('rectangle'),
      follower = createLayerOfKind('ellipse');
    if (clock.element.type !== 'text') throw new Error('fixture');
    clock.element = {
      ...clock.element,
      content: 'X',
      fontSize: 40,
      autoFit: 'auto-size',
      clock: normalizeClockTimerSettings({
        mode: 'count-up',
        format,
        initialValueMs,
        autoStart: true,
      }),
    };
    for (const layer of [clock, plate, follower])
      layer.keyframes = [
        createLayerKeyframe(0, createDefaultTransform({ x: 20, y: 20, width: 600, height: 50 })),
      ];
    if (maxWidth !== undefined)
      clock.modifiers = [createLayerModifier('max-text-width', { maxWidth })];
    plate.modifiers = [
      createLayerModifier('auto-size', {
        source: { kind: 'layer', layerId: clock.id },
        paddingLeft: 10,
        paddingRight: 10,
      }),
    ];
    follower.modifiers = [
      createLayerModifier('auto-follow', {
        source: { kind: 'layer', layerId: plate.id },
        sourceAnchorX: 1,
        offsetX: 12,
      }),
    ];
    const descriptor = compileDescriptor(createComposition({ layers: [follower, plate, clock] }));
    const document = new ProbeDocument();
    const hosts = new Map(descriptor.layers.map((layer) => [layer.id, new ProbeHost(document)]));
    const timeline = buildRuntimeTimeline(descriptor, hosts as unknown as Map<string, HTMLElement>);
    return { clock, plate, follower, document, hosts, timeline };
  }
  it('measures the completed clock display rather than authored placeholder content', () => {
    const h = clockLayout('hh:mm:ss', 0, 40);
    expect(h.hosts.get(h.clock.id)!.style.width).toBe('40px'); // 00:00:00 is 80px, squeezed by 0.5
    expect(h.hosts.get(h.plate.id)!.style.width).toBe('60px');
    expect(h.hosts.get(h.follower.id)!.style.transform).toContain('translate(92px, 20px)');
    expect(h.document.reads).toBe(1);
    h.timeline.dispose();
  });
  it('updates Auto Size and Auto Follow as count-up digit count changes and restores them on backward seeks', () => {
    const h = clockLayout('s', 9900);
    for (const [frame, width] of [
      [0, 10],
      [10, 20],
      [0, 10],
      [10, 20],
    ] as const) {
      h.timeline.seek(frame, true);
      expect(h.hosts.get(h.clock.id)!.style.width).toBe(`${width}px`);
      expect(h.hosts.get(h.plate.id)!.style.width).toBe(`${width + 20}px`);
      expect(h.hosts.get(h.follower.id)!.style.transform).toContain(
        `translate(${width + 52}px, 20px)`,
      );
    }
    expect(
      h.document.reads,
      'only the two distinct formatted display strings require measurement',
    ).toBe(2);
    h.timeline.dispose();
  });
});
