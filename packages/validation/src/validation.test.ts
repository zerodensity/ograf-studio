import { describe, expect, it } from 'vitest';
import { assembleManifest, compileDescriptor } from '@ograf-editor/codegen';
import {
  createComposition,
  computeKeyframeFrames,
  createFieldDefinition,
  createLayerKeyframe,
  createLayerOfKind,
  createProject,
  createTransition,
  defaultTransformForRole,
} from '@ograf-editor/scene-model';
import { validateManifest } from './validateManifest';
import { validateProject } from './validateProject';

describe('canonical OGraf validation', () => {
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
});
