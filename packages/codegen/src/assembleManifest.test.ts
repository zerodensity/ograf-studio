import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createComposition,
  createCustomActionDefinition,
  createFieldDefinition,
  createKeyframe,
  createLayerLoopClip,
  createLayerOfKind,
  createMediaPaint,
  createMediaCue,
  createProject,
  createTransition,
  type Composition,
  type Project,
} from '@ograf-editor/scene-model';
import { assembleManifest } from './assembleManifest';
import { compileDescriptor } from './compileDescriptor';

const schemaFile = (name: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../../fixtures/ograf-schema/${name}`, import.meta.url)),
      'utf8',
    ),
  );

/**
 * Validates against the REAL vendored EBU schema, not our hand-authored
 * packages/validation/src/ografManifestSchema.ts. That distinction is the whole point: in Phase 5a
 * both our emitter and our local validator shared the same wrong assumption about
 * `renderRequirements` (raw numbers instead of constraint objects), so the local validator passed
 * manifests the real spec rejects. This is the independent check that catches that class of drift.
 */
let validateAgainstRealSchema: (manifest: unknown) => { valid: boolean; errors: string[] };

beforeAll(() => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  // Register the $ref closure by its canonical spec URL so the main schema resolves offline.
  const BASE = 'https://ograf.ebu.io/v1/specification/json-schemas';
  ajv.addSchema(schemaFile('number.json'), `${BASE}/lib/constraints/number.json`);
  ajv.addSchema(schemaFile('boolean.json'), `${BASE}/lib/constraints/boolean.json`);
  ajv.addSchema(schemaFile('gdd-basic-types.json'), `${BASE}/gdd/basic-types.json`);
  ajv.addSchema(schemaFile('gdd-types.json'), `${BASE}/gdd/gdd-types.json`);
  ajv.addSchema(schemaFile('gdd-object.json'), `${BASE}/gdd/object.json`);
  ajv.addSchema(schemaFile('action.json'), `${BASE}/lib/action.json`);
  const validate = ajv.compile(schemaFile('graphics-schema.json'));
  validateAgainstRealSchema = (manifest) => ({
    valid: validate(manifest) as boolean,
    errors: (validate.errors ?? []).map((e) => `${e.instancePath || '/'}: ${e.message}`),
  });
});

function build(composition: Composition, project: Project = createProject()) {
  return assembleManifest(project, composition, compileDescriptor(composition));
}

it('publishes the proven short Out duration while preserving authored fallback and OGraf steps', () => {
  const composition = createProject().compositions[0]!;
  composition.transitions[0]!.durationFrames = 13;
  composition.transitions[1]!.durationFrames = 112;
  composition.shortOutFrames = 13;
  const manifest = build(composition);
  expect(manifest.stepCount).toBe(1);
  expect(manifest.actionDurations?.find((entry) => entry.type === 'stopAction')?.duration).toBe(
    520,
  );
  composition.layers.push(createLayerOfKind('ticker'));
  expect(
    build(composition).actionDurations?.find((entry) => entry.type === 'stopAction')?.duration,
  ).toBe(4480);
  delete composition.shortOutFrames;
  composition.layers = [];
  expect(
    build(composition).actionDurations?.find((entry) => entry.type === 'stopAction')?.duration,
  ).toBe(4480);
});

/** A realistic template: bound text, an animated outro, a custom action, non-default format. */
function realisticComposition(): Composition {
  const start = createKeyframe({ name: 'Start', role: 'start' });
  const step = createKeyframe({ name: 'Step 1', role: 'step' });
  const end = createKeyframe({ name: 'End', role: 'end' });
  const field = createFieldDefinition('text', {
    key: 'headline',
    label: 'Headline',
    required: true,
  });
  return createComposition({
    width: 1280,
    height: 720,
    frameRate: 50,
    keyframes: [start, step, end],
    transitions: [
      createTransition(start.id, step.id, { durationFrames: 10 }),
      createTransition(step.id, end.id, { durationFrames: 25 }),
    ],
    dataFields: [field],
    customActions: [createCustomActionDefinition({ actionId: 'pulse', name: 'Pulse' })],
  });
}

describe('assembleManifest — conformance to the real EBU schema', () => {
  it('produces a schema-valid manifest for a minimal composition', () => {
    const result = validateAgainstRealSchema(build(createComposition()));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('produces a schema-valid manifest for a realistic composition', () => {
    const result = validateAgainstRealSchema(build(realisticComposition()));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('keeps renderer-specific live media schema-valid and declares its engine requirement', () => {
    const layer = createLayerOfKind('rectangle');
    if (!('fill' in layer.element)) throw new Error('Expected fill');
    layer.element.fill = createMediaPaint({ source: { kind: 'live', tag: 'camera.program' } });
    const composition = createComposition({ layers: [layer] });
    const project = createProject({ supportsNonRealTime: false });
    const manifest = build(composition, project);
    expect(validateAgainstRealSchema(manifest)).toEqual({ valid: true, errors: [] });
    expect(manifest.renderRequirements?.[0]?.engine).toEqual([
      { type: 'ZeroDensityHTML', version: { min: '1.0' } },
    ]);
  });

  it('rejects the pre-Phase-5a raw-number renderRequirements shape', () => {
    // Regression guard: this is exactly what we used to emit, and what ograf-devtool rejected.
    const manifest = build(createComposition()) as unknown as Record<string, unknown>;
    manifest.renderRequirements = [
      { resolution: { width: 1920, height: 1080 }, frameRate: 25, accessToPublicInternet: false },
    ];
    expect(validateAgainstRealSchema(manifest).valid).toBe(false);
  });
});

describe('assembleManifest — content', () => {
  it('declares timed loop controls with group targeting and zero scheduling duration', () => {
    const field = createFieldDefinition('number', {
      id: 'hold',
      key: 'holdSeconds',
      defaultValue: 4,
    });
    const layer = createLayerOfKind('rectangle');
    layer.loop = createLayerLoopClip({
      durationFrames: 30,
      timing: {
        groupId: 'Headlines',
        holdFieldId: field.id,
        holdRanges: [{ startFrame: 0, endFrame: 20 }],
      },
    });
    const manifest = build(createComposition({ layers: [layer], dataFields: [field] }));
    expect(manifest.customActions?.map((action) => action.id)).toEqual([
      'loop.pause',
      'loop.resume',
      'loop.next',
    ]);
    expect(manifest.customActions?.[0]?.schema).toMatchObject({
      properties: { groupId: { enum: ['Headlines'] } },
      required: ['groupId'],
    });
    for (const action of ['pause', 'resume', 'next'])
      expect(manifest.actionDurations).toContainEqual({
        type: 'customAction',
        customActionId: `loop.${action}`,
        duration: 0,
      });
    expect(validateAgainstRealSchema(manifest)).toEqual({ valid: true, errors: [] });
  });
  it('emits renderRequirements as constraint objects carrying composition settings', () => {
    const manifest = build(realisticComposition());
    expect(manifest.renderRequirements).toEqual([
      {
        resolution: { width: { exact: 1280 }, height: { exact: 720 } },
        frameRate: { exact: 50 },
        accessToPublicInternet: { exact: false },
      },
    ]);
  });

  it('declares public internet access for a remote media clip', () => {
    const layer = createLayerOfKind('ellipse');
    if (!('fill' in layer.element)) throw new Error('Expected fill');
    layer.element.fill = createMediaPaint({
      source: { kind: 'clip', src: 'https://media.example/clip.mp4' },
    });
    const manifest = build(createComposition({ layers: [layer] }));
    expect(manifest.renderRequirements?.[0]?.accessToPublicInternet).toEqual({ exact: true });
  });

  it('sets stepCount from the step count (outro excluded) and points main at main.js', () => {
    const manifest = build(realisticComposition());
    // intro + outro = one pausable step, per the spec's play-then-stop definition.
    expect(manifest.stepCount).toBe(1);
    expect(manifest.main).toBe('main.js');
    expect(manifest.supportsRealTime).toBe(true);
    expect(manifest.supportsNonRealTime).toBe(true);
  });

  it('publishes actionDurations derived from real transition timings', () => {
    // 25 frames @ 50fps = 500ms into the outro.
    const manifest = build(realisticComposition());
    const byType = Object.fromEntries((manifest.actionDurations ?? []).map((d) => [d.type, d]));
    expect(byType.stopAction).toEqual({ type: 'stopAction', duration: 500 });
    expect(byType.updateAction).toEqual({ type: 'updateAction', duration: 0 });
    expect(byType.customAction).toEqual({
      type: 'customAction',
      customActionId: 'pulse',
      duration: 0,
    });
    expect(byType.playAction!.type).toBe('playAction');
  });

  it('publishes the longest per-layer designed update transition', () => {
    const layer = createLayerOfKind('text');
    layer.updateTransition = { style: 'slide-left', durationFrames: 30, distance: 48 };
    const composition = createComposition({
      frameRate: 25,
      updateTransitionFrames: 10,
      updateInterruption: 'replace',
      layers: [layer],
    });
    const manifest = build(composition);
    expect(manifest.actionDurations?.find((duration) => duration.type === 'updateAction')).toEqual({
      type: 'updateAction',
      duration: 1200,
    });
    const compiled = compileDescriptor(composition);
    expect(compiled.updateInterruption).toBe('replace');
    expect(compiled.layers[0]!.updateTransition).toEqual({
      style: 'slide-left',
      durationFrames: 30,
      distance: 48,
    });
  });

  it('publishes the longest custom-action clip duration', () => {
    const layer = createLayerOfKind('rectangle');
    layer.loop = createLayerLoopClip({
      activation: { type: 'customAction', customActionId: 'pulse' },
      durationFrames: 30,
      repeatCount: 2,
    });
    const composition = createComposition({
      frameRate: 50,
      layers: [layer],
      customActions: [createCustomActionDefinition({ actionId: 'pulse', name: 'Pulse' })],
    });
    const manifest = build(composition);
    expect(
      manifest.actionDurations?.find(
        (duration) => duration.type === 'customAction' && duration.customActionId === 'pulse',
      ),
    ).toEqual({ type: 'customAction', customActionId: 'pulse', duration: 1200 });
  });

  it('gives each playAction step its own duration from the inbound transition', () => {
    const start = createKeyframe({ name: 'Start', role: 'start' });
    const a = createKeyframe({ name: 'A', role: 'step' });
    const b = createKeyframe({ name: 'B', role: 'step' });
    const end = createKeyframe({ name: 'End', role: 'end' });
    const composition = createComposition({
      frameRate: 25,
      keyframes: [start, a, b, end],
      transitions: [
        createTransition(start.id, a.id, { durationFrames: 25 }), // 1000ms
        createTransition(a.id, b.id, { durationFrames: 5 }), //   200ms
        createTransition(b.id, end.id, { durationFrames: 10 }),
      ],
    });
    const playAction = build(composition).actionDurations?.find((d) => d.type === 'playAction');
    expect(playAction).toEqual({
      type: 'playAction',
      duration: 0,
      steps: [
        { step: 0, duration: 1000 },
        { step: 1, duration: 200 },
      ],
    });
  });

  it('includes the compiled data schema and custom actions', () => {
    const manifest = build(realisticComposition());
    expect(manifest.schema).toMatchObject({
      type: 'object',
      properties: { headline: { type: 'string', title: 'Headline' } },
      required: ['headline'],
    });
    expect(manifest.customActions).toEqual([{ id: 'pulse', name: 'Pulse' }]);
  });

  it('declares live Media Cue renderer requirements and public clip access', () => {
    const composition = createComposition({
      mediaCues: [
        createMediaCue({
          sources: [
            {
              id: 'remote',
              name: 'Remote',
              kind: 'clip',
              mediaType: 'video',
              src: 'https://cdn.example/intro.mp4',
            },
            { id: 'live', name: 'Live', kind: 'live', tag: 'program.live' },
          ],
          activeSourceId: 'live',
        }),
      ],
    });
    const requirement = build(composition).renderRequirements?.[0];
    expect(requirement).toMatchObject({
      accessToPublicInternet: { exact: true },
      engine: [{ type: 'ZeroDensityHTML', version: { min: '1.0' } }],
    });
  });

  it('omits optional fields rather than emitting empty ones', () => {
    const manifest = build(createComposition());
    expect(manifest.schema).toBeUndefined();
    expect(manifest.customActions).toBeUndefined();
    expect(manifest.description).toBeUndefined();
  });

  it('carries project identity through', () => {
    const project = createProject({ name: 'Lower Third', version: '2.1.0', description: 'Test' });
    const manifest = build(createComposition(), project);
    expect(manifest.id).toBe(project.id);
    expect(manifest.name).toBe('Lower Third');
    expect(manifest.version).toBe('2.1.0');
    expect(manifest.description).toBe('Test');
  });
});
