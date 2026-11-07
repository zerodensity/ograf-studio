import { describe, expect, it, vi } from 'vitest';
import {
  createFieldDefinition,
  createLayerOfKind,
  createMediaPaint,
  createProject,
} from '@ograf-editor/scene-model';
import { buildExportArtifactsWithRuntime } from './buildExportArtifacts';
import { buildOfflinePreviewHtml } from './offlinePreview';
import { NODOS_INPUT_RUNTIME } from './offlinePreviewAssets';

function exportedPage() {
  const project = createProject();
  const composition = project.compositions[0]!;
  const layer = createLayerOfKind('rectangle');
  if (!('fill' in layer.element)) throw new Error('Expected fill');
  layer.element.fill = createMediaPaint({ source: { kind: 'live', tag: 'TextureInput1' } });
  composition.layers = [layer, { ...structuredClone(layer), id: 'second' }];
  composition.dataFields = [
    createFieldDefinition('text', { key: 'TitleInput1', defaultValue: 'Initial' }),
    createFieldDefinition('object', {
      key: 'Position',
      nodosType: 'nos.fb.vec2',
      properties: [
        createFieldDefinition('number', { key: 'x' }),
        createFieldDefinition('number', { key: 'y' }),
      ],
      defaultValue: { x: 0, y: 0 },
    }),
    createFieldDefinition('text', {
      key: 'Internal',
      exposeToOgraf: false,
      defaultValue: 'Private',
    }),
  ];
  const artifacts = buildExportArtifactsWithRuntime(
    project,
    composition,
    'class GraphicElement {}',
  );
  const html = buildOfflinePreviewHtml(artifacts);
  const payload = JSON.parse(
    html.match(/<script type="application\/json" id="ograf-package">([\s\S]*?)<\/script>/)![1]!,
  );
  return { composition, html, payload, artifacts };
}

describe('Nodos inputs in ordinary exports', () => {
  it('declares exact names, native types and live textures in the normal HTML without a preset', () => {
    const { html, payload, artifacts } = exportedPage();
    const declarations = JSON.parse(
      html.match(/<script id="nodos-inputs" type="application\/json">([\s\S]*?)<\/script>/)![1]!,
    );
    expect(declarations).toEqual([
      { name: 'TitleInput1', type: 'string' },
      { name: 'Position', type: 'nos.fb.vec2' },
      { name: 'TextureInput1', type: 'nos.sys.vulkan.Texture' },
    ]);
    expect(payload.nodos.inputs).toEqual(declarations);
    expect(artifacts.manifest.schema).not.toHaveProperty('nodos');
    expect(JSON.stringify(payload.nodos)).not.toContain('Internal');
  });

  it('connects an incoming texture canvas by tag and applies pin values received during load', async () => {
    const { payload } = exportedPage();
    let receive!: (values: Record<string, unknown>) => Promise<void> | void;
    const elements = new Map<string, { getFrame(): unknown; dataset: { sourceTag: string } }>();
    const canvas = {};
    const target = {
      setAttribute: vi.fn(),
      shadowRoot: { querySelector: vi.fn(() => canvas) },
      remove: vi.fn(),
      hidden: false,
    };
    const document = { createElement: vi.fn(() => target), body: { appendChild: vi.fn() } };
    const unsubscribe = vi.fn();
    const createBinding = new Function(
      'window',
      'document',
      'customElements',
      'HTMLElement',
      `${NODOS_INPUT_RUNTIME}; return createNodosInputBinding;`,
    )(
      {
        nodos: {
          onData: (listener: typeof receive) => {
            receive = listener;
            return unsubscribe;
          },
        },
      },
      document,
      {
        get: () => undefined,
        define: (
          name: string,
          element: { new (): { getFrame(): unknown; dataset: { sourceTag: string } } },
        ) => elements.set(name, new element()),
      },
      class {
        dataset = { sourceTag: 'TextureInput1' };
      },
    );
    const errors = vi.fn();
    const binding = createBinding(
      payload.nodos,
      { TitleInput1: 'Initial', Position: { x: 0, y: 0 } },
      errors,
    );
    expect(document.createElement).toHaveBeenCalledExactlyOnceWith('nodos-input');
    expect(target.setAttribute.mock.calls).toEqual([
      ['name', 'TextureInput1'],
      ['type', 'texture'],
    ]);
    expect(elements.get('zd-ograf-media')!.getFrame()).toBe(canvas);
    elements.get('zd-ograf-media')!.dataset.sourceTag = 'textureinput1';
    expect(elements.get('zd-ograf-media')!.getFrame()).toBeNull();
    receive({ TitleInput1: 'Before load', Position: { x: 2, y: 3 }, Internal: 'Ignore' });
    const graphic = { updateAction: vi.fn(async () => ({ statusCode: 200 })) };
    const play = vi.fn();
    await binding.start(graphic, async () => undefined, play);
    expect(graphic.updateAction).toHaveBeenCalledWith({
      data: { TitleInput1: 'Before load', Position: { x: 2, y: 3 } },
    });
    await receive({ TitleInput1: 'After load' });
    expect(graphic.updateAction).toHaveBeenLastCalledWith({ data: { TitleInput1: 'After load' } });
    expect(play).toHaveBeenCalledOnce();
    expect(errors).not.toHaveBeenCalled();
    binding.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(target.remove).toHaveBeenCalledOnce();
  });

  it('keeps browser playback independent of Nodos and reports invalid host declarations explicitly', () => {
    const factory = new Function(
      'window',
      `${NODOS_INPUT_RUNTIME}; return createNodosInputBinding;`,
    );
    expect(factory({})({ error: 'Invalid Nodos name' }, {}, vi.fn())).toBeNull();
    expect(() => factory({ nodos: {} })({ error: 'Invalid Nodos name' }, {}, vi.fn())).toThrow(
      'Invalid Nodos name',
    );
    const project = createProject();
    const composition = project.compositions[0]!;
    composition.dataFields = [createFieldDefinition('text', { key: 'Resolution' })];
    const artifacts = buildExportArtifactsWithRuntime(
      project,
      composition,
      'class GraphicElement {}',
    );
    expect(artifacts.valid).toBe(true);
    expect(artifacts.nodosInputContract).toHaveProperty('error');
    expect(() => buildOfflinePreviewHtml(artifacts)).not.toThrow();
  });
});
