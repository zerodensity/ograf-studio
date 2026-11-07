import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createChartLayer,
  createRectangleLayer,
  createShaderPackPluginSnapshot,
  createShaderPaint,
  createTextLayer,
  inspectShaderElement,
  studioPluginReference,
  type ShaderPackPreset,
} from '@ograf-editor/scene-model';
const rendererFactory = vi.hoisted(() => vi.fn());
vi.mock('@ograf-editor/ograf-runtime', () => ({ createShaderRenderer: rendererFactory }));
// SSR normally reads Zustand's startup snapshot, not the installed-pack test fixture.
vi.mock('../state/pluginSettingsStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/pluginSettingsStore')>();
  const store = actual.useRendererPluginSettingsStore;
  return {
    ...actual,
    useRendererPluginSettingsStore: Object.assign(
      <T>(selector?: (state: ReturnType<typeof store.getState>) => T) =>
        selector ? selector(store.getState()) : store.getState(),
      store,
    ),
  };
});
import { ShaderPackPresetList, ShaderPackGallery } from './ShaderPackGallery';
import { EditorWindowContext } from '../layout/EditorWindow';
import { useRendererPluginSettingsStore } from '../state/pluginSettingsStore';
import { useProjectStore } from '../state/projectStore';
import {
  filterShaderPackPresets,
  shaderPackLayerTargetReason,
  shaderPackPreviewPaint,
  shaderPackResourceTarget,
  shaderPackSelectionKey,
  shaderPackTargetReason,
} from './shaderPackGalleryHelpers';

const entry: ShaderPackPreset = {
  id: 'waves',
  name: 'Soft waves',
  description: 'A calm blue moving background',
  targets: ['fill', 'outline'],
  paint: createShaderPaint(),
};
const effect: ShaderPackPreset = {
  id: 'signal',
  name: 'Signal glitch',
  targets: ['effect'],
  paint: createShaderPaint({
    fragmentSource:
      'void mainImage(out vec4 color, in vec2 coord) { color = texture(iChannel0, coord / iResolution.xy); }',
  }),
};
const snapshot = createShaderPackPluginSnapshot({
  manifest: {
    schemaVersion: 1,
    apiVersion: 1,
    kind: 'shader-pack',
    id: 'test.shaders',
    version: '1.0.0',
    name: 'Shader pack',
    license: 'CC0-1.0',
  },
  shaders: [entry, effect],
  licenseText: 'CC0-1.0',
});

describe('shader pack gallery policy and name-only preset list', () => {
  it('filters names, descriptions and IDs by target without changing source or parameters', () => {
    const before = JSON.stringify(snapshot);
    expect(
      filterShaderPackPresets(snapshot.shaders, 'fill', 'blue calm').map((preset) => preset.id),
    ).toEqual(['waves']);
    expect(filterShaderPackPresets(snapshot.shaders, 'fill', 'SIGNAL')).toEqual([]);
    expect(
      filterShaderPackPresets(snapshot.shaders, 'effect', 'signal').map((preset) => preset.id),
    ).toEqual(['signal']);
    expect(filterShaderPackPresets(snapshot.shaders, 'outline', 'wave')).toHaveLength(1);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('provides specific no-selection, lock, outline and unsupported-fill reasons', () => {
    const rectangle = createRectangleLayer();
    const text = createTextLayer();
    expect(shaderPackTargetReason(entry, 'fill', [])).toMatch(/Select/);
    expect(shaderPackTargetReason(entry, 'outline', [text])).toBe('');
    expect(shaderPackTargetReason(entry, 'outline', [text, rectangle])).toMatch(/only.*text/);
    rectangle.isLocked = true;
    expect(shaderPackTargetReason(entry, 'fill', [rectangle, text])).toMatch(/locked/);
    expect(shaderPackTargetReason(effect, 'fill', [text])).toMatch(/not available/);
    expect(shaderPackLayerTargetReason(createChartLayer(), 'fill')).toMatch(/does not support/);
    expect(shaderPackLayerTargetReason(createChartLayer(), 'effect')).toBe('');
  });

  it('stores standalone paints and incoming-image effects using the preferred declared target', () => {
    expect(shaderPackResourceTarget(entry, 'fill')).toBe('fill');
    expect(shaderPackResourceTarget(entry, 'outline')).toBe('outline');
    expect(shaderPackResourceTarget(entry, 'effect')).toBe('fill');
    expect(shaderPackResourceTarget(effect, 'effect')).toBe('effect');
    expect(shaderPackResourceTarget(effect, 'fill')).toBe('effect');
    expect(shaderPackResourceTarget(effect, 'outline')).toBe('effect');
    const allTargets: ShaderPackPreset = { ...entry, targets: ['fill', 'outline', 'effect'] };
    expect(shaderPackResourceTarget(allTargets, 'effect')).toBe('effect');
    expect(shaderPackResourceTarget({ ...entry, targets: ['outline', 'effect'] }, 'fill')).toBe(
      'outline',
    );
    expect(
      shaderPackResourceTarget({ ...entry, paint: { ...entry.paint, speed: 50 } }, 'fill'),
    ).toBe(undefined);
  });

  it('prepares an explicit single effect preview with a temporary raster input without altering preset bytes', () => {
    const before = JSON.stringify(snapshot);
    const paint = shaderPackPreviewPaint(snapshot, 'signal', 'effect');
    expect(paint.inputImage).toMatchObject({
      source: expect.stringMatching(/^data:image\/png;base64,/),
      filter: 'nearest',
      wrap: 'repeat',
    });
    expect(inspectShaderElement(paint).valid).toBe(true);
    expect(paint.packProvenance?.presetId).toBe('signal');
    expect(shaderPackPreviewPaint(snapshot, 'waves', 'fill').inputImage).toBeUndefined();
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(() => shaderPackPreviewPaint(snapshot, 'signal', 'fill')).toThrow();
  });

  it('renders twenty named buttons without repeated thumbnails or per-preset GPU previews', () => {
    rendererFactory.mockClear();
    const presets = Array.from({ length: 20 }, (_, index) => ({
      ...entry,
      id: `shader-${index}`,
      name: `Shader ${index + 1}`,
    }));
    const markup = renderToStaticMarkup(
      createElement(ShaderPackPresetList, { presets, selected: 'shader-4', onSelect: () => {} }),
    );
    expect(markup.match(/<button/g)).toHaveLength(20);
    expect(markup).not.toContain('<svg');
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup).toContain('Shader 20');
    expect(markup).toContain('title="A calm blue moving background"');
    expect(markup).not.toContain('<canvas');
    expect(markup).not.toContain('mainImage');
    expect(rendererFactory).not.toHaveBeenCalled();
  });

  it('uses inert symbolic icons in embedded template cards without per-preset GPU previews', () => {
    rendererFactory.mockClear();
    const presets = Array.from({ length: 20 }, (_, index) => ({
      ...entry,
      id: `shader-${index}`,
      name: `Shader ${index + 1}`,
    }));
    const markup = renderToStaticMarkup(
      createElement(ShaderPackPresetList, {
        presets,
        selected: 'shader-4',
        onSelect: () => {},
        embedded: true,
      }),
    );
    expect(markup.match(/class="plugin-template-card/g)).toHaveLength(20);
    expect(markup.match(/<svg\b/g)).toHaveLength(20);
    expect(markup).not.toContain('is-text-only');
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup).toContain('plugin-template-gallery');
    expect(markup).toContain('Shader 20');
    expect(markup).toContain('title="A calm blue moving background"');
    expect(markup).not.toContain('shader-pack-presets');
    expect(markup).not.toMatch(/<img|<canvas|shader-live-preview|mainImage/);
    expect(rendererFactory).not.toHaveBeenCalled();
  });

  it('compares stable selection identities rather than presentation order', () => {
    expect(shaderPackSelectionKey(['b', 'a', 'a'])).toBe(shaderPackSelectionKey(['a', 'b']));
    expect(shaderPackSelectionKey(['a'])).not.toBe(shaderPackSelectionKey(['a', 'b']));
  });
});

describe('embedded shader gallery presentation', () => {
  afterEach(() =>
    useRendererPluginSettingsStore.setState({ installed: [], defaultProvider: null }),
  );
  it('renders settings, names and the one preview directly without popup chrome or GPU compilation', () => {
    useRendererPluginSettingsStore.setState({
      installed: [{ snapshot, enabled: true, trusted: true, installedAt: '' }],
    });
    rendererFactory.mockClear();
    const composition = useProjectStore.getState().project.compositions[0]!;
    const markup = renderToStaticMarkup(
      createElement(
        EditorWindowContext.Provider,
        { value: { document: {} } as unknown as Window & typeof globalThis },
        createElement(ShaderPackGallery, {
          composition,
          layerIds: [],
          embedded: true,
          onClose: () => {
            throw new Error('Docked gallery must not close');
          },
        }),
      ),
    );
    expect(markup).toContain('shader-pack-picker is-embedded');
    expect(markup).toContain('role="region"');
    expect(markup).not.toContain('Shader pack version');
    expect(markup).toContain('Shader target');
    expect(markup).toContain('Selected shader preview');
    expect(markup).toContain('<aside class="plugin-template-detail" aria-label="Shader Preview">');
    expect(markup).toContain('<h3>Shader Preview</h3>');
    const selectedPreview = markup.match(
      /<section class="shader-pack-preview"[^>]*>([\s\S]*?)<\/section>/,
    )?.[1];
    expect(selectedPreview).not.toContain('<strong>');
    expect(selectedPreview).toContain('aria-label="Soft waves animated shader preview"');
    const browser = markup.match(
      /<section class="plugin-template-browser"[^>]*>([\s\S]*?)<\/section>/,
    )?.[1];
    const details = markup.match(
      /<aside class="plugin-template-detail"[^>]*>([\s\S]*?)<\/aside>/,
    )?.[1];
    expect(markup).not.toContain('Find shader preset');
    expect(markup).not.toContain('shader-pack-search');
    expect(markup).not.toContain('type="search"');
    expect(browser).toContain('plugin-template-card is-selected');
    expect(browser).toContain('shader-preset-icon');
    expect(browser).not.toMatch(/Shader target|shader-live-preview|Add to Resources/);
    expect(details).toContain('Shader target');
    expect(details).toContain('plugin-template-info');
    expect(details).toContain('Add to Resources');
    expect(details).toContain('Apply Fill');
    expect(details).toContain('Only the selected shader runs. Preview can use GPU resources.');
    expect(details).toContain('Creates an editable copy; pack updates/removal');
    expect(markup.match(/class="shader-live-preview"/g)).toHaveLength(1);
    expect(markup).not.toMatch(/<canvas|mainImage/);
    expect(markup).toContain('Soft waves');
    expect(markup).toContain('A calm blue moving background');
    expect(markup).not.toContain('Close shader gallery');
    expect(markup).not.toContain('Manage plugins');
    expect(markup).not.toContain('top:80px');
    expect(rendererFactory).not.toHaveBeenCalled();
  });

  it('uses the common controlled query while preserving target filtering, selection fallback and shader bytes', () => {
    const searchablePack = createShaderPackPluginSnapshot({
      manifest: { ...snapshot.manifest, id: 'test.searchable' },
      shaders: [
        entry,
        {
          ...entry,
          id: 'embers',
          name: 'Amber embers',
          description: 'Warm glowing embers',
        },
        effect,
      ],
      licenseText: snapshot.licenseText,
    });
    useRendererPluginSettingsStore.setState({
      installed: [{ snapshot: searchablePack, enabled: true, trusted: true, installedAt: '' }],
    });
    rendererFactory.mockClear();
    const before = JSON.stringify(searchablePack);
    const composition = useProjectStore.getState().project.compositions[0]!;
    const render = (searchQuery: string) =>
      renderToStaticMarkup(
        createElement(
          EditorWindowContext.Provider,
          { value: { document: {} } as unknown as Window & typeof globalThis },
          createElement(ShaderPackGallery, {
            composition,
            layerIds: [],
            initialReference: studioPluginReference(searchablePack),
            searchQuery,
            embedded: true,
            onClose: () => {},
          }),
        ),
      );
    const filtered = render('warm embers');
    expect(filtered).toContain('Amber embers');
    expect(filtered).not.toContain('Soft waves');
    expect(filtered).not.toContain('Signal glitch');
    expect(filtered.match(/class="plugin-template-card/g)).toHaveLength(1);
    expect(filtered).toContain('Amber embers animated shader preview');
    expect(filtered.match(/class="shader-live-preview"/g)).toHaveLength(1);
    expect(filtered).not.toContain('type="search"');

    // The query must not change Fill to Effect simply because another target has a match.
    const noMatchingTarget = render('signal');
    expect(noMatchingTarget).toContain('No matching shaders for this target.');
    expect(noMatchingTarget).toContain('Apply Fill');
    expect(noMatchingTarget).not.toContain('Signal glitch');
    expect(noMatchingTarget).not.toContain('class="shader-live-preview"');
    expect(noMatchingTarget).not.toContain('class="plugin-template-card');

    const cleared = render('');
    expect(cleared).toContain('Soft waves');
    expect(cleared).toContain('Amber embers');
    expect(cleared).toContain('Soft waves animated shader preview');
    expect(cleared).not.toContain('Signal glitch');
    expect(cleared.match(/class="shader-live-preview"/g)).toHaveLength(1);
    expect(JSON.stringify(searchablePack)).toBe(before);
    expect(rendererFactory).not.toHaveBeenCalled();
  });

  it('keeps effect preview explanations and enables resource copies for trusted effect-only packs', () => {
    const effectPack = createShaderPackPluginSnapshot({
      manifest: { ...snapshot.manifest, id: 'test.effects', name: 'Effect shaders' },
      shaders: [effect],
      licenseText: snapshot.licenseText,
    });
    useRendererPluginSettingsStore.setState({
      installed: [{ snapshot: effectPack, enabled: true, trusted: true, installedAt: '' }],
    });
    rendererFactory.mockClear();
    const composition = useProjectStore.getState().project.compositions[0]!;
    const markup = renderToStaticMarkup(
      createElement(
        EditorWindowContext.Provider,
        { value: { document: {} } as unknown as Window & typeof globalThis },
        createElement(ShaderPackGallery, {
          composition,
          layerIds: [],
          initialReference: studioPluginReference(effectPack),
          embedded: true,
          onClose: () => {},
        }),
      ),
    );
    const details = markup.match(
      /<aside class="plugin-template-detail"[^>]*>([\s\S]*?)<\/aside>/,
    )?.[1];
    expect(details).toContain('Signal glitch');
    expect(details).toContain(
      'Preview uses a checkerboard. Applying the effect uses the actual layer image',
    );
    const resourceButton = details?.match(/<button[^>]*>Add to Resources<\/button>/)?.[0];
    expect(resourceButton).toBeDefined();
    expect(resourceButton).not.toContain('disabled=');
    expect(resourceButton).toContain('as an effect source; its stack supplies the incoming image.');
    expect(details).toContain('Apply Effect');
    expect(markup.match(/class="shader-live-preview"/g)).toHaveLength(1);
    expect(markup).not.toMatch(/<canvas|mainImage|data:image/);
    expect(rendererFactory).not.toHaveBeenCalled();
  });

  it('does not preview a pack after its exact installed version is disabled', () => {
    useRendererPluginSettingsStore.setState({
      installed: [{ snapshot, enabled: false, trusted: true, installedAt: '' }],
    });
    rendererFactory.mockClear();
    const composition = useProjectStore.getState().project.compositions[0]!;
    const markup = renderToStaticMarkup(
      createElement(
        EditorWindowContext.Provider,
        { value: { document: {} } as unknown as Window & typeof globalThis },
        createElement(ShaderPackGallery, {
          composition,
          layerIds: [],
          initialReference: studioPluginReference(snapshot),
          embedded: true,
          onClose: () => {},
        }),
      ),
    );
    expect(markup).toContain('Install, review and enable this exact shader pack');
    expect(markup).toContain('No matching shaders for this target.');
    expect(markup).not.toContain('class="shader-live-preview"');
    expect(markup).not.toMatch(/<svg|<canvas|mainImage/);
    expect(rendererFactory).not.toHaveBeenCalled();
  });
});
