import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  createComposition,
  createFieldDefinition,
  createImageLayer,
  createLayerOfKind,
  createLayerKeyframe,
  createLayerLoopClip,
  createLayerPropertyKeyframe,
  createShaderPaint,
  defaultTransformForRole,
  getElementShaderPaint,
  applyShaderAnimationValues,
  sampleShaderAnimationValues,
  createTextElement,
  type Asset,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';

const runtime = vi.hoisted(() => {
  vi.stubGlobal('HTMLElement', class {});
  return {
    paint: vi.fn(),
    time: vi.fn(),
    ready: vi.fn(async () => {}),
    deterministic: vi.fn(),
    pattern: vi.fn(),
  };
});
vi.mock('@ograf-editor/ograf-runtime', async (original) => ({
  ...(await original<typeof import('@ograf-editor/ograf-runtime')>()),
  applyAnimatedPaint: runtime.paint,
  renderAnimatedElementAtTime: runtime.time,
  waitForElementContentReady: runtime.ready,
  setLottieDeterministicRendering: runtime.deterministic,
  renderPatternAtElapsed: runtime.pattern,
}));
afterAll(() => vi.unstubAllGlobals());
import {
  sampleCompiledLayerVisualState,
  compiledLoopElapsedFrames,
} from '@ograf-editor/ograf-runtime';
import {
  renderCaptureElementFrame,
  resolveCaptureElement,
  settleCaptureContent,
} from './agentCapture';
import { inferResolvedFamily, rasterize } from './agentCapture';
import { getFontEmbedCSS, toCanvas } from 'html-to-image';
import { captureMaskedCanvas } from './maskedCapture';
import { acquireProjectFonts } from './projectFonts';
vi.mock('html-to-image', () => ({ getFontEmbedCSS: vi.fn(), toCanvas: vi.fn() }));
vi.mock('./maskedCapture', () => ({ captureMaskedCanvas: vi.fn() }));

describe('embedded capture fonts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  const asset: Asset = {
    id: 'project-font',
    name: 'Project Face.woff2',
    kind: 'font',
    mimeType: 'font/woff2',
    fontFamily: 'Project Face',
    fontWeight: '700',
    fontStyle: 'italic',
    dataUri: 'data:font/woff2;base64,Zm9udA==',
  };
  it.each([false, true])(
    'embeds project and stylesheet faces into capture options (masked: %s)',
    async (masked) => {
      const root = { querySelector: () => (masked ? {} : null) } as unknown as HTMLElement;
      vi.mocked(getFontEmbedCSS).mockResolvedValue(
        '@font-face{font-family:"App Face";src:url("data:font/woff2;base64,YXBw");}',
      );
      const render = masked ? captureMaskedCanvas : toCanvas;
      vi.mocked(render).mockResolvedValue({
        toDataURL: () => 'data:image/png;base64,cG5n',
      } as HTMLCanvasElement);
      await rasterize(root, 1920, 1080, 320, undefined, [asset]);
      expect(render).toHaveBeenCalledWith(
        root,
        expect.objectContaining({
          fontEmbedCSS: expect.stringContaining(
            '@font-face{font-family:"Project Face";src:url("data:font/woff2;base64,Zm9udA==");font-weight:700;font-style:italic;}',
          ),
          canvasWidth: 320,
          canvasHeight: 180,
        }),
      );
      expect(vi.mocked(render).mock.calls[0]![1]!.fontEmbedCSS).toContain('font-family:"App Face"');
    },
  );
  it('recognizes loaded project faces without a local system-font probe', async () => {
    const check = vi.fn(() => true);
    vi.stubGlobal('document', {
      fonts: Object.assign(new Set([{ family: '"Project Face"', status: 'loaded' }]), { check }),
    });
    const probe = vi.fn();
    vi.stubGlobal('FontFace', probe);
    expect(
      await inferResolvedFamily(
        createTextElement({
          fontFamily: '"Project Face", sans-serif',
          fontWeight: 700,
          fontSize: 32,
          content: 'Title',
        }),
      ),
    ).toBe('Project Face');
    expect(check).toHaveBeenCalledWith('700 32px "Project Face"', 'Title');
    expect(probe).not.toHaveBeenCalled();
  });
  it('does not trust fonts.check alone when a requested face is missing or failed', async () => {
    vi.stubGlobal('document', {
      fonts: Object.assign(new Set([{ family: 'Broken Face', status: 'error' }]), {
        check: () => true,
      }),
    });
    vi.stubGlobal(
      'FontFace',
      class {
        load() {
          return Promise.reject(new Error('Not installed'));
        }
      },
    );
    expect(
      await inferResolvedFamily(
        createTextElement({ fontFamily: 'Missing Face, Broken Face, sans-serif' }),
      ),
    ).toBe('sans-serif');
  });
  it('recognizes the loaded embedded face even when a failed sidecar makes fonts.check false', async () => {
    class EmbeddedFace {
      status = 'loaded';
      load() {
        return Promise.resolve(this);
      }
    }
    const fonts = Object.assign(new Set(), { check: vi.fn(() => false) });
    const target = { fonts, defaultView: { FontFace: EmbeddedFace } } as unknown as Document;
    vi.stubGlobal('document', target);
    const localProbe = vi.fn();
    vi.stubGlobal('FontFace', localProbe);
    const lease = acquireProjectFonts(target, [asset]);
    await lease.ready;
    try {
      expect(
        await inferResolvedFamily(createTextElement({ fontFamily: 'Project Face, serif' })),
      ).toBe('Project Face');
      expect(localProbe).not.toHaveBeenCalled();
    } finally {
      lease.dispose();
    }
  });
});

describe('capture image bindings', () => {
  const assets: Asset[] = [
    {
      id: 'default-image',
      name: 'Default',
      kind: 'image',
      mimeType: 'image/png',
      dataUri: 'data:image/png;base64,ZGVmYXVsdA==',
    },
    {
      id: 'bound-image',
      name: 'Bound',
      kind: 'image',
      mimeType: 'image/png',
      dataUri: 'data:image/png;base64,Ym91bmQ=',
    },
  ];
  function fixture() {
    const composition = createComposition({ assets });
    const layer = createImageLayer();
    if (layer.element.type !== 'image') throw Error('Expected image');
    layer.element.src = 'asset:default-image';
    const field = createFieldDefinition('image-url', {
      key: 'programmeImage',
      defaultValue: 'asset:bound-image',
    });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'src' }];
    composition.layers = [layer];
    composition.dataFields = [field];
    return { composition, layer: compileDescriptor(composition).layers[0]! };
  }
  it('resolves an embedded image supplied by a data binding after resolving the base element', () => {
    const { composition, layer } = fixture();
    expect(layer.element).toHaveProperty('src', assets[0]!.dataUri);
    expect(
      resolveCaptureElement(layer, { programmeImage: 'asset:bound-image' }, composition),
    ).toHaveProperty('src', assets[1]!.dataUri);
    expect(composition.dataFields[0]!.defaultValue).toBe('asset:bound-image');
    expect(composition.layers[0]!.element).toHaveProperty('src', 'asset:default-image');
  });
  it('preserves direct image URLs and reports missing embedded assets explicitly', () => {
    const { composition, layer } = fixture();
    expect(
      resolveCaptureElement(
        layer,
        { programmeImage: 'https://example.test/image.png' },
        composition,
      ),
    ).toHaveProperty('src', 'https://example.test/image.png');
    expect(() =>
      resolveCaptureElement(layer, { programmeImage: 'asset:missing' }, composition),
    ).toThrow('unknown asset');
  });
});

describe('shader animation capture', () => {
  it('applies the shared loop sample after binding, before drawing the exact capture timestamp', () => {
    const composition = createComposition({ frameRate: 25 });
    const layer = createLayerOfKind('rectangle');
    if (layer.element.type !== 'rectangle') throw Error('Expected rectangle');
    layer.element.fill = createShaderPaint({
      fragmentSource: `#pragma ograf tint color
const vec3 tint = vec3(1.0);
void mainImage(out vec4 c, in vec2 p) { c = vec4(tint, 1.0); }`,
    });
    layer.keyframes = composition.keyframes.map((keyframe, index) =>
      createLayerKeyframe(index * 12, defaultTransformForRole('rectangle', keyframe.role)),
    );
    layer.animationTracks['fill.parameters.tint.r'] = [
      createLayerPropertyKeyframe(0, 0),
      createLayerPropertyKeyframe(24, 1, { easing: 'linear' }),
    ];
    layer.loop = createLayerLoopClip({
      durationFrames: 25,
      activation: { type: 'lifecycle' },
      tracks: {
        'fill.parameters.tint.r': [
          createLayerPropertyKeyframe(0, 0.2),
          createLayerPropertyKeyframe(25, 0.4, { easing: 'linear' }),
        ],
      },
    });
    const field = createFieldDefinition('color', { key: 'tint', defaultValue: '#336699' });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'fill.parameters.tint' }];
    composition.layers = [layer];
    composition.dataFields = [field];
    const descriptor = compileDescriptor(composition),
      compiled = descriptor.layers[0]!;
    const data = { tint: '#336699' },
      frame = 18;
    const state = sampleCompiledLayerVisualState(
      compiled,
      frame,
      compiledLoopElapsedFrames(descriptor, compiled, frame),
      data,
    );
    const element = resolveCaptureElement(compiled, data, composition);
    let rendered = element;
    const order: string[] = [];
    runtime.paint.mockImplementation((_host, tracks, sampledFrame) => {
      order.push('uniforms');
      rendered = applyShaderAnimationValues(
        element,
        sampleShaderAnimationValues(element, tracks, sampledFrame),
      );
    });
    runtime.time.mockImplementation((_host, _element, timestamp) => {
      order.push('draw');
      expect(timestamp).toBe(720);
      const tint = getElementShaderPaint(rendered)!.parameters.tint as number[];
      expect(tint[0]).toBeCloseTo(0.248);
      expect(tint.slice(1)).toEqual([0.4, 0.6]);
    });
    renderCaptureElementFrame({} as HTMLElement, element, state, 720);
    expect(order).toEqual(['uniforms', 'draw']);
    expect(getElementShaderPaint(element)!.parameters.tint).toEqual([0.2, 0.4, 0.6]);
    runtime.paint.mockReset();
    runtime.time.mockReset();
  });

  it('waits for the latest shader draw after layout settles before declaring capture ready', async () => {
    const events: string[] = [];
    let finishRedraw = () => {};
    let finalWaitStarted = () => {};
    const enteredFinalWait = new Promise<void>((resolve) => {
      finalWaitStarted = resolve;
    });
    runtime.ready.mockReset();
    runtime.ready.mockImplementationOnce(async () => {
      events.push('initial');
    });
    runtime.ready.mockImplementationOnce(() => {
      events.push('latest');
      finalWaitStarted();
      return new Promise<void>((resolve) => {
        finishRedraw = resolve;
      });
    });
    vi.stubGlobal('document', { fonts: { ready: Promise.resolve() } });
    vi.stubGlobal('window', { setTimeout: vi.fn(() => 0) });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      events.push('layout');
      callback(0);
      return 0;
    });
    let settled = false;
    const capture = settleCaptureContent({
      querySelectorAll: () => [],
    } as unknown as HTMLElement).then(() => {
      settled = true;
    });
    await enteredFinalWait;
    expect(events).toEqual(['initial', 'layout', 'layout', 'latest']);
    expect(settled).toBe(false);
    finishRedraw();
    await capture;
    expect(settled).toBe(true);
  });
});
