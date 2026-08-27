import { describe, expect, it } from 'vitest';
import {
  createComposition,
  createFieldDefinition,
  createKeyframe,
  createLayerKeyframe,
  createLayerOfKind,
  createProject,
  createTransition,
} from './factory';
import { migrateProject } from './migrations';
import type { LayerTransform, Project } from './types';

describe('migrateProject', () => {
  it('preserves a still presentation image while upgrading its layout fields', () => {
    const project = createProject();
    project.documentVersion = 24;
    project.compositions[0]!.layout.presentationBackground = 'still-image';
    project.compositions[0]!.layout.presentationBackgroundImageSource =
      'data:image/png;base64,cHJlc2VudGF0aW9u';
    project.compositions[0]!.layout.presentationBackgroundImageName = 'studio-background.png';

    const migrated = migrateProject(project);

    expect(migrated.documentVersion).toBe(25);
    expect(migrated.compositions[0]!.layout).toMatchObject({
      presentationBackground: 'still-image',
      presentationBackgroundImageSource: 'data:image/png;base64,cHJlc2VudGF0aW9u',
      presentationBackgroundImageName: 'studio-background.png',
    });
  });

  it('expands a legacy uniform rectangle radius into independent corners', () => {
    const project = createProject();
    const layer = createLayerOfKind('rectangle');
    if (layer.element.type !== 'rectangle') throw new Error('Expected a rectangle layer.');
    (layer.element as unknown as { borderRadius: number }).borderRadius = 14;
    project.compositions[0]!.layers.push(layer);
    project.documentVersion = 23;

    const migrated = migrateProject(project);

    expect(migrated.compositions[0]!.layers[0]!.element).toMatchObject({
      type: 'rectangle',
      borderRadius: { topLeft: 14, topRight: 14, bottomRight: 14, bottomLeft: 14 },
    });
    expect(migrated.documentVersion).toBe(25);
  });

  it('upgrades legacy intro/outro documents into start/step/end without mutating the source', () => {
    const intro = { id: 'legacy-intro', name: 'On air' };
    const outro = { id: 'legacy-outro', name: 'Outro', isOutro: true };
    const layer = createLayerOfKind('rectangle');
    const poses: Record<string, LayerTransform> = {};
    poses[intro.id] = {
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      rotation: 0,
      opacity: 1,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
    };
    poses[outro.id] = { ...poses[intro.id]!, opacity: 0 };
    const legacy = createProject({
      compositions: [
        {
          ...createComposition(),
          keyframes: [intro, outro] as never,
          transitions: [createTransition(intro.id, outro.id)],
          layers: [{ ...layer, keyframes: undefined, poses } as never],
        },
      ],
    }) as Project & { documentVersion?: number };
    delete (legacy as { documentVersion?: number }).documentVersion;

    const migrated = migrateProject(legacy);
    const composition = migrated.compositions[0]!;
    expect(composition.keyframes.map((keyframe) => keyframe.role)).toEqual([
      'start',
      'step',
      'end',
    ]);
    expect(composition.keyframes[1]!.id).toBe(intro.id);
    expect(composition.keyframes[2]!.id).toBe(outro.id);
    expect(composition.layers[0]!.keyframes.map((keyframe) => keyframe.frame)).toEqual([0, 12, 24]);
    expect(composition.layers[0]!.keyframes[0]!.transform.opacity).toBe(0);
    expect(legacy.compositions[0]!.keyframes).toHaveLength(2);
  });

  it('normalizes duplicate or misplaced boundaries to a single ordered pair', () => {
    const end = createKeyframe({ role: 'end' });
    const extraEnd = createKeyframe({ role: 'end' });
    const start = createKeyframe({ role: 'start' });
    const migrated = migrateProject(
      createProject({ compositions: [createComposition({ keyframes: [end, extraEnd, start] })] }),
    );
    expect(migrated.compositions[0]!.keyframes.map((keyframe) => keyframe.role)).toEqual([
      'start',
      'step',
      'end',
    ]);
  });

  it('normalizes fractional authored pixel geometry without mutating the source', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('rectangle');
    const keyframe = createLayerKeyframe(
      0,
      layer.keyframes[0]?.transform ?? {
        x: 100,
        y: 100,
        width: 400,
        height: 120,
        rotation: 0,
        opacity: 1,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
      },
    );
    keyframe.transform.x = 119.596;
    keyframe.transform.width = 400.49;
    keyframe.transform.rotation = 12.345;
    layer.keyframes = [keyframe];
    composition.layers = [layer];

    const migrated = migrateProject(project);
    expect(migrated.compositions[0]!.layers[0]!.keyframes[0]!.transform).toMatchObject({
      x: 120,
      width: 400,
      rotation: 12.345,
    });
    expect(project.compositions[0]!.layers[0]!.keyframes[0]!.transform.x).toBe(119.596);
  });

  it('backfills typography sizing and layer effects for older documents', () => {
    const project = createProject();
    const textLayer = createLayerOfKind('text');
    const legacyText = textLayer.element as typeof textLayer.element & { autoFit?: string };
    delete legacyText.autoFit;
    delete (textLayer as Omit<typeof textLayer, 'effects'> & { effects?: unknown }).effects;
    delete (textLayer as Omit<typeof textLayer, 'semantics'> & { semantics?: unknown }).semantics;
    delete (project.compositions[0]!.layout as Partial<(typeof project.compositions)[0]['layout']>)
      .dimOutsideCanvas;
    delete (project.compositions[0]!.layout as Partial<(typeof project.compositions)[0]['layout']>)
      .showCenterMarker;
    delete (project.compositions[0]!.layout as Partial<(typeof project.compositions)[0]['layout']>)
      .presentationBackground;
    delete (project.compositions[0]!.layout as Partial<(typeof project.compositions)[0]['layout']>)
      .presentationBackgroundImageSource;
    delete (project.compositions[0]!.layout as Partial<(typeof project.compositions)[0]['layout']>)
      .presentationBackgroundImageName;
    project.compositions[0]!.layers = [textLayer];
    project.documentVersion = 3;

    const migrated = migrateProject(project);
    const layer = migrated.compositions[0]!.layers[0]!;
    expect(layer.element.type === 'text' && layer.element.autoFit).toBe('auto-size');
    expect(layer.effects).toMatchObject({ blur: 0, dropShadowEnabled: false });
    expect(layer.semantics).toEqual({ role: 'none', tags: [], description: '' });
    expect(layer.designTokenBindings).toEqual([]);
    expect(layer.componentLink).toBeNull();
    expect(migrated.compositions[0]!.designSystem).toEqual({
      name: 'Brand Kit',
      tokens: [],
    });
    expect(layer.animationTracks.x?.length).toBeGreaterThan(0);
    expect(layer.animationTracks.blur?.[0]?.value).toBe(0);
    expect(migrated.documentVersion).toBe(25);
    expect(layer.loop).toBeNull();
    expect(migrated.compositions[0]!.layers.every((layer) => layer.clipChildren === false)).toBe(
      true,
    );
    expect(layer).toMatchObject({
      isLocked: false,
      groupId: null,
      parentId: null,
      constraints: { horizontal: 'left', vertical: 'top' },
    });
    expect(migrated.compositions[0]!.layout).toMatchObject({
      showRulers: true,
      showCenterMarker: false,
      dimOutsideCanvas: false,
      presentationBackground: 'none',
      presentationBackgroundImageSource: '',
      presentationBackgroundImageName: '',
      snappingEnabled: true,
      boundsMode: 'allow',
      overflowPreview: 'visible',
      guides: [],
      timelineFolders: [],
    });
  });

  it('preserves the fit-to-width text sizing mode at the project boundary', () => {
    const project = createProject();
    const layer = createLayerOfKind('text');
    if (layer.element.type !== 'text') throw new Error('Expected a text layer.');
    layer.element.autoFit = 'fit-to-width';
    project.compositions[0]!.layers = [layer];

    const migrated = migrateProject(project);

    expect(migrated.compositions[0]!.layers[0]!.element).toMatchObject({
      type: 'text',
      autoFit: 'fit-to-width',
    });
  });

  it('migrates the legacy singular layer binding into the ordered binding list', () => {
    const project = createProject();
    const layer = createLayerOfKind('text');
    const legacyLayer = layer as unknown as {
      binding: { fieldId: string; targetProperty: string };
      bindings?: unknown;
    };
    delete legacyLayer.bindings;
    legacyLayer.binding = { fieldId: 'headline-field', targetProperty: 'content' };
    project.compositions[0]!.layers = [layer];
    project.documentVersion = 10;

    const migrated = migrateProject(project);

    expect(migrated.compositions[0]!.layers[0]!.bindings).toEqual([
      { fieldId: 'headline-field', targetProperty: 'content', sourcePath: [] },
    ]);
    expect(migrated.documentVersion).toBe(25);
  });

  it('backfills document-v13 typography without changing the authored font size', () => {
    const project = createProject();
    const layer = createLayerOfKind('text');
    if (layer.element.type !== 'text') throw new Error('Expected a text layer.');
    layer.element.fontSize = 40;
    const legacyText = layer.element as unknown as Record<string, unknown>;
    for (const key of [
      'lineHeight',
      'letterSpacing',
      'textTransform',
      'verticalAlign',
      'baselineShift',
      'minFontSize',
      'overflowPolicy',
    ]) {
      delete legacyText[key];
    }
    project.compositions[0]!.layers = [layer];
    project.documentVersion = 12;

    const migrated = migrateProject(project);
    const element = migrated.compositions[0]!.layers[0]!.element;

    expect(element).toMatchObject({
      type: 'text',
      fontSize: 40,
      lineHeight: 1.2,
      letterSpacing: 0,
      textTransform: 'none',
      verticalAlign: 'top',
      baselineShift: 0,
      minFontSize: 20,
      overflowPolicy: 'visible',
    });
    expect(migrated.documentVersion).toBe(25);
  });

  it('backfills timeline folders and removes stale or duplicate members', () => {
    const project = createProject();
    const layer = createLayerOfKind('rectangle');
    project.compositions[0]!.layers = [layer];
    delete (project.compositions[0]!.layout as { timelineFolders?: unknown }).timelineFolders;

    expect(migrateProject(project).compositions[0]!.layout.timelineFolders).toEqual([]);

    project.compositions[0]!.layout.timelineFolders = [
      {
        id: 'folder-1',
        name: 'Day 1',
        color: '#7c6cff',
        layerIds: [layer.id, layer.id, 'missing-layer'],
      },
    ];
    expect(migrateProject(project).compositions[0]!.layout.timelineFolders[0]!.layerIds).toEqual([
      layer.id,
    ]);
  });

  it('backfills document-v17 GDD field metadata without changing existing values', () => {
    const project = createProject();
    const field = createFieldDefinition('text', {
      key: 'headline',
      label: 'Headline',
      defaultValue: 'News',
    });
    const legacy = field as unknown as Record<string, unknown>;
    delete legacy.description;
    delete legacy.options;
    delete legacy.constraints;
    delete legacy.fileExtensions;
    project.compositions[0]!.dataFields = [field];
    project.documentVersion = 16;

    const migrated = migrateProject(project);
    expect(migrated.documentVersion).toBe(25);
    expect(migrated.compositions[0]!.dataFields[0]).toMatchObject({
      key: 'headline',
      defaultValue: 'News',
      description: '',
      options: [],
      constraints: {},
      fileExtensions: [],
    });
  });

  it('backfills document-v18 normal blend mode', () => {
    const project = createProject();
    const layer = createLayerOfKind('rectangle');
    delete (layer as Partial<typeof layer>).blendMode;
    project.compositions[0]!.layers = [layer];
    project.documentVersion = 17;

    const migrated = migrateProject(project);
    expect(migrated.documentVersion).toBe(25);
    expect(migrated.compositions[0]!.layers[0]!.blendMode).toBe('normal');
  });

  it('backfills document-v19 recursive field nodes, binding paths, and collections', () => {
    const project = createProject();
    const field = createFieldDefinition('text', { key: 'headline' });
    const layer = createLayerOfKind('text');
    layer.bindings = [{ fieldId: field.id, targetProperty: 'content' }];
    delete (field as Partial<typeof field>).properties;
    delete (field as Partial<typeof field>).items;
    delete (project.compositions[0] as Partial<(typeof project.compositions)[0]>)
      .runtimeCollections;
    project.compositions[0]!.layers = [layer];
    project.compositions[0]!.dataFields = [field];
    project.documentVersion = 18;

    const migrated = migrateProject(project);
    expect(migrated.documentVersion).toBe(25);
    expect(migrated.compositions[0]!.dataFields[0]).toMatchObject({
      properties: [],
      items: null,
    });
    expect(migrated.compositions[0]!.layers[0]!.bindings[0]!.sourcePath).toEqual([]);
    expect(migrated.compositions[0]!.runtimeCollections).toEqual([]);
  });

  it('backfills document-v20 text stroke on layers and reusable component snapshots', () => {
    const project = createProject();
    const layer = createLayerOfKind('text');
    const componentLayer = createLayerOfKind('text');
    const preservedLayer = createLayerOfKind('text');
    if (preservedLayer.element.type !== 'text') throw new Error('Expected text layer.');
    preservedLayer.element.strokeColor = '#112233';
    preservedLayer.element.strokeWidth = 4;
    for (const candidate of [layer, componentLayer]) {
      const legacyText = candidate.element as unknown as Record<string, unknown>;
      delete legacyText.strokeColor;
      delete legacyText.strokeWidth;
      delete candidate.animationTracks.strokeWidth;
    }
    project.compositions[0]!.layers = [layer, preservedLayer];
    project.compositions[0]!.components = [
      {
        id: 'component-legacy-text',
        name: 'Legacy text',
        layers: [componentLayer],
        dataFields: [],
      },
    ];
    project.documentVersion = 19;

    const migrated = migrateProject(project);
    const migratedLayer = migrated.compositions[0]!.layers[0]!;
    const migratedComponentLayer = migrated.compositions[0]!.components[0]!.layers[0]!;

    expect(migrated.documentVersion).toBe(25);
    expect(migratedLayer.element).toMatchObject({
      type: 'text',
      strokeColor: 'transparent',
      strokeWidth: 0,
    });
    expect(migratedLayer.animationTracks.strokeWidth?.[0]?.value).toBe(0);
    expect(migrated.compositions[0]!.layers[1]!.element).toMatchObject({
      type: 'text',
      strokeColor: '#112233',
      strokeWidth: 4,
    });
    expect(migratedComponentLayer.element).toMatchObject({
      type: 'text',
      strokeColor: 'transparent',
      strokeWidth: 0,
    });
    expect(migratedComponentLayer.animationTracks.strokeWidth?.[0]?.value).toBe(0);
    expect((layer.element as unknown as Record<string, unknown>).strokeWidth).toBeUndefined();
  });
});
