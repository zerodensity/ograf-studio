import { getElementShaderPaint } from '@ograf-editor/scene-model';
import { describe, expect, it } from 'vitest';
import { assembleManifest, compileDescriptor } from '@ograf-editor/codegen';
import {
  createComposition,
  computeKeyframeFrames,
  createFieldDefinition,
  createLayerKeyframe,
  createLayerOfKind,
  createLayerPropertyKeyframe,
  createMediaPaint,
  createMediaCue,
  createProject,
  createLayerVisualRule,
  createTransition,
  defaultTransformForRole,
  MAX_TEXT_CLIP_MARGIN,
  syncShaderParameterFields,
  createAsset,
} from '@ograf-editor/scene-model';
import { validateManifest } from './validateManifest';
import { validateProject } from './validateProject';

describe('canonical OGraf validation', () => {
  it('validates optional clipping margins and carries valid text margins into exports', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('text');
    if (layer.element.type !== 'text') throw new Error('Expected text layer.');
    const frames = computeKeyframeFrames(composition);
    layer.keyframes = composition.keyframes.map((keyframe, index) =>
      createLayerKeyframe(frames[index]!.frame, defaultTransformForRole('text', keyframe.role)),
    );
    composition.layers.push(layer);

    expect(validateProject(project).errors).toEqual([]);
    layer.element.overflowPolicy = 'clip';
    layer.element.clipMarginX = 12.5;
    layer.element.clipMarginY = 4;
    expect(validateProject(project).errors).toEqual([]);
    expect(compileDescriptor(composition).layers[0]?.element).toMatchObject({
      clipMarginX: 12.5,
      clipMarginY: 4,
    });

    layer.element.clipMarginX = -1;
    layer.element.clipMarginY = MAX_TEXT_CLIP_MARGIN + 1;
    expect(validateProject(project).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('horizontal clip margin must be between'),
        expect.stringContaining('vertical clip margin must be between'),
      ]),
    );
  });

  it('accepts interactive keyboard rules and rejects missing or malformed keys', () => {
    const project = createProject();
    const layer = createLayerOfKind('rectangle');
    layer.visualRules = [
      createLayerVisualRule({
        trigger: 'key-down',
        keyboard: { key: 'Enter', ctrl: true },
        delayFrames: 6,
      }),
    ];
    project.compositions[0]!.layers.push(layer);
    expect(
      validateProject(project).errors.filter((error) => error.includes('visual rule')),
    ).toEqual([]);
    delete layer.visualRules[0]!.keyboard;
    expect(validateProject(project).errors.join('\n')).toContain('Keyboard rules require');
    layer.visualRules[0]!.keyboard = { key: '\t' };
    expect(validateProject(project).errors.join('\n')).toContain('Keyboard key must be');
  });
  it('allows pointer-triggered rules without a data field', () => {
    const project = createProject();
    const layer = createLayerOfKind('rectangle');
    layer.visualRules = [
      createLayerVisualRule({
        trigger: 'click',
        fieldId: '',
        actions: [{ type: 'visibility', visible: false }],
      }),
    ];
    project.compositions[0]!.layers.push(layer);
    expect(
      validateProject(project).errors.some((error) =>
        error.includes('visual rule references a missing data field'),
      ),
    ).toBe(false);
  });
  it('reports broken rule targets, comparisons, triggers, and state-only misuse', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const field = createFieldDefinition('integer', { key: 'score' });
    composition.dataFields.push(field);
    const layer = createLayerOfKind('rectangle');
    layer.visualRules = [
      createLayerVisualRule({
        name: 'Target',
        fieldId: field.id,
        actions: [{ type: 'visibility', visible: true, targetLayerId: 'missing-layer' }],
      }),
      createLayerVisualRule({ name: 'Compare', fieldId: field.id, compareFieldId: 'missing' }),
      createLayerVisualRule({ name: 'Range', fieldId: field.id, operator: 'between', value: 'x' }),
      createLayerVisualRule({ name: 'Action', trigger: 'custom-action', eventId: 'missing' }),
      createLayerVisualRule({
        name: 'Toggle',
        fieldId: field.id,
        delayFrames: 5,
        actions: [{ type: 'toggle-visibility' }],
      }),
    ];
    composition.layers.push(layer);
    const errors = validateProject(project).errors.join('\n');
    expect(errors).toContain('"Target" targets a missing layer');
    expect(errors).toContain('"Compare" compares with a missing data field');
    expect(errors).toContain('"Range" needs a [min, max] pair');
    expect(errors).toContain('"Action" must name an existing custom action');
    expect(errors).toContain('"Toggle" delay applies only to event triggers');
    expect(errors).toContain('"Toggle" can toggle visibility only on an event trigger');
  });

  it('validates group targets and exports one action per group member', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const host = createLayerOfKind('rectangle');
    const first = createLayerOfKind('rectangle');
    const second = createLayerOfKind('rectangle');
    first.groupId = 'buttons';
    second.groupId = 'buttons';
    host.visualRules = [
      createLayerVisualRule({
        name: 'Missing group',
        trigger: 'click',
        actions: [{ type: 'visibility', visible: false, targetGroupId: 'nope' }],
      }),
    ];
    composition.layers.push(host, first, second);
    expect(validateProject(project).errors.join('\n')).toContain(
      '"Missing group" targets a missing group',
    );

    host.visualRules = [
      createLayerVisualRule({
        name: 'Hide buttons',
        trigger: 'click',
        actions: [{ type: 'visibility', visible: false, targetGroupId: 'buttons' }],
      }),
    ];
    expect(validateProject(project).errors.join('\n')).not.toContain('"Hide buttons"');
    const compiled = compileDescriptor(composition);
    expect(compiled.layers.find((entry) => entry.id === host.id)!.visualRules![0]!.actions).toEqual(
      [
        { type: 'visibility', visible: false, targetLayerId: first.id },
        { type: 'visibility', visible: false, targetLayerId: second.id },
      ],
    );
  });

  it('checks data changes and layer property values in rules, and compiles them for runtime', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const field = createFieldDefinition('integer', { key: 'score' });
    composition.dataFields.push(field);
    const layer = createLayerOfKind('rectangle');
    layer.visualRules = [
      createLayerVisualRule({
        name: 'Missing field',
        trigger: 'click',
        actions: [{ type: 'set-data', fieldId: 'gone', mode: 'set', value: 1 }],
      }),
      createLayerVisualRule({
        name: 'Step',
        trigger: 'click',
        actions: [{ type: 'set-data', fieldId: field.id, mode: 'increase', value: 'lots' }],
      }),
      createLayerVisualRule({
        name: 'Fade',
        trigger: 'hover',
        actions: [{ type: 'property', targetProperty: 'layer.opacity', value: 2 }],
      }),
    ];
    composition.layers.push(layer);
    const errors = validateProject(project).errors.join('\n');
    expect(errors).toContain('"Missing field" changes a missing data field');
    expect(errors).toContain('"Step" needs a number to increase by');
    expect(errors).toContain('"Fade" "layer.opacity" must be between 0 and 1');

    layer.visualRules = [
      createLayerVisualRule({
        name: 'Score',
        trigger: 'click',
        actions: [{ type: 'set-data', fieldId: field.id, mode: 'set', value: '7.4' }],
      }),
    ];
    expect(validateProject(project).errors.join('\n')).not.toContain('"Score"');
    const compiled = compileDescriptor(composition);
    const rule = compiled.layers.find((entry) => entry.id === layer.id)!.visualRules![0]!;
    expect(rule.actions).toEqual([
      { type: 'set-data', fieldId: field.id, mode: 'set', value: 7, dataKey: 'score' },
    ]);
  });

  it('validates media clip assets and keeps live sources realtime-only', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('rectangle');
    layer.keyframes = composition.keyframes.map((keyframe, index) =>
      createLayerKeyframe(
        computeKeyframeFrames(composition)[index]!.frame,
        defaultTransformForRole('rectangle', keyframe.role),
      ),
    );
    const clip = createAsset({
      id: 'clip',
      kind: 'media',
      mimeType: 'video/mp4',
      dataUri: 'data:video/mp4;base64,AAAA',
    });
    composition.assets.push(clip);
    if (!('fill' in layer.element)) throw new Error('Expected fill');
    layer.element.fill = createMediaPaint({ source: { kind: 'clip', src: 'asset:clip' } });
    composition.layers.push(layer);
    expect(validateProject(project).errors.join(' ')).toContain(
      'initial runtime is real-time-only',
    );
    project.supportsNonRealTime = false;
    expect(validateProject(project).errors).toEqual([]);

    layer.element.fill = createMediaPaint({ source: { kind: 'live', tag: 'camera.program' } });
    expect(validateProject(project).errors).toEqual([]);
  });

  it('validates first-class audio assets, trim ranges, and realtime-only playback', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const asset = createAsset({
      id: 'audio',
      kind: 'audio',
      mimeType: 'audio/mpeg',
      dataUri: 'data:audio/mpeg;base64,AAAA',
    });
    const layer = createLayerOfKind('audio');
    if (layer.element.type !== 'audio') throw new Error('Expected audio');
    layer.element.src = 'asset:audio';
    layer.element.trimStartMs = 250;
    layer.element.trimEndMs = 1_250;
    layer.element.timelineStartMs = 2_000;
    layer.keyframes = composition.keyframes.map((keyframe, index) =>
      createLayerKeyframe(
        computeKeyframeFrames(composition)[index]!.frame,
        defaultTransformForRole('audio', keyframe.role),
      ),
    );
    composition.assets.push(asset);
    composition.layers.push(layer);
    expect(validateProject(project).errors.join(' ')).toContain(
      'uses audio, which is real-time-only',
    );
    project.supportsNonRealTime = false;
    expect(validateProject(project).errors).toEqual([]);
    layer.element.trimEndMs = 100;
    expect(validateProject(project).errors.join(' ')).toContain('invalid trim/timeline values');
  });

  it('validates Media Cue sources, triggers, transitions, and real-time profile', () => {
    const project = createProject({ supportsNonRealTime: false });
    const composition = project.compositions[0]!;
    composition.assets.push(
      createAsset({
        id: 'clip',
        kind: 'media',
        mimeType: 'video/mp4',
        dataUri: 'data:video/mp4;base64,AAAA',
      }),
    );
    composition.mediaCues.push(
      createMediaCue({
        name: 'Program',
        sources: [
          { id: 'source', name: 'Clip', kind: 'clip', mediaType: 'video', src: 'asset:clip' },
        ],
        activeSourceId: 'source',
        transition: {
          type: 'crossfade',
          durationFrames: 12,
          audio: 'follow-picture',
          onFailure: 'keep-current',
        },
      }),
    );
    expect(validateProject(project).errors).toEqual([]);
    project.supportsNonRealTime = true;
    expect(validateProject(project).errors.join(' ')).toContain('uses Media Cues');
    project.supportsNonRealTime = false;
    composition.mediaCues[0]!.activeSourceId = 'missing';
    expect(validateProject(project).errors.join(' ')).toContain('active source does not exist');
  });
  it('accepts typed vector object bindings and rejects mismatched shader parameter field types', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('shader');
    const shader = getElementShaderPaint(layer.element)!;
    shader.fragmentSource = `#pragma ograf offset vector2 min(-1) max(1)
const vec2 offset = vec2(0.0);
void mainImage(out vec4 c, in vec2 p) { c = vec4(offset, 0.0, 1.0); }`;
    layer.keyframes = composition.keyframes.map((keyframe, index) =>
      createLayerKeyframe(
        computeKeyframeFrames(composition)[index]!.frame,
        defaultTransformForRole('shader', keyframe.role),
      ),
    );
    composition.layers.push(layer);
    syncShaderParameterFields(composition, layer);
    expect(validateProject(project).errors).toEqual([]);
    const wrong = createFieldDefinition('number', { key: 'wrong', defaultValue: 0.5 });
    composition.dataFields.push(wrong);
    layer.bindings = [{ fieldId: wrong.id, targetProperty: 'fill.parameters.offset' }];
    expect(validateProject(project).errors.join(' ')).toContain('incompatible field type');
    layer.bindings = [{ fieldId: wrong.id, targetProperty: 'fill.parameters.missing' }];
    expect(validateProject(project).errors.join(' ')).toContain('unmarked shader parameter');
  });

  it('rejects unsupported shader inputs and parameter ranges in loaded projects', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('shader');
    layer.keyframes = composition.keyframes.map((keyframe, index) =>
      createLayerKeyframe(
        computeKeyframeFrames(composition)[index]!.frame,
        defaultTransformForRole('shader', keyframe.role),
      ),
    );
    composition.layers.push(layer);
    expect(validateProject(project).valid).toBe(true);
    const shader = getElementShaderPaint(layer.element)!;
    shader.fragmentSource += '\nfloat unsupported = iMouse.x;';
    shader.speed = -1;
    shader.resolutionScale = 2;
    const errors = validateProject(project).errors.join(' ');
    expect(errors).toContain('Unsupported shader inputs: iMouse');
    expect(errors).toContain('Shader speed');
    expect(errors).toContain('Shader resolutionScale');
  });

  it('accepts an assembled project and rejects the legacy thumbnail shape', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const manifest = assembleManifest(project, composition, compileDescriptor(composition));
    expect(validateManifest(manifest)).toEqual({ valid: true, errors: [] });
    expect(validateManifest({ ...manifest, thumbnails: [{ url: 'thumb.png' }] }).valid).toBe(false);
  });

  it('accepts official enriched GDD scalar and select properties', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    composition.dataFields = [
      createFieldDefinition('text', {
        key: 'headline',
        description: 'On-air headline',
        constraints: { maxLength: 80 },
      }),
      createFieldDefinition('select', {
        key: 'theme',
        options: [
          { value: 'news', label: 'News' },
          { value: 'sport', label: 'Sport' },
        ],
        defaultValue: 'news',
      }),
      createFieldDefinition('select-multiple', {
        key: 'regions',
        options: [
          { value: 'eu', label: 'Europe' },
          { value: 'na', label: 'North America' },
        ],
        defaultValue: ['eu'],
      }),
      createFieldDefinition('duration-ms', {
        key: 'duration',
        defaultValue: 10000,
        constraints: { minimum: 0, maximum: 60000, step: 1000 },
      }),
      createFieldDefinition('percentage', { key: 'progress', defaultValue: 50 }),
      createFieldDefinition('file-path', {
        key: 'document',
        fileExtensions: ['pdf'],
      }),
    ];
    const manifest = assembleManifest(project, composition, compileDescriptor(composition));
    expect(validateProject(project).valid).toBe(true);
    expect(validateManifest(manifest)).toEqual({ valid: true, errors: [] });
  });

  it('accepts official recursive object and array GDD properties', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const item = createFieldDefinition('object', {
      key: 'item',
      properties: [
        createFieldDefinition('text', {
          key: 'name',
          required: true,
          constraints: { maxLength: 40 },
        }),
        createFieldDefinition('integer', { key: 'score' }),
      ],
      defaultValue: { name: '', score: 0 },
    });
    composition.dataFields = [
      createFieldDefinition('array', {
        key: 'leaderboard',
        items: item,
        constraints: { minItems: 0, maxItems: 12 },
        defaultValue: [{ name: 'Ada', score: 10 }],
      }),
    ];
    const manifest = assembleManifest(project, composition, compileDescriptor(composition));
    expect(validateProject(project).valid).toBe(true);
    expect(validateManifest(manifest)).toEqual({ valid: true, errors: [] });
  });
});

describe('project validation', () => {
  it('requires an ordered lifecycle, adjacent transitions, and complete poses', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    expect(validateProject(project).valid).toBe(true);

    composition.keyframes.reverse();
    const result = validateProject(project);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Start state|End state|transition/);
  });

  it('reports a zero-step graphic as valid with an operator-facing warning', () => {
    const project = createProject();
    const composition = createComposition();
    composition.keyframes = composition.keyframes.filter((keyframe) => keyframe.role !== 'step');
    composition.transitions = [
      createTransition(composition.keyframes[0]!.id, composition.keyframes[1]!.id),
    ];
    project.compositions = [composition];
    project.mainCompositionId = composition.id;
    const result = validateProject(project);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it('accepts self-contained Lottie JSON and blocks missing or external animation resources', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('lottie');
    layer.keyframes = composition.keyframes.map((keyframe, index) =>
      createLayerKeyframe(
        computeKeyframeFrames(composition)[index]!.frame,
        defaultTransformForRole('lottie', keyframe.role),
      ),
    );
    composition.layers.push(layer);
    expect(validateProject(project).errors.join(' ')).toMatch(/has no animation JSON/);

    if (layer.element.type !== 'lottie') throw new Error('Expected a Lottie layer.');
    layer.element.animationData = {
      fr: 25,
      ip: 0,
      op: 50,
      w: 200,
      h: 200,
      layers: [],
    };
    expect(validateProject(project).valid).toBe(true);
    layer.element.animationData.assets = [{ id: 'logo', p: 'images/logo.png' }];
    expect(validateProject(project).errors.join(' ')).toMatch(/embed images in the JSON/);
  });

  it('rejects duplicate binding targets on one layer', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createLayerOfKind('text');
    layer.keyframes = composition.keyframes.map((keyframe, index) =>
      createLayerKeyframe(
        computeKeyframeFrames(composition)[index]!.frame,
        defaultTransformForRole('text', keyframe.role),
      ),
    );
    const first = createFieldDefinition('text', { key: 'headline' });
    const second = createFieldDefinition('text', { key: 'alternate_headline' });
    layer.bindings = [
      { fieldId: first.id, targetProperty: 'content' },
      { fieldId: second.id, targetProperty: 'content' },
    ];
    composition.layers = [layer];
    composition.dataFields = [first, second];

    expect(validateProject(project).errors.join(' ')).toMatch(
      /binds target property "content" more than once/,
    );
  });

  it('rejects invalid GDD options, defaults, constraints, and patterns', () => {
    const project = createProject();
    project.compositions[0]!.dataFields = [
      createFieldDefinition('select', {
        key: 'theme',
        options: [
          { value: 'news', label: 'News' },
          { value: 'news', label: 'Duplicate' },
        ],
        defaultValue: 'missing',
        constraints: { minLength: 10, maxLength: 2, pattern: '[' },
      }),
    ];
    const errors = validateProject(project).errors.join(' ');
    expect(errors).toMatch(/repeats select option value/);
    expect(errors).toMatch(/select default must match/);
    expect(errors).toMatch(/minLength cannot exceed maxLength/);
    expect(errors).toMatch(/pattern is not a valid regular expression/);
  });

  it('rejects an unsupported layer blend mode from untrusted project JSON', () => {
    const project = createProject();
    const layer = createLayerOfKind('rectangle');
    layer.blendMode = 'plus-lighter' as typeof layer.blendMode;
    project.compositions[0]!.layers = [layer];
    expect(validateProject(project).errors.join(' ')).toMatch(/unsupported blend mode/);
  });

  it('rejects negative text stroke widths and unsupported stroke tracks', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const text = createLayerOfKind('text');
    const image = createLayerOfKind('image');
    for (const layer of [text, image]) {
      layer.keyframes = composition.keyframes.map((keyframe, index) =>
        createLayerKeyframe(
          computeKeyframeFrames(composition)[index]!.frame,
          defaultTransformForRole(layer.element.type, keyframe.role),
        ),
      );
    }
    if (text.element.type !== 'text') throw new Error('Expected text layer.');
    text.element.strokeWidth = -1;
    text.animationTracks.strokeWidth = [createLayerPropertyKeyframe(0, -2)];
    image.animationTracks.strokeWidth = [createLayerPropertyKeyframe(0, 2)];
    composition.layers = [text, image];

    const errors = validateProject(project).errors.join(' ');
    expect(errors).toMatch(/text layer "Text" stroke width must be finite and non-negative/);
    expect(errors).toMatch(/property "strokeWidth" values must be non-negative/);
    expect(errors).toMatch(/cannot animate text stroke width on a image element/);
  });

  it('accepts fit-to-width and squeeze while rejecting unknown text sizing modes', () => {
    const project = createProject();
    const text = createLayerOfKind('text');
    if (text.element.type !== 'text') throw new Error('Expected text layer.');
    text.element.autoFit = 'fit-to-width';
    project.compositions[0]!.layers = [text];
    expect(validateProject(project).errors.join(' ')).not.toMatch(/unsupported text sizing mode/);

    text.element.autoFit = 'squeeze';
    expect(validateProject(project).errors.join(' ')).not.toMatch(/unsupported text sizing mode/);

    text.element.autoFit = 'stretch-glyphs' as typeof text.element.autoFit;
    expect(validateProject(project).errors.join(' ')).toMatch(/unsupported text sizing mode/);
  });

  it('rejects invalid text stroke values inside reusable component snapshots', () => {
    const project = createProject();
    const text = createLayerOfKind('text');
    if (text.element.type !== 'text') throw new Error('Expected text layer.');
    text.element.strokeWidth = -2;
    text.animationTracks.strokeWidth = [createLayerPropertyKeyframe(0, -2)];
    project.compositions[0]!.components = [
      { id: 'invalid-component', name: 'Invalid outline', layers: [text], dataFields: [] },
    ];

    const errors = validateProject(project).errors.join(' ');
    expect(errors).toMatch(/component "Invalid outline" layer "Text" text stroke width/);
    expect(errors).toMatch(/stroke-width track values must be finite and non-negative/);
  });

  it('validates deterministic runtime collection ownership, paths, and capacity', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const field = createFieldDefinition('array', {
      key: 'leaderboard',
      constraints: { minItems: 0, maxItems: 3 },
      items: createFieldDefinition('object', {
        key: 'item',
        properties: [createFieldDefinition('text', { key: 'name', required: true })],
        defaultValue: { name: '' },
      }),
      defaultValue: [{ name: 'Ada' }],
    });
    const layer = createLayerOfKind('text');
    layer.groupId = 'leaderboard-item';
    layer.bindings = [{ fieldId: field.id, targetProperty: 'content', sourcePath: ['name'] }];
    layer.keyframes = composition.keyframes.map((keyframe, index) =>
      createLayerKeyframe(
        computeKeyframeFrames(composition)[index]!.frame,
        defaultTransformForRole('text', keyframe.role),
      ),
    );
    composition.layers = [layer];
    composition.dataFields = [field];
    composition.runtimeCollections = [
      {
        id: 'collection-1',
        name: 'Leaderboard',
        fieldId: field.id,
        prototypeLayerIds: [layer.id],
        offsetPerItem: { x: 0, y: 72 },
        capacity: 3,
        overflow: 'truncate',
      },
    ];
    expect(validateProject(project).valid).toBe(true);

    layer.bindings[0]!.sourcePath = ['missing'];
    expect(validateProject(project).errors.join(' ')).toMatch(/must resolve to a scalar leaf/);
    layer.bindings[0]!.sourcePath = ['name'];
    composition.runtimeCollections[0]!.capacity = 4;
    expect(validateProject(project).errors.join(' ')).toMatch(/capacity must equal field maxItems/);
  });
});
