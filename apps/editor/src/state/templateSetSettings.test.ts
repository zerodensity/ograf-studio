import { describe, expect, it } from 'vitest';
import {
  createComposition,
  createDefaultTransform,
  createLayerKeyframe,
  createLayerOfKind,
  createMediaPaint,
  createProject,
} from '@ograf-editor/scene-model';
import {
  applyTemplateSetSettings,
  changedTemplateSetSettingKeys,
  effectiveTemplateSetSettings,
  TEMPLATE_SET_LAYOUT_KEYS,
  TEMPLATE_SET_SETTING_KEYS,
  templateSetSettingsFromProject,
} from './templateSetSettings';

describe('per-setting template set resolution', () => {
  it('exposes every inheritable property as a unique flattened key', () => {
    const settings = templateSetSettingsFromProject(createProject());
    expect(TEMPLATE_SET_SETTING_KEYS).toEqual([
      ...Object.keys(settings).filter((key) => key !== 'layout'),
      ...TEMPLATE_SET_LAYOUT_KEYS.map((key) => `layout.${key}`),
    ]);
    expect(new Set(TEMPLATE_SET_SETTING_KEYS).size).toBe(TEMPLATE_SET_SETTING_KEYS.length);
  });

  it('resolves local values when no set defaults exist', () => {
    const project = createProject();
    const local = templateSetSettingsFromProject(project);
    expect(effectiveTemplateSetSettings(project, undefined)).toEqual(local);
  });

  it('inherits all values without modifying the child or master settings', () => {
    const project = createProject();
    const source = structuredClone(project);
    const defaults = templateSetSettingsFromProject(createProject());
    defaults.width = 1280;
    defaults.height = 720;
    defaults.frameRate = 50;
    defaults.backgroundColor = '#123456';
    defaults.layout.gridSize = 24;
    const master = structuredClone(defaults);

    const resolved = effectiveTemplateSetSettings(project, defaults);
    expect(resolved).toEqual(defaults);
    resolved.layout.gridSize = 100;
    expect(project).toEqual(source);
    expect(defaults).toEqual(master);
  });

  it('keeps only explicitly overridden values and inherits the rest', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    composition.width = 2000;
    composition.backgroundColor = '#abcdef';
    composition.layout.showRulers = false;
    composition.layout.snapThreshold = 19;
    const defaults = templateSetSettingsFromProject(createProject());
    defaults.width = 1280;
    defaults.height = 720;
    defaults.backgroundColor = '#123456';
    defaults.layout.snapThreshold = 3;

    expect(
      effectiveTemplateSetSettings(project, defaults, ['width', 'layout.snapThreshold']),
    ).toEqual({
      ...defaults,
      width: 2000,
      layout: { ...defaults.layout, snapThreshold: 19 },
    });
  });

  it('retains an explicit override when its current value equals an inherited default', () => {
    const project = createProject();
    const defaults = templateSetSettingsFromProject(project);
    const width = defaults.width;
    defaults.width += 320;
    expect(effectiveTemplateSetSettings(project, defaults, ['width']).width).toBe(width);
    // Reset means dropping the explicit key, not comparing values or deleting the child value.
    expect(effectiveTemplateSetSettings(project, defaults).width).toBe(width + 320);
  });

  it('can retain every local value without clearing local settings', () => {
    const project = createProject();
    const defaults = templateSetSettingsFromProject(createProject());
    defaults.width = 4000;
    defaults.backgroundColor = '#aabbcc';
    defaults.layout.boundsMode = 'contain';
    expect(effectiveTemplateSetSettings(project, defaults, TEMPLATE_SET_SETTING_KEYS)).toEqual(
      templateSetSettingsFromProject(project),
    );
  });

  it('reports only changed inheritable values in deterministic flattened order', () => {
    const before = createProject();
    const after = structuredClone(before);
    const composition = after.compositions[0]!;
    composition.width += 100;
    composition.updateInterruption = 'replace';
    composition.layout.snapToGrid = !composition.layout.snapToGrid;
    composition.layout.gridSize += 2;
    after.supportsNonRealTime = !after.supportsNonRealTime;
    expect(changedTemplateSetSettingKeys(before, after)).toEqual([
      'width',
      'supportsNonRealTime',
      'updateInterruption',
      'layout.snapToGrid',
      'layout.gridSize',
    ]);
    expect(changedTemplateSetSettingKeys(before, structuredClone(before))).toEqual([]);
  });

  it('does not flag subcomposition geometry, names, guides or presentation backgrounds', () => {
    const before = createProject();
    const nested = createComposition({ name: 'Nested' });
    before.compositions.push(nested);
    const after = structuredClone(before);
    after.name = 'Renamed';
    after.compositions[0]!.name = 'Main renamed';
    after.compositions[0]!.layout.presentationBackground = 'webcam';
    after.compositions[0]!.layout.guides.push({ id: 'guide', axis: 'vertical', position: 10 });
    after.compositions[1]!.width += 100;
    after.compositions[1]!.frameRate = 50;
    expect(changedTemplateSetSettingKeys(before, after)).toEqual([]);
  });

  it('bakes resolved geometry while preserving keyed frame positions, IDs and easing', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('rectangle');
    layer.constraints = { horizontal: 'scale', vertical: 'scale' };
    layer.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
    layer.animationTracks.x = [
      { id: 'x-start', frame: 0, value: 20, easing: 'linear' },
      { id: 'x-end', frame: 25, value: 80, easing: 'linear' },
    ];
    composition.layers.push(layer);
    const source = structuredClone(project);
    const defaults = templateSetSettingsFromProject(project);
    defaults.width = composition.width * 2;
    defaults.height = composition.height / 2;
    defaults.frameRate = 50;
    const resolved = applyTemplateSetSettings(
      project,
      effectiveTemplateSetSettings(project, defaults),
    );
    expect(resolved.compositions[0]!.layers[0]!.animationTracks.x).toEqual([
      { id: 'x-start', frame: 0, value: 40, easing: 'linear' },
      { id: 'x-end', frame: 25, value: 160, easing: 'linear' },
    ]);
    expect(project).toEqual(source);
  });

  it('preserves mandatory real-time rendering after resolving per-setting overrides', () => {
    const project = createProject();
    const layer = createLayerOfKind('rectangle');
    if (layer.element.type !== 'rectangle') throw new Error('Expected rectangle.');
    layer.element.fill = createMediaPaint({ source: { kind: 'clip', src: 'asset:clip' } });
    project.compositions[0]!.layers.push(layer);
    const defaults = templateSetSettingsFromProject(project);
    defaults.supportsRealTime = false;
    defaults.supportsNonRealTime = true;
    const resolved = applyTemplateSetSettings(
      project,
      effectiveTemplateSetSettings(project, defaults),
    );
    expect(resolved.supportsRealTime).toBe(true);
    expect(resolved.supportsNonRealTime).toBe(false);
  });
});
