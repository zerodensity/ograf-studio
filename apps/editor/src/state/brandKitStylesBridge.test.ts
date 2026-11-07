import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultGradient,
  createDefaultTransform,
  createDefaultTypographyPresets,
  createLayerKeyframe,
  createLayerOfKind,
  createProject,
  type DesignSystem,
} from '@ograf-editor/scene-model';
import { templateSetOperationSchema } from '../../../../packages/agent-tools/src/templateSetSchemas';
import { useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { useSelectionStore } from './selectionStore';
import { useTestDataStore } from './testDataStore';
import { createProjectSet, resolveProjectSetTemplate } from './projectSet';

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
});
const history = await import('./historyStore');
const { handleTemplateSetRequest } = await import('./templateSetBridge');
const { updateTypographyPreset, updateBackgroundStyle } = await import('./brandKitStyles');

const preset = { ...createDefaultTypographyPresets()[0]!, id: 'master-headline' };
const background = {
  id: 'master-background',
  name: 'News background',
  paint: createDefaultGradient(),
};

interface Snapshot {
  revision: string;
  templateSet: {
    brandKit: DesignSystem;
    templates: Array<{ id: string; typographyOverrides: string[]; backgroundOverrides: string[] }>;
  };
}
const read = () => handleTemplateSetRequest({ action: 'read' }) as unknown as Snapshot;
function command(operation: Record<string, unknown>, expectedRevision = read().revision) {
  const parsed = templateSetOperationSchema.parse(operation);
  return handleTemplateSetRequest({
    action: 'command',
    expectedRevision,
    operation: parsed,
  }) as unknown as Snapshot;
}
function fixture() {
  const project = createProject({ name: 'News' });
  const composition = project.compositions[0]!;
  composition.designSystem = { name: 'News branding', tokens: [] };
  const text = createLayerOfKind('text');
  text.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
  composition.layers.push(text);
  const set = createProjectSet('Evening Show', project);
  const templateId = set.templates[0]!.id;
  useProjectStore.getState().loadProject(resolveProjectSetTemplate(set, templateId));
  useProjectSetStore.setState({ projectSet: set, activeTemplateId: templateId });
  command({ type: 'set_brand_kit', brandKit: { name: 'Master branding', tokens: [] } });
  history.resetHistory();
  return { templateId, layerId: text.id };
}
function composition() {
  const project = useProjectStore.getState().project;
  return project.compositions.find((item) => item.id === project.mainCompositionId)!;
}
function state() {
  return structuredClone({
    project: useProjectStore.getState().project,
    set: useProjectSetStore.getState().projectSet,
  });
}
function addStyles() {
  command({ type: 'upsert_brand_style', kind: 'typography', style: preset });
  command({ type: 'upsert_brand_style', kind: 'background', style: background });
}

describe('style MCP operation bridge', () => {
  beforeEach(() => {
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
    useSelectionStore.setState({ selectedLayerId: null, selectedLayerIds: [] });
    useTestDataStore.getState().resetAll();
    history.resetHistory();
  });
  afterAll(() => {
    history.resetHistory();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('parses and executes all eight style operations through their ordinary authored contracts', () => {
    const { templateId, layerId } = fixture();
    addStyles();
    command({ type: 'apply_typography', layerIds: [layerId], presetId: preset.id });
    expect(composition().layers[0]!.element).toMatchObject(preset.properties);
    useProjectStore.getState().updateLayerElement(layerId, { fontSize: 100 });
    command({ type: 'reset_typography_property', layerId, property: 'fontSize' });
    expect(composition().layers[0]!.element).toMatchObject({
      fontSize: preset.properties.fontSize,
    });
    command({ type: 'set_background_style', styleId: background.id, asDefault: true });
    expect(composition().backgroundPaint).toEqual(background.paint);
    command({
      type: 'set_brand_style_override',
      kind: 'background',
      templateId,
      styleId: background.id,
      override: true,
    });
    expect(read().templateSet.templates[0]!.backgroundOverrides).toContain(background.id);
    command({
      type: 'set_brand_style_override',
      kind: 'background',
      templateId,
      styleId: background.id,
      override: false,
    });
    command({ type: 'set_background_paint', paint: '#22aa88' });
    expect(composition().backgroundPaint).toBe('#22aa88');
    command({ type: 'reset_background' });
    expect(composition().backgroundPaint).toEqual(background.paint);
    command({
      type: 'upsert_brand_style',
      kind: 'background',
      style: { ...background, id: 'unused' },
    });
    command({ type: 'remove_brand_style', kind: 'background', styleId: 'unused' });
    expect(read().templateSet.brandKit.backgrounds!.some((style) => style.id === 'unused')).toBe(
      false,
    );
  });

  it('rejects malformed property ranges and unknown style fields atomically after structural parsing', () => {
    fixture();
    addStyles();
    const before = state();
    const revision = read().revision;
    const invalid = [
      {
        type: 'upsert_brand_style',
        kind: 'typography',
        style: { ...preset, properties: { ...preset.properties, fontSize: 0 } },
      },
      {
        type: 'upsert_brand_style',
        kind: 'typography',
        style: { ...preset, properties: { ...preset.properties, lineHeight: 100 } },
      },
      {
        type: 'upsert_brand_style',
        kind: 'typography',
        style: { ...preset, properties: { ...preset.properties, fontWeight: 600.5 } },
      },
      { type: 'upsert_brand_style', kind: 'typography', style: { ...preset, script: 'alert(1)' } },
      {
        type: 'upsert_brand_style',
        kind: 'background',
        style: {
          ...background,
          paint: {
            ...background.paint,
            stops: [
              { offset: 0, color: '#ffffff', opacity: 2 },
              { offset: 1, color: '#000000', opacity: 1 },
            ],
          },
        },
      },
    ];
    for (const operation of invalid) {
      expect(() => command(operation)).toThrow();
      expect(state()).toEqual(before);
      expect(read().revision).toBe(revision);
    }
    expect(
      templateSetOperationSchema.safeParse({
        type: 'reset_typography_property',
        layerId: 'text',
        property: 'color',
      }).success,
    ).toBe(false);
    expect(
      templateSetOperationSchema.safeParse({
        type: 'set_background_paint',
        paint: '#ffffff',
        execute: true,
      }).success,
    ).toBe(false);
  });

  it('rejects stale opaque revisions for style mutations without erasing a local text edit', () => {
    const { layerId } = fixture();
    addStyles();
    const previous = read().revision;
    expect(previous).toMatch(/^[0-9a-f-]+:\d+$/);
    useProjectStore.getState().updateLayerElement(layerId, { content: 'Local headline' });
    const before = state();
    expect(() => command({ type: 'set_background_paint', paint: '#22aa88' }, previous)).toThrow(
      /revision conflict/,
    );
    expect(state()).toEqual(before);
    expect(composition().layers[0]!.element).toMatchObject({ content: 'Local headline' });
  });

  it('resets template catalog overrides to updated master typography/background values', () => {
    const { templateId, layerId } = fixture();
    addStyles();
    command({ type: 'apply_typography', layerIds: [layerId], presetId: preset.id });
    command({ type: 'set_background_style', styleId: background.id, asDefault: true });
    updateTypographyPreset('template', preset.id, {
      properties: { ...preset.properties, fontSize: 100 },
    });
    updateBackgroundStyle('template', background.id, { paint: createDefaultGradient('radial') });
    command({
      type: 'upsert_brand_style',
      kind: 'typography',
      style: { ...preset, properties: { ...preset.properties, fontSize: 120 } },
    });
    command({
      type: 'upsert_brand_style',
      kind: 'background',
      style: { ...background, paint: createDefaultGradient('conic') },
    });
    expect(composition().layers[0]!.element).toMatchObject({ fontSize: 100 });
    expect(composition().backgroundPaint).toEqual(createDefaultGradient('radial'));
    command({
      type: 'set_brand_style_override',
      kind: 'typography',
      templateId,
      styleId: preset.id,
      override: false,
    });
    command({
      type: 'set_brand_style_override',
      kind: 'background',
      templateId,
      styleId: background.id,
      override: false,
    });
    expect(composition().layers[0]!.element).toMatchObject({ fontSize: 120 });
    expect(composition().backgroundPaint).toEqual(createDefaultGradient('conic'));
  });

  it('does not permit deleting a used typography or master-background style', () => {
    const { layerId } = fixture();
    addStyles();
    command({ type: 'apply_typography', layerIds: [layerId], presetId: preset.id });
    command({ type: 'set_background_style', styleId: background.id, asDefault: true });
    const before = state();
    const revision = read().revision;
    expect(() =>
      command({ type: 'remove_brand_style', kind: 'typography', styleId: preset.id }),
    ).toThrow(/still used/);
    expect(() =>
      command({ type: 'remove_brand_style', kind: 'background', styleId: background.id }),
    ).toThrow(/still used/);
    expect(state()).toEqual(before);
    expect(read().revision).toBe(revision);
  });
});
